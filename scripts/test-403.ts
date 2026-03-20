
import { parseListings } from "../src/collector-node/parseListings";
import { getNextCookies } from "../src/collector-node/cookieRotator";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";

chromium.use(StealthPlugin());

/**
 * Diagnostic script to probe 403 errors using Playwright.
 */
async function testConnectivity() {
    const city = "Toledo";
    const category = "Chicken";
    const url = `https://www.doordash.com/search/store/${encodeURIComponent(category)}/?lat=41.6528&lng=-83.5379`;

    console.log(`\n🕵️  Probing 403 for ${city} (${category}) via Playwright Stealth...`);
    
    const browser = await chromium.launch({ headless: true });

    for (let i = 1; i <= 2; i++) {
        console.log(`--- Attempt ${i} ---`);
        const context = await browser.newContext();
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

        try {
            const page = await context.newPage();
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            const status = response?.status() || 0;

            console.log(`Status: ${status}`);
            
            if (status === 200) {
                console.log("✅ 200 OK! Connection successful.");
                const html = await page.content();
                const result = parseListings(html);
                console.log(`Parsed: ${result.status} | Found ${result.merchants.length} merchants.`);
            } else {
                console.log(`❌ Failed with status ${status}`);
            }
        } catch (e: any) {
            console.log(`💥 Request crashed: ${e.message}`);
        }
        await context.close();
        console.log("");
    }
    await browser.close();
}

testConnectivity().catch(console.error);
