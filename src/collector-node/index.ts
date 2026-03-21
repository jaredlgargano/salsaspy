import { runShard } from "./runner";
import { initializeProxies } from "./freeProxy";
import dotenv from "dotenv";

dotenv.config({ path: ".dev.vars" });

const API_URL = process.env.API_URL || "http://localhost:8787";
const API_KEY = process.env.API_KEY || "my-super-secret-key";

async function start() {
    console.log("Starting Node.js Playwright Collector...");

    // Helper to parse CLI flags
    const getArg = (name: string) => {
        const found = process.argv.find(a => a.startsWith(`--${name}=`));
        return found ? found.split('=')[1] : undefined;
    };

    if (!process.env.PROXY_URL) {
        await initializeProxies();
    }

    // Support both env vars (local debug) and flags (GHA)
    const shardStr = getArg('shard') || process.env.SHARD;
    const shard = shardStr ? parseInt(shardStr, 10) : -1;
    
    const now = new Date();
    const baseRunId = getArg('runId') || process.env.RUN_ID || `manual-${now.getTime()}`;
    const runId = shard !== -1 ? `${baseRunId}-${shard}` : baseRunId;

    if (shard === -1) {
        console.warn("⚠️  Warning: No shard ID provided. Processing part of the total pool based on default hashing.");
    }

    console.log(`Shard: ${shard}`);
    console.log(`Run ID: ${runId}`);
    console.log(`Base Run ID for grouping: ${baseRunId}`);

    const status = await runShard(API_URL, API_KEY, now, runId, shard);
    console.log(`Collection complete. Status: ${status}`);

    if (status === "FAILED") {
        console.error("Critical: Every request in this shard failed. Exiting with error.");
        process.exit(1);
    }
    
    process.exit(0);
}

start().catch(err => {
    console.error("Collector failed fatally:", err);
    process.exit(1);
});
