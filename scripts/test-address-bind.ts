import fs from 'fs';
import { setDeliveryAddress } from '../src/collector-node/sessionManager.js';

async function run() {
    let account = null;
    try {
        const raw = fs.readFileSync('accounts.json', 'utf-8');
        account = JSON.parse(raw).find((a: any) => !a._comment && a.cookies);
    } catch(e) { }

    if (!account) {
        console.error("No valid accounts");
        return;
    }

    console.log("Testing GraphQL Address Bind...");
    // Charleston, SC
    await setDeliveryAddress(32.7765, -79.9311, "Charleston", account.cookies);
}

run();
