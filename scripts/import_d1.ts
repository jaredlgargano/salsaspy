import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { execSync } from 'child_process';

// Get the latest D1 sqlite database
const dbPattern = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite';
const dbFiles = execSync(`ls ${dbPattern}`).toString().trim().split('\n');

if (dbFiles.length === 0 || !dbFiles[0]) {
    console.error("Could not find local D1 database.");
    process.exit(1);
}

const db = dbFiles[0];
console.log(`Using database: ${db}`);

// Read the constructed CSV
if (!fs.existsSync('locations.csv')) {
    console.error("locations.csv not found! Wait for build_locations_csv.ts to finish.");
    process.exit(1);
}

const csvData = fs.readFileSync('locations.csv', 'utf-8');
const records = parse(csvData, { columns: true, skip_empty_lines: true });

console.log(`Preparing to inject ${records.length} markers into D1...`);

let successCount = 0;
let failCount = 0;

for (const row of records as any[]) {
    try {
        const query = `INSERT OR IGNORE INTO markets (
            market_id, restaurant_id, name, address1, city, state, zip, country, latitude, longitude, active, created_at
        ) VALUES (
            '${row.market_id}', '${row.restaurant_id}', '${row.name.replace(/'/g, "''")}', '${row.address1.replace(/'/g, "''")}', '${row.city.replace(/'/g, "''")}', '${row.state}', '${row.zip}', '${row.country}', ${row.latitude || 'NULL'}, ${row.longitude || 'NULL'}, 1, CURRENT_TIMESTAMP
        );`;
        execSync(`sqlite3 ${db} "${query}"`);
        successCount++;
        if (successCount % 100 === 0) console.log(`Inserted ${successCount} rows...`);
    } catch (e) {
        failCount++;
    }
}

console.log(`\nDONE. Successfully injected: ${successCount}. Failed: ${failCount}`);
