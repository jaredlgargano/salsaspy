import fs from 'fs';
import path from 'path';
import { parseListings } from '../src/collector-node/parseListings';
import { initializeProxies, getRandomProxy } from '../src/collector-node/freeProxy';
import { getNextCookies } from '../src/collector-node/cookieRotator';

async function runQA() {
    console.log("🚀 Starting Full 210 DMA QA (Chrome-Free)...");
    
    // 1. Initialize Proxies
    await initializeProxies();
    
    // 2. Load DMAs
    const dmaPath = path.resolve(process.cwd(), 'src/collector-node/dma_210.json');
    let dmas = JSON.parse(fs.readFileSync(dmaPath, 'utf-8'));
    
    const limitArg = process.argv.find(a => a.startsWith('--limit='));
    if (limitArg) {
        const limit = parseInt(limitArg.split('=')[1]);
        dmas = dmas.slice(0, limit);
    }
    console.log(`Processing ${dmas.length} DMAs.`);

    const results: any[] = [];
    const BATCH_SIZE = 5; // Run in small batches to avoid overwhelming local resources/network
    
    for (let i = 0; i < dmas.length; i += BATCH_SIZE) {
        const batch = dmas.slice(i, i + BATCH_SIZE);
        console.log(`\n📦 Processing DMA Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(dmas.length / BATCH_SIZE)}...`);
        
        const batchPromises = batch.map(async (dma: any) => {
            const url = `https://www.doordash.com/search/store/restaurants/?lat=${dma.latitude}&lng=${dma.longitude}`;
            let success = false;
            let lastError = "";
            let merchantsFound = 0;
            let usedTier = "";

            // Tiers: Direct -> Proxy -> Guest (all using got-scraping)
            const tiers = [
                { type: 'Direct', useProxy: false, useCookies: true, retries: 1 },
                { type: 'Proxy', useProxy: true, useCookies: true, retries: 3 },
                { type: 'Guest', useProxy: false, useCookies: false, retries: 1 }
            ];

            for (const tier of tiers) {
                if (success) break;
                for (let r = 0; r < tier.retries; r++) {
                    if (success) break;
                    
                    const proxy = tier.useProxy ? getRandomProxy() : undefined;
                    const cookies = tier.useCookies ? getNextCookies() : undefined;

                    try {
                        const { gotScraping } = await import('got-scraping');
                        const response = await gotScraping({
                            url,
                            proxyUrl: proxy,
                            headers: cookies ? { 'Cookie': cookies } : {},
                            headerGeneratorOptions: { browsers: ['chrome'], os: ['macos', 'windows'] },
                            timeout: { request: 20000 }
                        });

                        if (response.statusCode === 200) {
                            const parseResult = parseListings(response.body);
                            if (parseResult.status === "SUCCESS") {
                                success = true;
                                merchantsFound = parseResult.merchants.length;
                                usedTier = tier.type;
                                console.log(`  ✅ [${dma.rank}] ${dma.name}: SUCCESS (${merchantsFound} merchants) via ${tier.type}`);
                            } else {
                                lastError = `Parse Error: ${parseResult.status}`;
                            }
                        } else if (response.statusCode === 403) {
                            lastError = `HTTP 403 (Blocked)`;
                            // Break the retry loop for this tier on 403 to move to next tier faster
                            break;
                        } else {
                            lastError = `HTTP ${response.statusCode}`;
                        }
                    } catch (e: any) {
                        lastError = e.message.split('\n')[0];
                    }
                }
            }

            if (!success) {
                console.log(`  ❌ [${dma.rank}] ${dma.name}: FAILED (${lastError})`);
            }

            return {
                rank: dma.rank,
                name: dma.name,
                success,
                merchantsFound,
                usedTier,
                lastError
            };
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Brief pause between batches
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 3. Summary and Save results
    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🏁 QA COMPLETE`);
    console.log(`Total DMAs: ${results.length}`);
    console.log(`Success:    ${successCount}`);
    console.log(`Failure:    ${failCount}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    fs.writeFileSync('qa_results.json', JSON.stringify(results, null, 2));
    console.log("Results saved to qa_results.json");
    
    if (failCount > 0) {
        process.exit(1);
    }
}

runQA().catch(err => {
    console.error("Fatal QA Error:", err);
    process.exit(1);
});
