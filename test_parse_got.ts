import fs from 'fs';
import { parseListings } from './src/collector-node/parseListings.js';

const html = fs.readFileSync('test_dd_got.html', 'utf8');
const result = parseListings(html);

console.log(`Status: ${result.status}`);
if (result.status === "SUCCESS") {
    console.log(`Found ${result.merchants.length} merchants.`);
    if (result.merchants.length > 0) {
        console.log(result.merchants[0]);
    }
} else {
    console.log("Error parsing listings.");
}
