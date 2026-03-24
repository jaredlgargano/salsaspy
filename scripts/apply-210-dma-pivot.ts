import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: ".dev.vars" });

const API_URL = process.env.API_URL || "https://doordash-scraper-api.uberscraper.workers.dev";
const API_KEY = process.env.API_KEY || process.env.SCRAPER_API_KEY;

async function applyPivot() {
    const dmaPath = path.join(__dirname, "../src/collector-node/dma_210.json");
    if (!fs.existsSync(dmaPath)) {
        console.error("DMA file not found at", dmaPath);
        process.exit(1);
    }

    const markets = JSON.parse(fs.readFileSync(dmaPath, "utf-8"));
    console.log(`🚀 Sending ${markets.length} DMAs to API at ${API_URL}...`);

    const resp = await fetch(`${API_URL}/v1/markets/pivot`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${API_KEY}`
        },
        body: JSON.stringify({ markets })
    });

    if (!resp.ok) {
        const err = await resp.text();
        console.error(`❌ Pivot failed: ${resp.status}`, err);
        process.exit(1);
    }

    const result = await resp.json();
    console.log(`✅ Pivot Success! Response:`, result);
}

applyPivot().catch(console.error);
