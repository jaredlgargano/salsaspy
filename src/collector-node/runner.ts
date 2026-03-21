import { pushToApi } from "./ingest";
import { parseListings } from "./parseListings";
import { getShard } from "../shared/hash";
import { getNextCookies, markBanned, getAccountCount } from "./cookieRotator";
import { HttpsProxyAgent } from "https-proxy-agent";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getRandomProxy } from "./freeProxy";

chromium.use(StealthPlugin());

const STATE_TZ: Record<string, string> = {
    'AL': 'America/Chicago', 'AK': 'America/Anchorage', 'AZ': 'America/Phoenix', 'AR': 'America/Chicago',
    'CA': 'America/Los_Angeles', 'CO': 'America/Denver', 'CT': 'America/New_York', 'DE': 'America/New_York',
    'FL': 'America/New_York', 'GA': 'America/New_York', 'HI': 'Pacific/Honolulu', 'ID': 'America/Boise',
    'IL': 'America/Chicago', 'IN': 'America/Indiana/Indianapolis', 'IA': 'America/Chicago', 'KS': 'America/Chicago',
    'KY': 'America/New_York', 'LA': 'America/Chicago', 'ME': 'America/New_York', 'MD': 'America/New_York',
    'MA': 'America/New_York', 'MI': 'America/Detroit', 'MN': 'America/Chicago', 'MS': 'America/Chicago',
    'MO': 'America/Chicago', 'MT': 'America/Denver', 'NE': 'America/Chicago', 'NV': 'America/Los_Angeles',
    'NH': 'America/New_York', 'NJ': 'America/New_York', 'NM': 'America/Denver', 'NY': 'America/New_York',
    'NC': 'America/New_York', 'ND': 'America/Chicago', 'OH': 'America/New_York', 'OK': 'America/Chicago',
    'OR': 'America/Los_Angeles', 'PA': 'America/New_York', 'RI': 'America/New_York', 'SC': 'America/New_York',
    'SD': 'America/Chicago', 'TN': 'America/Chicago', 'TX': 'America/Chicago', 'UT': 'America/Denver',
    'VT': 'America/New_York', 'VA': 'America/New_York', 'WA': 'America/Los_Angeles', 'WV': 'America/New_York',
    'WI': 'America/Chicago', 'WY': 'America/Denver', 'DC': 'America/New_York'
};

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
        console.log("No markets found for this shard. (Try manual run without unscraped_only if this is a repeat)");
        // Fallback: fetch without unscraped_only if we explicitly asked for a forced run
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
        console.log("Ultimately no markets found.");
        return "SUCCESS";
    }

    console.log(`Processing ${markets.length} markets for Shard ${manualShard}.`);
    
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });

    let successCount = 0;
    let failCount = 0;
    let lastFailureReason: string = "";
    const observations: any[] = [];
    const categories = ["", "Healthy", "Mexican", "Salad", "Chicken"];

    try {
        for (const market of markets) {
            console.log(`\n🌎 Market: ${market.city}, ${market.state} (${market.latitude}, ${market.longitude})`);

            for (const category of categories) {
                const categoryName = category === "" ? "Base Search" : category;
                const pathExt = category === "" ? "Restaurants/" : `${encodeURIComponent(category)}/`;
                const url = `https://www.doordash.com/search/store/${pathExt}?lat=${market.latitude}&lng=${market.longitude}`;

                let success = false;
                const tiers = [
                    { type: 'Proxy+Auth', useProxy: true, useCookies: true },
                    { type: 'Direct+Auth', useProxy: false, useCookies: true },
                    { type: 'Direct+Guest', useProxy: false, useCookies: false }
                ];

                for (const tier of tiers) {
                    if (success) break;
                    
                    const proxy = tier.useProxy ? (process.env.PROXY_URL || getRandomProxy()) : undefined;
                    console.log(`  -> Tier: ${tier.type} | Proxy: ${proxy || 'NONE'}`);

                    const context = await browser.newContext({
                        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        viewport: { width: 1280, height: 800 },
                        proxy: proxy ? { server: proxy } : undefined,
                        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
                    });

                    try {
                        let cookiesStr = "";
                        if (tier.useCookies) {
                            cookiesStr = getNextCookies() || "";
                            if (cookiesStr) {
                                const cObjs = cookiesStr.split('; ').map((p: string) => ({
                                    name: p.substring(0, p.indexOf('=')),
                                    value: p.substring(p.indexOf('=') + 1),
                                    domain: '.doordash.com',
                                    path: '/',
                                }));
                                await context.addCookies(cObjs);
                            }
                        }

                        const page = await context.newPage();
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
                                        observed_at: now.toISOString(), category: categoryName, surface: "searchCategory",
                                        merchant_name: m.merchant_name, store_id: m.store_id, rank: m.rank,
                                        is_sponsored: m.is_sponsored, has_discount: m.has_discount, discount_type: m.discount_type,
                                        delivery_fee: m.delivery_fee, rating: m.rating, review_count: m.review_count,
                                        offer_title: m.offer_title, raw_snippet: m.raw_snippet
                                    });
                                });
                                console.log(`     ✅ SUCCESS: ${result.merchants.length} merchants found.`);
                            } else {
                                console.log(`     ⚠️ Parse Failed (${result.status})`);
                            }
                        } else {
                            console.log(`     ❌ HTTP ${status} (${response?.statusText()})`);
                            if (status === 401 && cookiesStr) markBanned(cookiesStr);
                            if (status === 403) {
                                const snippet = (await page.content()).substring(0, 200).replace(/\n/g, ' ');
                                console.log(`     🚩 403 Detail: ${snippet}`);
                            }
                        }
                    } catch (e: any) {
                        console.log(`     💥 Error: ${e.message.substring(0, 100)}`);
                    } finally {
                        await context.close();
                    }
                }

                if (!success) {
                    failCount++;
                    lastFailureReason = "All tiers failed";
                }
            }
        }
    } finally {
        await browser.close();
    }

    // Final status and ingestion
    const finalStatus = failCount === 0 ? "SUCCESS" : (successCount > 0 ? "PARTIAL" : "FAILED");
    const runData = {
        run_id: runId, shard: manualShard, shards_total: SHARDS_TOTAL, status: finalStatus,
        started_at: now.toISOString(), ended_at: new Date().toISOString(),
        failure_reason: lastFailureReason, metadata: { successCount, failCount }
    };

    console.log(`\nFinal Shard Status: ${finalStatus} (${successCount} successful, ${failCount} failed)`);
    console.log(`Ingesting ${observations.length} items...`);
    
    await pushToApi(apiUrl, apiKey, { ...runData, status: "INGESTING" }, []);
    const CHUNK = 500;
    for (let i = 0; i < observations.length; i += CHUNK) {
         await pushToApi(apiUrl, apiKey, null, observations.slice(i, i + CHUNK));
    }
    await pushToApi(apiUrl, apiKey, runData, []);

    return finalStatus;
}
