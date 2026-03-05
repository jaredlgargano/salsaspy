import fs from 'fs';
import * as cheerio from 'cheerio';
import { parseListings } from './src/collector-node/parseListings';

const html = fs.readFileSync('test_scraperapi_result.html', 'utf-8');
const result = parseListings(html);

console.log(`Status: ${result.status}`);
console.log(`Extracted: ${result.merchants.length} merchants.`);
if (result.merchants.length > 0) {
    console.log("Sample:", result.merchants[0]);
}

// Quick Cheerio check if it failed
if (result.merchants.length === 0) {
    const $ = cheerio.load(html);
    console.log("a tags:", $('a').length);
    console.log("div tags:", $('div').length);
    console.log("StoreCard links:", $('a[href*="/store/"]').length);
}
