import * as fs from "fs";

const OUTPUT_FILE = "locations.csv";
const SITEMAP_URLS = [
    "https://locations.chipotle.com/sitemap1.xml",
    "https://locations.chipotle.com/sitemap2.xml"
];

async function fetchHtml(url: string, retries = 3): Promise<string> {
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.text();
        } catch (e: any) {
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 1000 * (i + 1))); // exponential backoff
        }
    }
    return "";
}

async function extractStoresFromSitemap(xmlUrl: string): Promise<string[]> {
    console.log(`Fetching sitemap: ${xmlUrl}`);
    const xml = await fetchHtml(xmlUrl);

    // Match base store URL pattern and strictly avoid /order-delivery
    const matches = [...xml.matchAll(/<loc>(https:\/\/locations\.chipotle\.com\/[a-z]{2}\/[^\/<]+\/[^\/<]+)<\/loc>/g)];
    const urls = matches.map(m => m[1]).filter(url => !url.endsWith('.html') && !url.includes('catering'));
    return [...new Set(urls)];
}

function parseStore(html: string, url: string) {
    let lat: number | null = null;
    let lng: number | null = null;
    let address1 = "";
    let city = "";
    let state = "";
    let zip = "";

    // Extract properties from JSON-LD
    const ldMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    for (const match of ldMatches) {
        try {
            const data = JSON.parse(match[1]);
            const entities = data['@graph'] ? (Array.isArray(data['@graph']) ? data['@graph'] : [data['@graph']]) : (Array.isArray(data) ? data : [data]);

            for (const entity of entities) {
                if (entity['@type'] === 'Restaurant' || entity['@type'] === 'FoodEstablishment' || entity['@type'] === 'LocalBusiness') {
                    if (entity.address) {
                        address1 = entity.address.streetAddress || address1;
                        city = entity.address.addressLocality || city;
                        state = entity.address.addressRegion || state;
                        zip = entity.address.postalCode || zip;
                    }
                }
            }
        } catch (e) {
            // ignore JSON parse errors
        }
    }

    // Extract geo directly from window state strings in HTML
    const latMatch = html.match(/"latitude"\s*:\s*([\-0-9.]+)/i);
    const lngMatch = html.match(/"longitude"\s*:\s*([\-0-9.]+)/i);

    if (latMatch && lngMatch) {
        lat = parseFloat(latMatch[1]);
        lng = parseFloat(lngMatch[1]);
    }

    if (!address1 || lat === null || isNaN(lat)) {
        return null;
    }

    const slug = url.split('/').pop() || "unknown";
    return {
        market_id: `market-${slug}`,
        restaurant_id: slug,
        name: "Chipotle",
        address1,
        city,
        state,
        zip,
        country: "US",
        latitude: lat,
        longitude: lng
    };
}

async function run() {
    console.log("Starting Corporate Sitemap Crawler...");
    let storeUrls: string[] = [];

    for (const url of SITEMAP_URLS) {
        try {
            const urls = await extractStoresFromSitemap(url);
            storeUrls.push(...urls);
        } catch (e) {
            console.error(`Failed to fetch sitemap ${url}`);
        }
    }

    storeUrls = [...new Set(storeUrls)];
    console.log(`Found ${storeUrls.length} unique store URLs. Beginning concurrent extraction...`);

    const storesFound: any[] = [];
    const CONCURRENCY = 50;

    for (let i = 0; i < storeUrls.length; i += CONCURRENCY) {
        const batch = storeUrls.slice(i, i + CONCURRENCY);

        await Promise.all(batch.map(async (url) => {
            try {
                const html = await fetchHtml(url);
                const storeInfo = parseStore(html, url);
                if (storeInfo) {
                    if (!storesFound.find(s => s.address1 === storeInfo.address1)) {
                        storesFound.push(storeInfo);
                    }
                }
            } catch (err: any) {
                // Ignore transient network errors
            }
        }));

        if ((i + CONCURRENCY) % 500 === 0 || i + CONCURRENCY >= storeUrls.length) {
            console.log(`Processed ${Math.min(i + CONCURRENCY, storeUrls.length)} / ${storeUrls.length} pages... (Found ${storesFound.length} valid stores)`);
        }
    }

    if (storesFound.length > 0) {
        const headers = ["market_id", "restaurant_id", "name", "address1", "city", "state", "zip", "country", "latitude", "longitude"];
        let csv = headers.join(",") + "\n";

        for (const store of storesFound) {
            const row = [
                store.market_id,
                store.restaurant_id,
                `"${store.name}"`,
                `"${store.address1}"`,
                `"${store.city}"`,
                store.state,
                store.zip,
                store.country,
                store.latitude,
                store.longitude
            ];
            csv += row.join(",") + "\n";
        }

        fs.writeFileSync(OUTPUT_FILE, csv);
        console.log(`\nSUCCESS: Wrote ${storesFound.length} corporate Chipotle stores to ${OUTPUT_FILE}`);
    } else {
        console.log("No stores found.");
    }
}

run().catch(console.error);
