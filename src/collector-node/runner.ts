import { pushToApi } from "./ingest";
import { parseListings } from "./parseListings";
import { getShard } from "../shared/hash";
import { getNextCookies, markBanned, getAccountCount } from "./cookieRotator";
import { HttpsProxyAgent } from "https-proxy-agent";
import { getRandomProxy } from "./freeProxy";

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
    console.log(`Fetching active markets from ${apiUrl}`);

    // Dynamic import for pure ESM got-scraping package
    const { gotScraping } = await import('got-scraping');

    const SHARDS_TOTAL = parseInt(process.env.SHARDS_TOTAL || "100");
    const proxyUrl = process.env.PROXY_URL;
    const baseAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

    // 1. Fetch Markets
    // Use unscraped_only=1 to ensure we don't double-scrape markets during the broadened window
    const marketRes = await fetch(`${apiUrl}/v1/markets?shard=${manualShard}&shards_total=${SHARDS_TOTAL}&active=1&unscraped_only=1`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    if (!marketRes.ok) {
        console.error(`Failed to fetch markets: ${marketRes.status} ${marketRes.statusText}`);
        const text = await marketRes.text();
        console.error(`Response body: ${text}`);
        return "FAILED";
    }

    const { markets } = await marketRes.json() as { markets: any[] };
    const allMarkets = markets || [];

    const myMarkets = allMarkets.filter((m: any) => {
        // Sharding is now handled by the API query
        
        // Timezone check for 12:00 PM or 1:00 PM (to account for GitHub Action delays)
        const tz = STATE_TZ[m.state] || 'America/New_York';
        const localHour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(now));

        return localHour === 12 || localHour === 13;
    });

    console.log(`Found ${myMarkets.length} markets for shard ${manualShard} at local 12:00 PM`);
    // Removed early return; we always want to report a run status to the API

    // No proxy APIs required, Cloudflare is natively bypassed

    // Prioritize top markets (highest ad density) so they get processed first
    const TOP_MARKETS = new Set([
        'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia',
        'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Jacksonville',
        'Fort Worth', 'Columbus', 'Charlotte', 'Indianapolis', 'San Francisco',
        'Seattle', 'Denver', 'Nashville', 'Oklahoma City', 'Las Vegas', 'Portland',
        'Memphis', 'Louisville', 'Baltimore', 'Milwaukee', 'Albuquerque', 'Tucson',
        'Fresno', 'Sacramento', 'Kansas City', 'Mesa', 'Atlanta', 'Omaha',
        'Colorado Springs', 'Raleigh', 'Long Beach', 'Virginia Beach', 'Minneapolis'
    ]);

    const prioritizedMarkets = [
        ...myMarkets.filter((m: any) => TOP_MARKETS.has(m.city)),
        ...myMarkets.filter((m: any) => !TOP_MARKETS.has(m.city))
    ];
    const topCount = prioritizedMarkets.filter((m: any) => TOP_MARKETS.has(m.city)).length;
    if (topCount > 0) console.log(` -> ${topCount} top-priority metros will be processed first.`);

    let successCount = 0;
    let failCount = 0;
    let lastFailureReason: string = "";
    const observations: any[] = [];

    const categories = ["", "Healthy", "Mexican", "Salad", "Chicken"];

    // Build the request queue
    const requestQueue: (() => Promise<void>)[] = [];

    for (const market of prioritizedMarkets) {

        // Search Categories
        for (const category of categories) {
            const categoryName = category === "" ? "Base Search" : category;
            const pathExt = category === "" ? "Restaurants/" : `${encodeURIComponent(category)}/`;
            const url = `https://www.doordash.com/search/store/${pathExt}?lat=${market.latitude}&lng=${market.longitude}`;

            requestQueue.push(async () => {
                let attempts = 0;
                let success = false;
                while (attempts < 10 && !success) {
                    attempts++;
                    try {
                        const cookies = getNextCookies();
                        const headers: Record<string, string> = {};
                        if (cookies) headers['Cookie'] = cookies;

                        let currentAgent = baseAgent;
                        if (!currentAgent && !proxyUrl) {
                            const fp = getRandomProxy();
                            if (fp) currentAgent = new HttpsProxyAgent(fp);
                        }

                        const res = await gotScraping({
                            url: url,
                            headerGeneratorOptions: { browsers: ['chrome'], os: ['macos'] },
                            headers,
                            agent: currentAgent ? { https: currentAgent, http: currentAgent } : undefined,
                            timeout: { request: 15000 }
                        });

                        // If account was flagged, mark it banned and retry unauthenticated
                        if (res.statusCode === 401 || res.statusCode === 403) {
                            const isBan = res.statusCode === 401 || res.body.includes('login') || res.body.includes('verification');
                            if (cookies && isBan) {
                                markBanned(cookies);
                                console.log(` -> Account flagged (Status ${res.statusCode}), marked as banned. Retrying unauthenticated...`);
                            } else if (res.statusCode === 403) {
                                console.log(` -> HTTP 403 (Forbidden) received. This might be a proxy/IP block. Not marking account as banned yet.`);
                            }
                            throw new Error(`HTTP ${res.statusCode}`);
                        }

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
                            result.merchants.forEach((m, i) => {
                                if (i < 5) {
                                    console.log(`Sample Merchant: ${m.merchant_name} | Sponsored: ${m.is_sponsored} | Has Discount: ${m.has_discount} | Offer: ${m.offer_title}`);
                                }
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
                            if (attempts === 10) {
                                failCount++;
                                lastFailureReason = result.status;
                                console.log(` -> Failed parse ${category} in ${market.city} after 10 attempts: ${result.status}`);
                            } else {
                                console.log(` -> Failed parse ${category} in ${market.city}: ${result.status} (Attempt ${attempts}/10). Retrying...`);
                                await new Promise(r => setTimeout(r, 1000));
                            }
                        }
                    } catch (e: any) {
                        if (attempts === 10) {
                            failCount++;
                            lastFailureReason = e.message;
                            console.log(` -> Navigation error in ${market.city} (${categoryName}) after 10 attempts: ${e.message}`);
                        } else {
                            let sleepTime = 1000;
                            if (e.message.includes('429')) {
                                sleepTime = 2500 * attempts;
                                console.log(` -> Rate limited (429) in ${market.city} (${categoryName}). Sleeping for ${sleepTime}ms...`);
                            } else {
                                console.log(` -> Timeout/Error in ${market.city} (${categoryName}): ${e.message.substring(0, 100)} (Attempt ${attempts}/10).`);
                            }
                            await new Promise(r => setTimeout(r, sleepTime)); // Sleep before retry
                        }
                    }
                }
            });
        }

        // Best of Lunch - Use the search-based path which is more reliable than /home/
        const lunchUrl = `https://www.doordash.com/search/store/best%20of%20lunch/?lat=${market.latitude}&lng=${market.longitude}`;

        requestQueue.push(async () => {
            let attempts = 0;
            let success = false;
            while (attempts < 10 && !success) {
                attempts++;
                try {
                    let currentAgent = baseAgent;
                    if (!currentAgent && !proxyUrl) {
                        const fp = getRandomProxy();
                        if (fp) currentAgent = new HttpsProxyAgent(fp);
                    }

                    const res = await gotScraping({
                        url: lunchUrl,
                        headerGeneratorOptions: { browsers: ['chrome'], os: ['macos'] },
                        agent: currentAgent ? { https: currentAgent, http: currentAgent } : undefined,
                        timeout: { request: 15000 }
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
                        if (attempts === 10) {
                            failCount++;
                            lastFailureReason = result.status;
                            console.log(` -> Failed parse Best of Lunch in ${market.city} after 10 attempts: ${result.status}`);
                        } else {
                            console.log(` -> Failed parse Best of Lunch in ${market.city}: ${result.status} (Attempt ${attempts}/10). Retrying...`);
                            await new Promise(r => setTimeout(r, 1000));
                        }
                    }
                } catch (e: any) {
                    if (attempts === 10) {
                        failCount++;
                        lastFailureReason = e.message;
                        console.log(` -> Navigation error in ${market.city} (Best of Lunch) after 10 attempts: ${e.message}`);
                    } else {
                        let sleepTime = 1000;
                        if (e.message.includes('429')) {
                            sleepTime = 2500 * attempts;
                            console.log(` -> Rate limited (429) in ${market.city} (Best of Lunch). Sleeping for ${sleepTime}ms...`);
                        } else {
                            console.log(` -> Timeout/Error in ${market.city} (Best of Lunch): ${e.message.substring(0, 100)} (Attempt ${attempts}/10).`);
                        }
                        await new Promise(r => setTimeout(r, sleepTime));
                    }
                }
            }
        });
    }

    console.log(`Executing ${requestQueue.length} scraper requests in parallel batches (size 2)...`);
    const BATCH_SIZE = 2;
    for (let i = 0; i < requestQueue.length; i += BATCH_SIZE) {
        const batch = requestQueue.slice(i, i + BATCH_SIZE);
        console.log(` -> Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(requestQueue.length / BATCH_SIZE)} (${batch.length} requests)`);
        await Promise.all(batch.map(fn => fn()));

        // Brief pause between batches to be respectful
        if (i + BATCH_SIZE < requestQueue.length) {
            await new Promise(resolve => setTimeout(resolve, 3000));
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
    
    return finalStatus;
}
