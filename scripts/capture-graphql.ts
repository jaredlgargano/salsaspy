import { chromium, type Request } from 'playwright';
import fs from 'fs';

async function extractGraphQL() {
    console.log("Launching headless browser with User Cookies...");
    const browser = await chromium.launch({ headless: true });
    
    // Load cookies
    let account = null;
    try {
        const raw = fs.readFileSync('accounts.json', 'utf-8');
        account = JSON.parse(raw).find((a: any) => !a._comment && a.cookies);
    } catch(e) { }

    const context = await browser.newContext();
    
    if (account) {
        // Parse cookie string into Playwright format
        const cookiePairs = account.cookies.split(';').map((c: string) => c.trim()).filter((c: string) => c);
        const playwrightCookies = cookiePairs.map((p: string) => {
            const split = p.split('=');
            return {
                name: split[0],
                value: split.slice(1).join('='),
                domain: '.doordash.com',
                path: '/'
            };
        });
        await context.addCookies(playwrightCookies);
        console.log("Cookies injected successfully.");
    }

    const page = await context.newPage();

    page.on('request', (req: Request) => {
        if (req.url().includes('/graphql')) {
            const postData = req.postData();
            if (postData && postData.includes('homePageFacetFeed')) {
                console.log("=========== CAPTURED PAYLOAD ===========");
                fs.writeFileSync('scripts/extracted-query.json', postData);
                console.log("Saved to scripts/extracted-query.json");
                process.exit(0); // Exit immediately upon capture
            }
        }
    });

    try {
        await page.goto("https://www.doordash.com/search/store/restaurants/?lat=37.7749&lng=-122.4194", { 
            waitUntil: 'domcontentloaded', 
            timeout: 60000 
        });
        // We wait a bit to see if GraphQL fires after load
        await page.waitForTimeout(10000);
    } catch (e: any) {
        console.log(`Navigation finished or timed out: ${e.message}`);
    }

    console.log("Failed to capture GraphQL payload.");
    await browser.close();
    process.exit(1);
}

extractGraphQL();
