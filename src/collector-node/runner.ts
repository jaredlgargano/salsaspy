import { pushToApi } from "./ingest";
import { parseListings } from "./parseListings";
import { getNextCookies, markBanned } from "./cookieRotator";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getRandomProxy } from "./freeProxy";
import { Browser, BrowserContext } from "playwright";

chromium.use(StealthPlugin());

export async function runShard(apiUrl: string, apiKey: string, now: Date, runId: string, manualShard: number): Promise<string> {
    console.log(`Starting runShard for shard ${manualShard}`);
    const SHARDS_TOTAL = parseInt(process.env.SHARDS_TOTAL || "100");
    
    // 1. Fetch Markets
    const marketRes = await fetch(`${apiUrl}/v1/markets?shard=${manualShard}&shards_total=${SHARDS_TOTAL}&active=1&unscraped_only=1`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    if (!marketRes.ok) {
        console.error(`Failed to fetch markets: ${marketRes.status}`);
        return "FAILED";
    }

    let { markets } = await marketRes.json() as { markets: any[] };
    if (!markets || markets.length === 0) {
        if (process.env.FORCE_SCRAPE === "1") {
             const mRes2 = await fetch(`${apiUrl}/v1/markets?shard=${manualShard}&shards_total=${SHARDS_TOTAL}&active=1`, {
                 headers: { 'Authorization': `Bearer ${apiKey}` }
             });
             if (mRes2.ok) {
                 const d2 = await mRes2.json() as { markets: any[] };
                 markets = d2.markets || [];
             }
        }
    }

    if (markets.length === 0) {
        console.log("No markets found to process.");
        return "SUCCESS";
    }

    console.log(`Processing ${markets.length} markets for Shard ${manualShard}.`);
    
    const browser = await chromium.launch({ 
        headless: true, 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage', // Critical for GHA
            '--disable-web-security'
        ] 
    });

    let successCount = 0;
    let failCount = 0;
    let lastFailureReason: string = "";
    const observations: any[] = [];
    
    const objectives = [
        ...["", "Healthy", "Mexican", "Salad", "Chicken"].map(cat => ({ 
            name: cat === "" ? "Base Search" : cat,
            urlPath: cat === "" ? "Restaurants/" : `${encodeURIComponent(cat)}/`,
            surface: "searchCategory" as const
        })),
        { name: "Best of Lunch", urlPath: "best%20of%20lunch/", surface: "bestOfLunch" as const }
    ];

    try {
        for (const market of markets) {
            console.log(`\n🌎 Market: ${market.city}, ${market.state}`);

            // We reuse contexts when possible to save memory
            let activeDirectContext: BrowserContext | null = null;
            let activeGuestContext: BrowserContext | null = null;

            for (const obj of objectives) {
                const url = `https://www.doordash.com/search/store/${obj.urlPath}?lat=${market.latitude}&lng=${market.longitude}`;
                let success = false;
                
                // Tier definitions
                const tiers = [
                    { type: 'Proxy', useProxy: true, useCookies: true },
                    { type: 'Direct', useProxy: false, useCookies: true },
                    { type: 'Guest', useProxy: false, useCookies: false }
                ];

                for (const tier of tiers) {
                    if (success) break;
                    
                    let context: BrowserContext;
                    const proxy = tier.useProxy ? (process.env.PROXY_URL || getRandomProxy()) : undefined;

                    // Context Creation / Reuse
                    if (tier.type === 'Proxy') {
                        // Proxies need fresh contexts because IP is tied to context
                        context = await browser.newContext({
                            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                            proxy: proxy ? { server: proxy } : undefined,
                            extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
                        });
                    } else if (tier.type === 'Direct') {
                        if (!activeDirectContext) {
                            activeDirectContext = await browser.newContext({
                                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                                extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
                            });
                        }
                        context = activeDirectContext;
                    } else { // Guest
                        if (!activeGuestContext) {
                            activeGuestContext = await browser.newContext({
                                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                                extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
                            });
                        }
                        context = activeGuestContext;
                    }

                    try {
                        let cookiesStr = "";
                        if (tier.useCookies) {
                            cookiesStr = getNextCookies() || "";
                            if (cookiesStr) {
                                const cObjs = cookiesStr.split('; ').map((p: string) => ({
                                    name: p.substring(0, p.indexOf('=')),
                                    value: p.substring(p.indexOf('=') + 1),
                                    domain: '.doordash.com', path: '/',
                                }));
                                await context.addCookies(cObjs);
                            }
                        }

                        const page = await context.newPage();
                        console.log(`  -> [${obj.name}] Tier: ${tier.type} | Proxy: ${proxy ? 'YES' : 'NONE'}`);

                        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
                        const status = response?.status() || 0;

                        if (status === 200) {
                            const html = await page.content();
                            const result = parseListings(html);
                            if (result.status === "SUCCESS") {
                                success = true;
                                successCount++;
                                result.merchants.forEach((m: any) => {
                                    observations.push({
                                        run_id: runId, market_id: market.market_id, city: market.city,
                                        observed_at: now.toISOString(), category: obj.surface === "bestOfLunch" ? "None" : obj.name, 
                                        surface: obj.surface, merchant_name: m.merchant_name, store_id: m.store_id, 
                                        rank: m.rank, is_sponsored: m.is_sponsored, has_discount: m.has_discount, 
                                        discount_type: m.discount_type, delivery_fee: m.delivery_fee, rating: m.rating, 
                                        review_count: m.review_count, offer_title: m.offer_title, raw_snippet: m.raw_snippet
                                    });
                                });
                                console.log(`     ✅ Found ${result.merchants.length}`);
                            } else {
                                console.log(`     ⚠️ Parse: ${result.status}`);
                            }
                        } else {
                            console.log(`     ❌ HTTP ${status}`);
                            if (status === 401 && cookiesStr) markBanned(cookiesStr);
                        }
                        await page.close();
                    } catch (e: any) {
                        console.log(`     💥 Error: ${e.message.split('\n')[0]}`);
                    } finally {
                        // Only close Proxy contexts immediately. Direct/Guest are shared across categories in this market.
                        if (tier.type === 'Proxy') await context.close().catch(() => {});
                    }
                }

                if (!success) {
                    failCount++;
                    lastFailureReason = `${obj.name} failed all tiers`;
                }
            }
            
            // Clean up market-level contexts
            if (activeDirectContext) await activeDirectContext.close().catch(() => {});
            if (activeGuestContext) await activeGuestContext.close().catch(() => {});
        }
    } finally {
        await browser.close().catch(() => {});
    }

    const finalStatus = failCount === 0 ? "SUCCESS" : (successCount > 0 ? "PARTIAL" : "FAILED");
    const runData = {
        run_id: runId, shard: manualShard, shards_total: SHARDS_TOTAL, status: finalStatus,
        started_at: now.toISOString(), ended_at: new Date().toISOString(),
        failure_reason: lastFailureReason, metadata: { successCount, failCount }
    };

    console.log(`\nShard Result: ${finalStatus} (${successCount} S, ${failCount} F)`);
    console.log(`Ingesting ${observations.length} items...`);
    
    await pushToApi(apiUrl, apiKey, { ...runData, status: "INGESTING" }, []);
    const CHUNK = 500;
    for (let i = 0; i < observations.length; i += CHUNK) {
         await pushToApi(apiUrl, apiKey, null, observations.slice(i, i + CHUNK));
    }
    await pushToApi(apiUrl, apiKey, runData, []);

    return finalStatus;
}
