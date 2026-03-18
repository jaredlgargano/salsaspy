import { Hono } from "hono";
import { ApiEnv } from "./index";
import { generateCsvForMonth } from "./exportCsv";
import { recomputeAggregatesForDate } from "./aggregate";
import dashboardHtml from "./dist/index.html";
import { normalizeBrand, isKnownBrand } from "../shared/normalize";
import { recordUnknownBrand } from "../shared/db";

export function setupRoutes(app: Hono<{ Bindings: ApiEnv }>) {

    // Dashboard UI
    app.get("/", (c) => {
        return c.html(dashboardHtml);
    });

    // Basic Health
    app.get("/health", (c) => c.json({ status: "ok" }));

    // Dashboard Status API
    app.get("/v1/status", async (c) => {
        // Find recent runs to identify the latest major execution
        const recentRuns = await c.env.DB.prepare(
            "SELECT run_id, status, failure_reason, started_at FROM runs ORDER BY started_at DESC LIMIT 200"
        ).all();

        const activeMarkets = await c.env.DB.prepare("SELECT COUNT(*) as count FROM markets WHERE active = 1").first();
        const totalObs = await c.env.DB.prepare("SELECT COUNT(*) as count FROM observations").first();

        if (!recentRuns.results || recentRuns.results.length === 0) {
            return c.json({
                health: 'Unknown',
                status: 'UNKNOWN',
                activeMarkets: activeMarkets?.count || 0,
                totalObservations: totalObs?.count || 0
            });
        }

        // Group by base run ID
        const groups: Record<string, { shards: any[], latestStarted: string }> = {};
        for (const r of recentRuns.results as any[]) {
            const parts = r.run_id.split('-');
            const lastPart = parts[parts.length - 1];
            
            // It's a shard if the last part is a small number (0-999)
            // Legacy node-cron runs used 13-digit timestamps, which we shouldn't treat as shard indices
            const isShardIndex = /^\d+$/.test(lastPart) && lastPart.length < 4;
            const baseId = isShardIndex ? parts.slice(0, -1).join('-') : r.run_id;

            if (!groups[baseId]) {
                groups[baseId] = { shards: [], latestStarted: r.started_at };
            }
            groups[baseId].shards.push(r);
        }

        // Find the absolute latest group
        const sortedBaseIds = Object.keys(groups).sort((a, b) => 
            groups[b].latestStarted.localeCompare(groups[a].latestStarted)
        );
        const latestBaseId = sortedBaseIds[0];
        const latestGroup = groups[latestBaseId];

        // Define success score: SUCCESS = 1, PARTIAL = 0.5, FAILED = 0
        const totalCount = latestGroup.shards.length;
        const failedCount = latestGroup.shards.filter(s => s.status === 'FAILED').length;
        const partialCount = latestGroup.shards.filter(s => s.status === 'PARTIAL').length;
        
        const score = totalCount > 0 ? (totalCount - failedCount - partialCount * 0.5) / totalCount : 0;
        
        const issues = Array.from(new Set(
            latestGroup.shards
                .filter(s => s.status === 'FAILED' || s.status === 'PARTIAL')
                .map(s => s.failure_reason)
                .filter(Boolean)
        ));

        let healthText = 'Healthy';
        let healthTier = 'Healthy';

        if (totalCount === 0 || (!latestGroup.shards.some(s => s.status === 'SUCCESS' || s.status === 'PARTIAL'))) {
            healthText = 'No successful runs recently';
            healthTier = 'Critical';
        } else if (score >= 0.90) {
            healthText = 'Healthy';
            healthTier = 'Healthy';
        } else if (score >= 0.50) {
            healthText = issues.length > 0 ? `Degraded: ${issues.join(', ')}` : 'Degraded';
            healthTier = 'Degraded';
        } else {
            healthText = issues.length > 0 ? `Critical: ${issues.join(', ')}` : 'Critical Issues';
            healthTier = 'Critical';
        }

        // Calculate next run assuming top of the hour execution (minute 30 as per scrape.yml)
        const now = new Date();
        const nextRun = new Date(now);
        nextRun.setMinutes(30, 0, 0);
        if (nextRun <= now) nextRun.setHours(now.getHours() + 1);

        return c.json({
            lastRunTime: latestGroup.latestStarted,
            nextRunTime: nextRun.toISOString(),
            activeMarkets: activeMarkets?.count || 0,
            totalObservations: totalObs?.count || 0,
            health: healthText,
            healthTier: healthTier,
            status: failedCount > 0 ? 'PARTIAL_FAILURE' : (totalCount > 0 ? 'SUCCESS' : 'PENDING'),
            shardCount: latestGroup.shards.length,
            baseRunId: latestBaseId
        });
    });

    // Cookie Health Status
    app.get("/v1/status/cookies", async (c) => {
        const result = await c.env.DB.prepare("SELECT * FROM cookie_status ORDER BY last_checked_at DESC").all();
        return c.json({ accounts: result.results || [] });
    });

    app.post("/v1/status/cookies/sync", async (c) => {
        const clientKey = c.req.header("Authorization")?.replace("Bearer ", "");
        const isAuthorized = (c.env.API_KEY && clientKey === c.env.API_KEY) || 
                             (c.env.SCRAPER_API_KEY && clientKey === c.env.SCRAPER_API_KEY);
        
        if (!isAuthorized) {
            console.error(`Sync unauthorized. Client key provided: ${!!clientKey}`);
            return c.json({ error: "Unauthorized" }, 401);
        }

        const { accounts } = await c.req.json() as { accounts: any[] };
        
        // Full sync: clear existing and re-insert
        await c.env.DB.prepare("DELETE FROM cookie_status").run();
        
        if (accounts.length > 0) {
            const stmt = c.env.DB.prepare(`
                INSERT INTO cookie_status (email, label, status, expiry_at, last_checked_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);
            
            // Batching would be better for many accounts, but for < 100 this is fine
            for (const acc of accounts) {
                await stmt.bind(acc.email, acc.label, acc.status, acc.expiry_at).run();
            }
        }

        return c.json({ success: true });
    });

    // Markets
    app.get("/v1/markets", async (c) => {
        const active = c.req.query("active") === "1" ? 1 : 0;
        const shard = c.req.query("shard");
        const totalShards = c.req.query("shards_total");
        const unscrapedOnly = c.req.query("unscraped_only") === "1";

        let query = "SELECT m.*, m.rowid FROM markets m";
        const params: any[] = [];
        const conditions = [];

        if (unscrapedOnly) {
            query = `
                SELECT m.*, m.rowid FROM markets m
                LEFT JOIN (
                    SELECT market_id, MAX(observed_at) as last_obs
                    FROM observations
                    GROUP BY market_id
                ) o ON m.market_id = o.market_id
            `;
            conditions.push("(o.last_obs IS NULL OR o.last_obs < datetime('now', '-18 hours'))");
        }

        if (c.req.query("active") !== undefined) {
            conditions.push("m.active = ?");
            params.push(active);
        }

        // Return only markets assigned to this shard
        // Using rowid for stable sharding since id might be a string or non-sequential
        if (shard !== undefined && totalShards !== undefined) {
            const shardNum = parseInt(shard as string, 10);
            const totalShardsNum = parseInt(totalShards as string, 10);
            if (!isNaN(shardNum) && !isNaN(totalShardsNum) && totalShardsNum > 0) {
                conditions.push(`(m.rowid % ?) = ?`);
                params.push(totalShardsNum, shardNum);
            }
        }

        if (conditions.length > 0) {
            query += " WHERE " + conditions.join(" AND ");
        }

        const result = await c.env.DB.prepare(query).bind(...params).all();
        return c.json({ markets: result.results || [] });
    });

    // Health Metrics (Daily Completeness)
    app.get("/v1/health-metrics", async (c) => {
        // Get total active tracked markets
        const activeRes = await c.env.DB.prepare("SELECT COUNT(*) as total FROM markets WHERE active = 1").first();
        const totalActive = (activeRes?.total as number) || 1; // prevent divide by zero

        // Get unique markets scraped per day for the last 7 days, 
        // broken down by internal metrics (any observation, has sponsored, has discount)
        const query = `
            SELECT 
                DATE(observed_at) as date,
                COUNT(DISTINCT market_id) as markets_with_rank,
                COUNT(DISTINCT CASE WHEN is_sponsored = 1 THEN market_id END) as markets_with_sponsored,
                COUNT(DISTINCT CASE WHEN has_discount = 1 THEN market_id END) as markets_with_offers
            FROM observations
            GROUP BY DATE(observed_at)
            ORDER BY date DESC
            LIMIT 7
        `;
        const result = await c.env.DB.prepare(query).all();
        
        const metrics = (result.results || []).map((row: any) => ({
            date: row.date,
            total_active: totalActive,
            rank_pct: Math.round((row.markets_with_rank / totalActive) * 100),
            sponsored_pct: Math.round((row.markets_with_sponsored / totalActive) * 100),
            offer_pct: Math.round((row.markets_with_offers / totalActive) * 100)
        }));

        return c.json({ metrics });
    });

    // Runs
    app.get("/v1/runs", async (c) => {
        // Basic filter logic
        const limit = 50;
        const query = `SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`;
        const result = await c.env.DB.prepare(query).bind(limit).all();
        return c.json({ runs: result.results || [] });
    });

    // Brands
    app.get("/v1/brands", async (c) => {
        const result = await c.env.DB.prepare("SELECT DISTINCT brand_normalized FROM aggregates_daily ORDER BY brand_normalized ASC").all();
        return c.json({ brands: result.results?.map((r: any) => r.brand_normalized) || [] });
    });

    // Aggregates Monthly
    app.get("/v1/aggregates/monthly", async (c) => {
        const month = c.req.query("month");
        if (!month) return c.json({ error: "Missing month parameter (YYYY-MM)" }, 400);

        let query = `SELECT * FROM aggregates_monthly WHERE month = ?`;
        const params: any[] = [month];

        const category = c.req.query("category");
        if (category) {
            query += ` AND category = ?`;
            params.push(category);
        }

        const surface = c.req.query("surface");
        if (surface) {
            query += ` AND surface = ?`;
            params.push(surface);
        }

        const metric_name = c.req.query("metric_name");
        if (metric_name) {
            query += ` AND metric_name = ?`;
            params.push(metric_name);
        }

        const result = await c.env.DB.prepare(query).bind(...params).all();
        return c.json({ aggregates: result.results || [] });
    });

    // Time-Series for Visualization (Recharts format)
    app.get("/v1/aggregates/time-series", async (c) => {
        const metric_name = c.req.query("metric_name");
        if (!metric_name) return c.json({ error: "Missing metric_name parameter" }, 400);

        const brand = c.req.query("brand");
        const interval = c.req.query("interval") || "day";

        // Map the requested UI metric to the actual D1 column
        let columnToSelect = "avg_min_rank";
        if (metric_name === "sponsored_share") columnToSelect = "sponsored_share";
        if (metric_name === "discount_store_share") columnToSelect = "discount_store_share";

        // Define time period grouping SQL
        let periodSql = "date"; // default for day
        if (interval === "week") {
            periodSql = "DATE(date, 'weekday 0', '-6 days')";
        } else if (interval === "month") {
            periodSql = "strftime('%Y-%m', date) || '-01'";
        } else if (interval === "year") {
            periodSql = "strftime('%Y', date) || '-01-01'";
        }

        let query = `
            SELECT 
                ${periodSql} as period, 
                brand_normalized, 
                SUM(avg_min_rank * total_observations) / SUM(total_observations) as metric_value
            FROM aggregates_daily 
            WHERE 1=1
        `;

        // If specific metric requested (other than default avg_min_rank which is used in weight)
        if (columnToSelect !== "avg_min_rank") {
            query = `
                SELECT 
                    ${periodSql} as period, 
                    brand_normalized, 
                    SUM(${columnToSelect} * total_observations) / SUM(total_observations) as metric_value
                FROM aggregates_daily 
                WHERE 1=1
            `;
        }

        const params: any[] = [];

        if (brand && brand !== "All") {
            const brandList = brand.split(',');
            if (brandList.length === 1) {
                query += ` AND brand_normalized = ?`;
                params.push(brandList[0]);
            } else {
                const placeholders = brandList.map(() => '?').join(',');
                query += ` AND brand_normalized IN (${placeholders})`;
                params.push(...brandList);
            }
        }

        const surface = c.req.query("surface");
        if (surface) {
            query += ` AND surface = ?`;
            params.push(surface);
        }

        const category = c.req.query("category");
        if (category && category !== "None" && category !== "All Categories") {
            query += ` AND category = ?`;
            params.push(category);
        } else if (category === "None") {
            query += ` AND category = 'None'`;
        }

        const start_date = c.req.query("start_date");
        if (start_date) {
            query += ` AND date >= ?`;
            params.push(start_date);
        }

        const end_date = c.req.query("end_date");
        if (end_date) {
            query += ` AND date <= ?`;
            params.push(end_date);
        }

        query += ` GROUP BY period, brand_normalized ORDER BY period ASC`;
        const result = await c.env.DB.prepare(query).bind(...params).all();

        // Shape data for Recharts: [{ date: '2024-03-01', Chipotle: 2.4, Burger King: 7.0 }]
        const timeGrouped: Record<string, any> = {};
        for (const row of result.results || []) {
            const d = row.period as string;
            const b = row.brand_normalized as string;
            if (!timeGrouped[d]) timeGrouped[d] = { date: d };
            timeGrouped[d][b] = row.metric_value;
        }

        return c.json({ data: Object.values(timeGrouped) });
    });

    // CSV Export
    app.get("/v1/export/monthly.csv", async (c) => {
        const month = c.req.query("month");
        if (!month) return c.json({ error: "Missing month parameter (YYYY-MM)" }, 400);

        const csvData = await generateCsvForMonth(c.env.DB, month);
        return new Response(csvData, {
            headers: {
                "Content-Type": "text/csv",
                "Content-Disposition": `attachment; filename="webscraper_${month}.csv"`
            }
        });
    });

    // --- Protected Endpoints --- //

    // Middleware for API Key
    const authMiddleware = async (c: any, next: any) => {
        const clientKey = c.req.header("Authorization")?.replace("Bearer ", "") || c.req.query("key");
        
        const isAuthorized = (c.env.API_KEY && clientKey === c.env.API_KEY) || 
                             (c.env.SCRAPER_API_KEY && clientKey === c.env.SCRAPER_API_KEY);

        if (!isAuthorized) {
            console.error(`Unauthorized access attempt. Key provided: ${!!clientKey}`);
            return c.json({ error: "Unauthorized" }, 401);
        }
        await next();
    };

    // Trigger manual run (Note: now triggers instructions for the Node.js script)
    app.post("/v1/run", authMiddleware, async (c) => {
        return c.json({
            status: "error",
            message: "Collector worker is deprecated. Please run 'npm run scrape' in your terminal."
        }, 400);
    });

    // Manual recompute
    app.post("/v1/recompute", authMiddleware, async (c) => {
        const date = c.req.query("date");
        if (!date) return c.json({ error: "Missing date parameter requried" }, 400);

        c.executionCtx.waitUntil(recomputeAggregatesForDate(c.env.DB, date));
        return c.json({ status: "recompute_started", date });
    });

    // Ingest data from external Node.js Playwright script
    app.post("/v1/ingest", authMiddleware, async (c) => {
        const body: any = await c.req.json().catch(() => ({}));

        // Upsert run if provided
        if (body.run) {
            const { run_id, started_at, ended_at, shard, shards_total, status, failure_reason, metadata } = body.run;

            const existing = await c.env.DB.prepare("SELECT run_id FROM runs WHERE run_id = ?").bind(run_id).first();
            if (existing) {
                await c.env.DB.prepare(
                    `UPDATE runs SET ended_at = ?, status = ?, failure_reason = ?, metadata = ? WHERE run_id = ?`
                ).bind(ended_at || null, status, failure_reason || null, metadata ? JSON.stringify(metadata) : null, run_id).run();
            } else {
                await c.env.DB.prepare(
                    `INSERT INTO runs (run_id, started_at, ended_at, shard, shards_total, status, failure_reason, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(run_id, started_at, ended_at || null, shard, shards_total, status, failure_reason || null, metadata ? JSON.stringify(metadata) : null).run();
            }
        }

        // Insert observations
        if (body.observations && body.observations.length > 0) {
            const insertStmt = c.env.DB.prepare(`
                INSERT INTO observations (obs_id, run_id, market_id, observed_at, category, surface, merchant_name, brand_normalized, rank, is_sponsored, has_discount, offer_title, raw_snippet, store_id, discount_type, delivery_fee, rating, review_count, city)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const batch = [];
            for (const obs of body.observations) {
                const norm = normalizeBrand(obs.merchant_name);
                if (!isKnownBrand(obs.merchant_name) && norm === obs.merchant_name) {
                    await recordUnknownBrand(c.env.DB, obs.merchant_name);
                }
                const obsId = `${obs.run_id}-${obs.market_id}-${obs.category}-${obs.rank}-${Date.now()}`;
                batch.push(
                    insertStmt.bind(
                        obsId, obs.run_id, obs.market_id, obs.observed_at, obs.category, obs.surface,
                        obs.merchant_name, norm, obs.rank, obs.is_sponsored ? 1 : 0, obs.has_discount ? 1 : 0,
                        obs.offer_title || null, obs.raw_snippet || null,
                        obs.store_id || null, obs.discount_type || null, obs.delivery_fee || null,
                        obs.rating || null, obs.review_count || null, obs.city || null
                    )
                );
            }
            if (batch.length > 0) {
                await c.env.DB.batch(batch);
            }

            // Auto-recompute aggregates for this date in the background
            const dateToRecompute = body.run?.started_at
                ? body.run.started_at.slice(0, 10)
                : new Date().toISOString().slice(0, 10);
            c.executionCtx.waitUntil(recomputeAggregatesForDate(c.env.DB, dateToRecompute));
        }

        return c.json({ success: true, ingested: body.observations?.length || 0 });
    });
}
