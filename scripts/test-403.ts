
import { parseListings } from "../src/collector-node/parseListings";
import { getNextCookies } from "../src/collector-node/cookieRotator";
import { getRandomProxy, initializeProxies } from "../src/collector-node/freeProxy";
import { HttpsProxyAgent } from "https-proxy-agent";
import fs from "fs";

/**
 * Diagnostic script to probe 403 errors.
 * Usage: npx ts-node scripts/test-403.ts
 */
async function testConnectivity() {
    const { gotScraping } = await import('got-scraping');
    
    // 1. Initialize
    await initializeProxies();
    const city = "Toledo";
    const category = "Chicken";
    const url = `https://www.doordash.com/search/store/${encodeURIComponent(category)}/?lat=41.6528&lng=-83.5379`;

    console.log(`\n🕵️  Probing 403 for ${city} (${category})...`);
    console.log(`URL: ${url}\n`);

    for (let i = 1; i <= 3; i++) {
        console.log(`--- Attempt ${i} ---`);
        const cookies = getNextCookies();
        const proxy = getRandomProxy();
        const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;

        console.log(`Account: ${cookies ? cookies.substring(0, 50) + "..." : "NONE (Unauthenticated)"}`);
        console.log(`Proxy: ${proxy || "NONE (Local IP)"}`);

        try {
            const res = await gotScraping({
                url,
                headers: cookies ? { 'Cookie': cookies } : {},
                agent: agent ? { https: agent, http: agent } : undefined,
                timeout: { request: 15000 },
                throwHttpErrors: false
            });

            console.log(`Status: ${res.statusCode}`);
            console.log(`Response Size: ${res.body.length} bytes`);
            
            if (res.statusCode === 403) {
                console.log("❌ 403 Forbidden detected.");
                console.log("Headers:", JSON.stringify(res.headers, null, 2));
                const bodySnippet = res.body.substring(0, 500);
                console.log("Body Snippet:", bodySnippet);
                
                if (bodySnippet.includes("Cloudflare")) {
                    console.log("🚨 BLOCK TYPE: Cloudflare WAF / Challenge Page");
                } else if (bodySnippet.includes("Access Denied")) {
                    console.log("🚨 BLOCK TYPE: Direct Access Denied (Likely IP block)");
                }
            } else if (res.statusCode === 200) {
                console.log("✅ 200 OK! Connection successful.");
                const result = parseListings(res.body);
                console.log(`Parsed: ${result.status} | Found ${result.merchants.length} merchants.`);
            } else {
                console.log(`⚠️  Received status ${res.statusCode}`);
            }
        } catch (e: any) {
            console.log(`💥 Request crashed: ${e.message}`);
        }
        console.log("");
    }
}

testConnectivity().catch(console.error);
