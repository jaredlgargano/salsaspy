// scripts/import_markets_to_d1.ts
import fs from "fs";
import { execSync } from "child_process";

const INPUT_CSV = "locations.csv";
const OUTPUT_SQL = "import_markets.sql";

function run() {
    if (!fs.existsSync(INPUT_CSV)) {
        console.error(`File ${INPUT_CSV} does not exist. Run npx tsx scripts/build_locations_csv.ts first.`);
        process.exit(1);
    }

    const content = fs.readFileSync(INPUT_CSV, "utf-8");
    const lines = content.split("\n").filter(l => l.trim().length > 0);

    if (lines.length <= 1) {
        console.error("CSV is empty or only contains headers.");
        process.exit(1);
    }

    const headers = lines[0].split(",");
    const dataLines = lines.slice(1);

    let sql = "";
    let count = 0;

    for (const line of dataLines) {
        // Basic CSV parsing acknowledging quotes
        const regex = /(".*?"|[^",\s]+)(?=\s*,|\s*$)/g;
        const matches = [];
        let match;
        while ((match = regex.exec(line)) !== null) {
            matches.push(match[1].replace(/^"|"$/g, ''));
        }

        if (matches.length < 10) {
            // Simple split fallback avoiding complex CSV parsing for simple data
            const parts = line.split(",").map(p => p.replace(/^"|"$/g, ''));
            matches.length = 0;
            matches.push(...parts);
        }

        const [market_id, restaurant_id, name, address1, city, state, zip, country, lat, lng] = matches;

        const latVal = lat ? parseFloat(lat) : "NULL";
        const lngVal = lng ? parseFloat(lng) : "NULL";

        sql += `INSERT OR IGNORE INTO markets (market_id, restaurant_id, name, address1, city, state, zip, country, latitude, longitude, active, created_at) `;
        sql += `VALUES ('${market_id}', '${restaurant_id}', '${name.replace(/'/g, "''")}', '${address1.replace(/'/g, "''")}', '${city.replace(/'/g, "''")}', '${state}', '${zip}', '${country}', ${latVal}, ${lngVal}, 1, datetime('now'));\n`;

        count++;
    }

    fs.writeFileSync(OUTPUT_SQL, sql);
    console.log(`Generated ${OUTPUT_SQL} with ${count} INSERT statements.`);
    console.log(`\nTo import into local D1, run:`);
    console.log(`npx wrangler d1 execute scraper-db --local --file=${OUTPUT_SQL}`);
    console.log(`\nTo import into production D1, run:`);
    console.log(`npx wrangler d1 execute scraper-db --remote --file=${OUTPUT_SQL}`);
}

run();
