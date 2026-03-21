import { pushToApi } from "./ingest";
import { parseListings } from "./parseListings";
import { getNextCookies, markBanned } from "./cookieRotator";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getRandomProxy } from "./freeProxy";
import { Browser, BrowserContext, Page } from "playwright";

chromium.use(StealthPlugin());

async function scrollToEnd(page: Page) {
    await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 400;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= scrollHeight || totalHeight > 6000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

export async function runShard(apiUrl: string, apiKey: string, now: Date, runId: string, manualShard: number): Promise<string> {
    console.log(`Starting runShard for shard ${manualShard}`);
    const SHARDS_TOTAL = parseInt(process.env.SHARDS_TOTAL || "100");
    const FORCE = process.env.FORCE_SCRAPE === "1";
    
    const urlParams = `shard=${manualShard}&shards_total=${SHARDS_TOTAL}&active=1${FORCE ? '' : '&unscraped_only=1'}`;
    const marketRes = await fetch(`${apiUrl}/v1/markets?${urlParams}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    if (!marketRes.ok) return "FAILED";

    let { markets } = await marketRes.json() as { markets: any[] };
    if (markets.length === 0) return "SUCCESS";

    console.log(`Processing ${markets.length} markets for Shard ${manualShard}.`);
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] 
    });

    let successCount = 0;
    let failCount = 0;
    let lastFailureReason: string = "";
    const observations: any[] = [];
    
    // Final Optimized Objectives
    const objectives = [
        { name: "Home", path: "", surface: "searchCategory" as const },
        { name: "Healthy", path: "search/food/healthy/", surface: "searchCategory" as const },
        { name: "Mexican", path: "search/food/mexican/", surface: "searchCategory" as const },
        { name: "Salad", path: "search/food/salad/", surface: "searchCategory" as const },
        { name: "Chicken", path: "search/food/chicken/", surface: "searchCategory" as const },
        { name: "Best of Lunch", path: "search/food/best-of-lunch/", surface: "bestOfLunch" as const }
    ];

    try {
        for (const market of markets) {
            console.log(`\n🌎 Market: ${market.city}`);
            let directContext: BrowserContext | null = null;
            let guestContext: BrowserContext | null = null;

            for (const obj of objectives) {
                const url = `https://www.doordash.com/${obj.path}?lat=${market.latitude}&lng=${market.longitude}`;
                let success = false;
                
                // Tier Strategy: 3 Proxies -> 1 Direct -> 1 Guest
                const tiers = [
                    { type: 'Proxy', useProxy: true, useCookies: true, retries: 3 },
                    { type: 'Direct', useProxy: false, useCookies: true, retries: 1 },
                    { type: 'Guest', useProxy: false, useCookies: false, retries: 1 }
                ];

                for (const tier of tiers) {
                    if (success) break;
                    
                    for (let r = 0; r < tier.retries; r++) {
                        if (success) break;
                        const proxy = tier.useProxy ? (process.env.PROXY_URL || getRandomProxy()) : undefined;
                        
                        let context: BrowserContext;
                        if (tier.type === 'Proxy') {
                            context = await browser.newContext({
                                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                                proxy: proxy ? { server: proxy } : undefined,
                            });
                        } else if (tier.type === 'Direct') {
                            if (!directContext) directContext = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' });
                            context = directContext;
                        } else {
                            if (!guestContext) guestContext = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' });
                            context = guestContext;
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
                            console.log(`  -> [${obj.name}] Tier: ${tier.type} (Try ${r+1}/${tier.retries}) | Proxy: ${proxy ? 'YES' : 'NONE'}`);

                            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
                            const status = response?.status() || 0;

                            if (status === 200) {
                                await page.waitForTimeout(3000);
                                await scrollToEnd(page);
                                await page.waitForTimeout(1000);

                                const html = await page.content();
                                const result = parseListings(html);
                                if (result.status === "SUCCESS") {
                                    success = true;
                                    successCount++;
                                    result.merchants.forEach((m: any) => {
                                        observations.push({
                                            run_id: runId, market_id: market.market_id, city: market.city,
                                            observed_at: now.toISOString(), category: obj.surface === "bestOfLunch" ? "None" : (obj.name === "Home" ? "None" : obj.name), 
                                            surface: obj.surface, merchant_name: m.merchant_name, store_id: m.store_id, 
                                            rank: m.rank, is_sponsored: m.is_sponsored, has_discount: m.has_discount, 
                                            delivery_fee: m.delivery_fee, rating: m.rating, review_count: m.review_count,
                                            raw_snippet: m.raw_snippet
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
                            if (tier.type === 'Proxy') await context.close().catch(() => {});
                        }
                    }
                }

                if (!success) {
                    failCount++;
                    lastFailureReason = `${obj.name} failed all tiers`;
                }
            }
            if (directContext) await directContext.close().catch(() => {});
            if (guestContext) await guestContext.close().catch(() => {});
        }
    } finally {
        await browser.close().catch(() => {});
    }

    const finalStatus = failCount === 0 ? "SUCCESS" : (successCount > 0 ? "PARTIAL" : "FAILED");
    const runData = {
        run_id: runId, shard: manualShard, shard_total: SHARDS_TOTAL, status: finalStatus,
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
