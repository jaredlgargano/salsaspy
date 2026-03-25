import { pushToApi } from "./ingest";
import { parseListings } from "./parseListings";
import { getNextCookies, markBanned } from "./cookieRotator";
import { getRandomProxy } from "./freeProxy";

export async function runShard(apiUrl: string, apiKey: string, now: Date, runId: string, manualShard: number): Promise<string> {
    console.log(`Starting runShard (Browser-Free) for shard ${manualShard}`);
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

    let successCount = 0;
    let failCount = 0;
    let lastFailureReason: string = "";
    const observations: any[] = [];
    
    // Final Optimized Objectives
    const objectives = [
        { name: "Home", path: "", surface: "searchCategory" as const },
        { name: "Healthy", path: "search/store/healthy/", surface: "searchCategory" as const },
        { name: "Mexican", path: "search/store/mexican/", surface: "searchCategory" as const },
        { name: "Salad", path: "search/store/salad/", surface: "searchCategory" as const },
        { name: "Chicken", path: "search/store/chicken/", surface: "searchCategory" as const },
        { name: "Best of Lunch", path: "search/store/best-of-lunch/", surface: "bestOfLunch" as const }
    ];

    for (const market of markets) {
        console.log(`\n🌎 Market: ${market.city}`);

        for (const obj of objectives) {
            const url = `https://www.doordash.com/${obj.path}?lat=${market.latitude}&lng=${market.longitude}`;
            let success = false;
            
            // Production Strategy: Direct -> Proxy -> Guest (all using got-scraping)
            const tiers = [
                { type: 'Direct', useProxy: false, useCookies: true, retries: 1 },
                { type: 'Proxy', useProxy: true, useCookies: true, retries: 3 },
                { type: 'Guest', useProxy: false, useCookies: false, retries: 1 }
            ];

            for (const tier of tiers) {
                if (success) break;
                
                for (let r = 0; r < tier.retries; r++) {
                    if (success) break;
                    const proxy = tier.useProxy ? (process.env.PROXY_URL || getRandomProxy()) : undefined;
                    
                    console.log(`  -> [${obj.name}] Tier: ${tier.type} (Try ${r+1}/${tier.retries}) | Proxy: ${proxy ? 'YES' : 'NONE'}`);
                    try {
                        const { gotScraping } = await import('got-scraping');
                        const cookiesStr = tier.useCookies ? (getNextCookies() || "") : "";
                        
                        const response = await gotScraping({
                            url,
                            proxyUrl: proxy || undefined,
                            headers: cookiesStr ? { 'Cookie': cookiesStr } : {},
                            headerGeneratorOptions: { browsers: ['chrome'], os: ['macos', 'windows'] },
                            timeout: { request: 20000 }
                        });

                        if (response.statusCode === 200) {
                            const result = parseListings(response.body);
                            if (result.status === "SUCCESS") {
                                console.log(`     ✅ Found ${result.merchants.length}`);
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
                                console.log(`     ⚠️  Parse: ${result.status}`);
                            }
                        } else if (response.statusCode === 401 && cookiesStr) {
                            markBanned(cookiesStr);
                        } else if (response.statusCode === 403) {
                            console.log(`     ⚠️  HTTP 403 (Blocked IP or Session) - Switching Tier`);
                            // Break the retry loop for this tier on 403 to move to next tier faster
                            break; 
                        }
                    } catch (e: any) {
                        console.log(`     💥 Error: ${e.message.split('\n')[0]}`);
                    }
                }
            }

            if (!success) {
                failCount++;
                lastFailureReason = `${obj.name} failed all tiers`;
            }
        }
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
