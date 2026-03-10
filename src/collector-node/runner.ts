import { pushToApi } from "./ingest";
import { parseListings } from "./parseListings";
import { getShard } from "../shared/hash";
import fs from "fs";

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

export async function runShard(apiUrl: string, apiKey: string, now: Date, runId: string, manualShard: number) {
    console.log(`Fetching active markets from ${apiUrl}`);

    // Dynamic import for pure ESM got-scraping package
    const { gotScraping } = await import('got-scraping');

    // 1. Fetch Markets
    const marketsRes = await fetch(`${apiUrl}/v1/markets?active=1`);
    if (!marketsRes.ok) {
        throw new Error(`Failed to fetch markets. Is API running? ${marketsRes.statusText}`);
    }
    const marketsData: any = await marketsRes.json();
    const allMarkets = marketsData.markets || [];

    const SHARDS_TOTAL = 20;
    const myMarkets = allMarkets.filter((m: any) => {
        if (manualShard !== -1 && getShard(m.market_id, SHARDS_TOTAL) !== manualShard) return false;

        // Timezone check for 12:00 PM (12:00 - 12:59)
        const tz = STATE_TZ[m.state] || 'America/New_York';
        const localHour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(now));

        return true; // Bypass 12PM strict restriction for manual local hydrate run
    });

    console.log(`Found ${myMarkets.length} markets for shard ${manualShard} at local 12:00 PM`);
    if (myMarkets.length === 0) return;

    // No proxy APIs required, Cloudflare is natively bypassed

    let successCount = 0;
    let failCount = 0;
    let lastFailureReason: string = "";
    const observations: any[] = [];

    const categories = ["", "Healthy", "Mexican", "Salad", "Chicken"];

    // Build the request queue
    const requestQueue: (() => Promise<void>)[] = [];

    for (const market of myMarkets) {

        // Search Categories
        for (const category of categories) {
            const categoryName = category === "" ? "Base Search" : category;
            const pathExt = category === "" ? "Restaurants/" : `${encodeURIComponent(category)}/`;
            const url = `https://www.doordash.com/search/store/${pathExt}?lat=${market.latitude}&lng=${market.longitude}`;

            requestQueue.push(async () => {
                let attempts = 0;
                let success = false;
                while (attempts < 3 && !success) {
                    attempts++;
                    try {
                        const res = await gotScraping({
                            url: url,
                            headerGeneratorOptions: { browsers: ['chrome'], os: ['macos'] },
                            timeout: { request: 30000 }
                        });

                        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
                        const html = res.body;
                        const result = parseListings(html);

                        if (result.status === "SUCCESS") {
                            // Extract Data
                            if (result.merchants.length < 20) {
                                console.log(` -> Anomaly: category ${categoryName} had < 20 results`);
                            }

                            const sponsoredCount = result.merchants.filter(m => m.is_sponsored).length;
                            if (sponsoredCount === 0) {
                                console.log(` -> Anomaly: category ${categoryName} had ZERO sponsored listings`);
                            }

                            successCount++;
                            success = true; // Break the retry loop
                            result.merchants.forEach(m => {
                                observations.push({
                                    run_id: runId,
                                    market_id: market.market_id,
                                    city: market.city,
                                    observed_at: now.toISOString(),
                                    category: categoryName,
                                    surface: "searchCategory",
                                    merchant_name: m.merchant_name,
                                    store_id: m.store_id,
                                    rank: m.rank,
                                    is_sponsored: m.is_sponsored,
                                    has_discount: m.has_discount,
                                    discount_type: m.discount_type,
                                    delivery_fee: m.delivery_fee,
                                    rating: m.rating,
                                    review_count: m.review_count,
                                    offer_title: m.offer_title,
                                    raw_snippet: m.raw_snippet
                                });
                            });
                            console.log(` -> Found ${result.merchants.length} merchants in ${market.city} (${categoryName}).`);
                        } else {
                            if (attempts === 3) {
                                failCount++;
                                lastFailureReason = result.status;
                                console.log(` -> Failed parse ${category} in ${market.city} after 3 attempts: ${result.status}`);
                                fs.writeFileSync(`test_dd_${market.city}.html`, html);
                            } else {
                                console.log(` -> Failed parse ${category} in ${market.city}: ${result.status} (Attempt ${attempts}/3). Retrying...`);
                                await new Promise(r => setTimeout(r, 3000));
                            }
                        }
                    } catch (e: any) {
                        if (attempts === 3) {
                            failCount++;
                            lastFailureReason = e.message;
                            console.log(` -> Navigation error in ${market.city} (${categoryName}) after 3 attempts: ${e.message}`);
                        } else {
                            console.log(` -> Timeout/Error in ${market.city} (${categoryName}): ${e.message} (Attempt ${attempts}/3). Retrying...`);
                            await new Promise(r => setTimeout(r, 3000)); // Sleep before retry
                        }
                    }
                }
            });
        }

        // Best of Lunch
        const lunchUrl = `https://www.doordash.com/home/?lat=${market.latitude}&lng=${market.longitude}`;

        requestQueue.push(async () => {
            let attempts = 0;
            let success = false;
            while (attempts < 3 && !success) {
                attempts++;
                try {
                    const res = await gotScraping({
                        url: lunchUrl,
                        headerGeneratorOptions: { browsers: ['chrome'], os: ['macos'] },
                        timeout: { request: 30000 }
                    });

                    if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
                    const html = res.body;
                    const result = parseListings(html);

                    if (result.status === "SUCCESS") {
                        if (result.merchants.length < 20) failCount++;
                        if (result.merchants.filter(m => m.is_sponsored).length === 0) failCount++;

                        successCount++;
                        success = true; // Break out of retry loop
                        result.merchants.forEach(m => {
                            observations.push({
                                run_id: runId,
                                market_id: market.market_id,
                                city: market.city,
                                observed_at: now.toISOString(),
                                category: "None",
                                surface: "bestOfLunch",
                                merchant_name: m.merchant_name,
                                store_id: m.store_id,
                                rank: m.rank,
                                is_sponsored: m.is_sponsored,
                                has_discount: m.has_discount,
                                discount_type: m.discount_type,
                                delivery_fee: m.delivery_fee,
                                rating: m.rating,
                                review_count: m.review_count,
                                offer_title: m.offer_title,
                                raw_snippet: m.raw_snippet
                            });
                        });
                        console.log(` -> Found ${result.merchants.length} merchants in ${market.city} (Best of Lunch).`);
                    } else {
                        if (attempts === 3) {
                            failCount++;
                            lastFailureReason = result.status;
                            console.log(` -> Failed parse Best of Lunch in ${market.city} after 3 attempts: ${result.status}`);
                        } else {
                            console.log(` -> Failed parse Best of Lunch in ${market.city}: ${result.status} (Attempt ${attempts}/3). Retrying...`);
                            await new Promise(r => setTimeout(r, 3000));
                        }
                    }
                } catch (e: any) {
                    if (attempts === 3) {
                        failCount++;
                        lastFailureReason = e.message;
                        console.log(` -> Navigation error in ${market.city} (Best of Lunch) after 3 attempts: ${e.message}`);
                    } else {
                        console.log(` -> Timeout/Error in ${market.city} (Best of Lunch): ${e.message} (Attempt ${attempts}/3). Retrying...`);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                }
            }
        });
    }

    console.log(`Executing ${requestQueue.length} scraper requests in parallel batches (size 5)...`);
    const BATCH_SIZE = 5;
    for (let i = 0; i < requestQueue.length; i += BATCH_SIZE) {
        const batch = requestQueue.slice(i, i + BATCH_SIZE);
        console.log(` -> Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(requestQueue.length / BATCH_SIZE)} (${batch.length} requests)`);
        await Promise.all(batch.map(fn => fn()));

        // Brief pause between batches to be respectful
        if (i + BATCH_SIZE < requestQueue.length) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    const finalStatus = failCount === 0 ? "SUCCESS" : (successCount > 0 ? "PARTIAL" : "FAILED");

    const runData = {
        run_id: runId,
        started_at: now.toISOString(),
        ended_at: new Date().toISOString(),
        shard: manualShard,
        shards_total: SHARDS_TOTAL,
        status: finalStatus,
        failure_reason: lastFailureReason,
        metadata: { successCount, failCount }
    };

    console.log(`Ingesting ${observations.length} observations to API...`);
    await pushToApi(apiUrl, apiKey, runData, observations);
    console.log(`Ingest complete. Status: ${finalStatus}`);
}
