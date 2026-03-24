import { pushToApi } from "./ingest";
import { parseListings } from "./parseListings";
import { getNextCookies, markBanned } from "./cookieRotator";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getRandomProxy } from "./freeProxy";
import { Browser, BrowserContext, Page } from "playwright";
import { gotScraping } from 'got-scraping';

chromium.use(StealthPlugin());

async function scrollToEnd(page: Page) {
    await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 400;
            const timer = setInterval(() => {
                const scrollHeight = (document as any).body.scrollHeight;
                (window as any).scrollBy(0, distance);
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
                
                // Tier Strategy: 10 Free Proxies -> 1 Direct -> 1 Guest
                const tiers = [
                    { type: 'Proxy', useProxy: true, useCookies: true, retries: 10 },
                    { type: 'Direct', useProxy: false, useCookies: true, retries: 1 },
                    { type: 'Guest', useProxy: false, useCookies: false, retries: 1 }
                ];

                for (const tier of tiers) {
                    if (success) break;
                    
                    for (let r = 0; r < tier.retries; r++) {
                        if (success) break;
                        const proxy = tier.useProxy ? (process.env.PROXY_URL || getRandomProxy()) : undefined;
                        
                        // --- Tier Path: GOT-SCRAPING (Free Stealth Path) ---
                        if (tier.type === 'Proxy') {
                            console.log(`  -> [${obj.name}] Tier: Proxy (Try ${r+1}/${tier.retries}) | Proxy: ${proxy ? 'YES' : 'NONE'}`);
                            try {
                                const cookiesStr = getNextCookies() || "";
                                const response = await gotScraping({
                                    url,
                                    proxyUrl: proxy || undefined,
                                    headers: cookiesStr ? { 'Cookie': cookiesStr } : {},
                                    headerGeneratorOptions: { browsers: ['chrome'], os: ['macos', 'windows'] },
                                    timeout: { request: 15000 }
                                });

                                if (response.statusCode === 200) {
                                    const result = parseListings(response.body);
                                    if (result.status === "SUCCESS") {
                                        console.log(`     ✅ GOT Success: Found ${result.merchants.length}`);
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
                                        break;
                                    } else {
                                        console.log(`     ⚠️ GOT Parse: ${result.status}`);
                                    }
                                } else if (response.statusCode === 401 && cookiesStr) {
                                    markBanned(cookiesStr);
                                }
                            } catch (e: any) {
                                console.log(`     💥 GOT Error: ${e.message.split('\n')[0]}`);
                                if (e.message.includes('exhausted')) {
                                     console.log('     🛑 ScraperAPI Credits Exhausted. Continuing with free proxies...');
                                }
                            }
                            continue;
                        }

                        // --- Tier Path: PLAYWRIGHT (Direct/Guest Path) ---
                        let context: BrowserContext;
                        const MODERN_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
                        
                        let proxyConfig: any = proxy ? { server: proxy } : undefined;
                        
                        if (tier.type === 'Proxy') {
                            context = await browser.newContext({
                                userAgent: MODERN_UA,
                                proxy: proxyConfig,
                            });
                        } else if (tier.type === 'Direct') {
                            if (!directContext) directContext = await browser.newContext({ userAgent: MODERN_UA });
                            context = directContext;
                        } else {
                            if (!guestContext) guestContext = await browser.newContext({ userAgent: MODERN_UA });
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
                            // Block heavy assets to speed up navigation and prevent timeouts
                            await page.route('**/*.{png,jpg,jpeg,gif,svg,webp,css,woff,woff2,ttf,otf}', route => route.abort());
                            await page.route('**/google-analytics.com/**', route => route.abort());
                            await page.route('**/doubleclick.net/**', route => route.abort());

                            console.log(`  -> [${obj.name}] Tier: ${tier.type} (Try ${r+1}/${tier.retries}) | Proxy: ${proxy ? 'YES' : 'NONE'}`);

                            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
                            const status = response?.status() || 0;

                            if (status === 200) {
                                await page.waitForTimeout(3000);
                                
                                const preScrollHtml = await page.content();
                                const preScrollResult = parseListings(preScrollHtml);
                                console.log(`     📊 Audit: Static count = ${preScrollResult.merchants.length}`);

                                await scrollToEnd(page);
                                await page.waitForTimeout(1000);

                                const html = await page.content();
                                const result = parseListings(html);
                                console.log(`     ✅ Audit: Final count = ${result.merchants.length} (+${result.merchants.length - preScrollResult.merchants.length})`);

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
                            const errMsg = e.message.split('\n')[0];
                            console.log(`     💥 Error: ${errMsg}`);
                            if (errMsg.includes('net::ERR_CONNECTION_CLOSED') || errMsg.includes('net::ERR_PROXY_CONNECTION_FAILED')) {
                                console.log(`     🔄 Connection closed/failed. Retrying with fresh proxy...`);
                                await new Promise(r => setTimeout(r, 1000));
                            } else {
                                await new Promise(r => setTimeout(r, 2000));
                            }
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
