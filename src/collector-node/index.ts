import { launchBrowser } from "./browser";
import { pushToApi } from "./ingest";
import { runShard } from "./runner";
import dotenv from "dotenv";

dotenv.config({ path: ".dev.vars" });

const API_URL = process.env.API_URL || "http://localhost:8787";
const API_KEY = process.env.API_KEY || "my-super-secret-key";

async function start() {
    console.log("Starting Node.js Playwright Collector...");

    // In a real cron environment, we'd determine shard dynamically.
    // We can pass process.env.SHARD to run a specific shard partition.
    const shard = process.env.SHARD ? parseInt(process.env.SHARD, 10) : -1;
    const now = new Date();
    const runId = `node-cron-${now.getTime()}`;

    console.log(`Run ID: ${runId}`);

    await runShard(API_URL, API_KEY, now, runId, shard);

    console.log("Collection complete. Exiting.");
    process.exit(0);
}

start().catch(err => {
    console.error("Collector failed fatally:", err);
    process.exit(1);
});
