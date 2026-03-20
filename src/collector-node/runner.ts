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
    const marketRes = await fetch(`${apiUrl}/v1/markets?shard=${manualShard}&shards_total=${SHARDS_TOTAL}&active=1&unscraped_only=1`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    if (!marketRes.ok) {
        console.error(`Failed to fetch markets: ${marketRes.status}`);
        return "FAILED";
    }

    const { markets } = await marketRes.json() as { markets: any[] };
    if (!markets || markets.length === 0) {
        console.log("No markets found for this shard.");
        return "SUCCESS";
    }

    const FORCE_SCRAPE = process.env.FORCE_SCRAPE === "1";
    const prioritizedMarkets = markets.filter((m: any) => {
        if (FORCE_SCRAPE) return true;
        const tz = STATE_TZ[m.state] || 'America/New_York';
        const localHour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(now));
        return localHour === 12 || localHour === 13;
    });

    console.log(`Processing ${prioritizedMarkets.length} markets.`);
    
    // Launch ONE browser for the entire shard
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
        for (const market of prioritizedMarkets) {
            console.log(`Market: ${market.city}, ${market.state}`);

            for (const category of categories) {
                const categoryName = category === "" ? "Base Search" : category;
                const pathExt = category === "" ? "Restaurants/" : `${encodeURIComponent(category)}/`;
                const url = `https://www.doordash.com/search/store/${pathExt}?lat=${market.latitude}&lng=${market.longitude}`;

                let attempts = 0;
                let success = false;

                while (attempts < 5 && !success) {
                    attempts++;
                    const context = await browser.newContext({
                        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        viewport: { width: 1280, height: 800 }
                    });

                    try {
                        const cookies = getNextCookies();
                        if (cookies) {
                            const cookieObjects = cookies.split('; ').map((pair: string) => {
                                const eqIdx = pair.indexOf('=');
                                return {
                                    name: pair.substring(0, eqIdx),
                                    value: pair.substring(eqIdx + 1),
                                    domain: '.doordash.com',
                                    path: '/',
                                };
                            });
                            await context.addCookies(cookieObjects);
                        }

                        const page = await context.newPage();
                        // Jitter
                        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

                        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        const status = response?.status() || 0;

                        if (status === 200) {
                            const html = await page.content();
                            const result = parseListings(html);
                            if (result.status === "SUCCESS") {
                                successCount++;
                                success = true;
                                result.merchants.forEach((m: any) => {
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
                                console.log(` -> ${categoryName}: Found ${result.merchants.length}`);
                            } else {
                                throw new Error(`Parse failed: ${result.status}`);
                            }
                        } else {
                            if (status === 401 || status === 403) {
                                if (cookies && status === 401) markBanned(cookies);
                                console.log(` -> HTTP ${status}. Rotating identity...`);
                            }
                            throw new Error(`HTTP ${status}`);
                        }
                    } catch (e: any) {
                        if (attempts === 5) {
                            failCount++;
                            lastFailureReason = e.message;
                            console.log(` -> Failed ${categoryName} after ${attempts} attempts: ${e.message}`);
                        } else {
                            await new Promise(r => setTimeout(r, 2000));
                        }
                    } finally {
                        await context.close();
                    }
                }
            }

            // Best of Lunch
            const lunchUrl = `https://www.doordash.com/search/store/best%20of%20lunch/?lat=${market.latitude}&lng=${market.longitude}`;
            let lAttempts = 0;
            let lSuccess = false;

            while (lAttempts < 5 && !lSuccess) {
                lAttempts++;
                const lContext = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' });
                try {
                    const lCookies = getNextCookies();
                    if (lCookies) {
                        const cObjs = lCookies.split('; ').map((p: string) => ({
                            name: p.substring(0, p.indexOf('=')),
                            value: p.substring(p.indexOf('=') + 1),
                            domain: '.doordash.com',
                            path: '/',
                        }));
                        await lContext.addCookies(cObjs);
                    }
                    const lPage = await lContext.newPage();
                    const lRes = await lPage.goto(lunchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    if (lRes?.status() === 200) {
                        const lHtml = await lPage.content();
                        const lResult = parseListings(lHtml);
                        if (lResult.status === "SUCCESS") {
                            lSuccess = true;
                            successCount++;
                            lResult.merchants.forEach((m: any) => {
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
                            console.log(` -> Best of Lunch: Found ${lResult.merchants.length}`);
                        }
                    } else {
                        throw new Error(`HTTP ${lRes?.status()}`);
                    }
                } catch (e: any) {
                    if (lAttempts === 5) console.log(` -> Failed Best of Lunch: ${e.message}`);
                    else await new Promise(r => setTimeout(r, 2000));
                } finally {
                    await lContext.close();
                }
            }
        }
    } finally {
        await browser.close();
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

    console.log(`Ingesting ${observations.length} items...`);
    await pushToApi(apiUrl, apiKey, { ...runData, status: "INGESTING" }, []);
    
    // Chunking
    const CHUNK = 500;
    for (let i = 0; i < observations.length; i += CHUNK) {
        await pushToApi(apiUrl, apiKey, null, observations.slice(i, i + CHUNK));
    }

    await pushToApi(apiUrl, apiKey, runData, []);
    return finalStatus;
}
