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
        const lastRun = await c.env.DB.prepare("SELECT started_at, status FROM runs ORDER BY started_at DESC LIMIT 1").first();
        const activeMarkets = await c.env.DB.prepare("SELECT COUNT(*) as count FROM markets WHERE active = 1").first();
        const totalObs = await c.env.DB.prepare("SELECT COUNT(*) as count FROM observations").first();

        // Calculate next run assuming top of the hour execution
        const now = new Date();
        const nextRun = new Date(now);
        nextRun.setHours(now.getHours() + 1, 0, 0, 0);

        return c.json({
            lastRunTime: lastRun?.started_at || null,
            nextRunTime: nextRun.toISOString(),
            activeMarkets: activeMarkets?.count || 0,
            totalObservations: totalObs?.count || 0,
            health: lastRun?.status === 'SUCCESS' ? 'Healthy' : (lastRun ? 'Issues detected' : 'Unknown'),
            status: lastRun?.status || 'UNKNOWN'
        });
    });

    // Markets
    app.get("/v1/markets", async (c) => {
        const active = c.req.query("active") === "1" ? 1 : 0;
        let query = "SELECT * FROM markets";
        const params: any[] = [];
        if (c.req.query("active") !== undefined) {
            query += " WHERE active = ?";
            params.push(active);
        }
        const result = await c.env.DB.prepare(query).bind(...params).all();
        return c.json({ markets: result.results || [] });
    });

    // Runs
    app.get("/v1/runs", async (c) => {
        // Basic filter logic
        const limit = 50;
        const query = `SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`;
        const result = await c.env.DB.prepare(query).bind(limit).all();
        return c.json({ runs: result.results || [] });
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

        // Map the requested UI metric to the actual D1 column
        let columnToSelect = "avg_min_rank";
        if (metric_name === "sponsored_share") columnToSelect = "sponsored_share";
        if (metric_name === "discount_store_share") columnToSelect = "discount_store_share";

        let query = `SELECT date, brand_normalized, ${columnToSelect} as metric_value FROM aggregates_daily WHERE 1=1`;
        const params: any[] = [];

        const surface = c.req.query("surface");
        if (surface) {
            query += ` AND surface = ?`;
            params.push(surface);
        }

        const category = c.req.query("category");
        if (category && category !== "None") {
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

        query += ` ORDER BY date ASC`;
        const result = await c.env.DB.prepare(query).bind(...params).all();

        // Shape data for Recharts: [{ date: '2024-03-01', Chipotle: 2.4, Burger King: 7.0 }]
        const timeGrouped: Record<string, any> = {};
        for (const row of result.results || []) {
            const d = row.date as string;
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
        const key = c.req.header("Authorization")?.replace("Bearer ", "") || c.req.query("key");
        if (!c.env.API_KEY || key !== c.env.API_KEY) {
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
