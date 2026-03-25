import { runShard } from '../src/collector-node/runner.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.dev.vars' });

async function verify() {
    process.env.SHARDS_TOTAL = "100";
    process.env.FORCE_SCRAPE = "1";
    
    // We mock the API push temporarily or just let it push to dev DB.
    const apiUrl = process.env.API_URL || "https://doordash-scraper-api.uberscraper.workers.dev";
    const apiKey = process.env.API_KEY || "test_key";
    
    // Test on shard 0 or the shard that contains Charleston.
    // Actually, instead of hitting the real API for the market list in testing,
    // we can just run a custom modified runShard or rely on the actual API returning 1 market if we set up a mock.
    // Wait, let's just use the actual API to fetch Shard 0 and see if ANY market works perfectly without proxies!
    await runShard(apiUrl, apiKey, new Date(), "test_run_123", 0);
}

verify();
