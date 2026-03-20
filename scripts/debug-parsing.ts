import fs from 'fs';
import path from 'path';
import { parseListings } from '../src/collector-node/parseListings';

const args = process.argv.slice(2);
let filePath = args.find(a => !a.startsWith('--'));

if (!filePath && args.includes('--file')) {
    filePath = args[args.indexOf('--file') + 1];
}

if (!filePath) {
    console.log('Usage: npx ts-node scripts/debug-parsing.ts <html-file-path>');
    process.exit(1);
}

const fullPath = path.resolve(process.cwd(), filePath);
if (!fs.existsSync(fullPath)) {
    console.error(`Error: File not found at ${fullPath}`);
    process.exit(1);
}

const html = fs.readFileSync(fullPath, 'utf-8');
console.log(`Analyzing file: ${filePath} (${(html.length / 1024).toFixed(1)} KB)`);

const result = parseListings(html);

console.log(`\nStatus: ${result.status}`);
console.log(`Merchants Found: ${result.merchants.length}`);

const sponsored = result.merchants.filter(m => m.is_sponsored);
const discounted = result.merchants.filter(m => m.has_discount);

console.log(`Sponsored: ${sponsored.length}`);
console.log(`Has Discount: ${discounted.length}`);

console.log('\n--- Top 5 Merchants ---');
result.merchants.slice(0, 5).forEach(m => {
    console.log(`[Rank ${m.rank}] ${m.merchant_name}`);
    console.log(`  ID: ${m.store_id}`);
    console.log(`  Sponsored: ${m.is_sponsored}`);
    console.log(`  Discount: ${m.has_discount} (${m.offer_title || 'None'})`);
    console.log(`  Fee: ${m.delivery_fee}`);
    console.log(`  Rating: ${m.rating} (${m.review_count} reviews)`);
    console.log('  ---');
});
