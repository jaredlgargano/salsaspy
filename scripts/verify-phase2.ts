import fs from 'fs';
import { parseListings } from '../src/collector-node/parseListings';

const html = fs.readFileSync('debug_discount.html', 'utf-8');
const res = parseListings(html);

console.log('Total Raw Merchants:', res.merchants.length);

res.merchants.forEach((m, i) => {
    console.log(`[${i+1}] ID: ${m.store_id} | Name: ${m.merchant_name.padEnd(30)} | Discount: ${m.has_discount} | Offer: ${m.offer_title} | Source: ${m.source}`);
    if (m.merchant_name.toLowerCase().includes('zpizza') || m.merchant_name.toLowerCase().includes('guys')) {
        console.log(`   Snippet: ${m.raw_snippet.substring(0, 500)}`);
    }
});
