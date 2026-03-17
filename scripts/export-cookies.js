/**
 * export-cookies.js
 *
 * Opens YOUR real Chrome (not a bot browser) for DoorDash login.
 * Automatically saves session cookies to accounts.json when you're done.
 *
 * Usage: npm run export-cookies
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

const ACCOUNTS_PATH = path.resolve(__dirname, '..', 'accounts.json');

// Path to real Chrome on macOS
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Temp user data dir so we don't conflict with a running Chrome instance
const TEMP_PROFILE = path.join(os.tmpdir(), 'doordash-export-profile');

async function main() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(resolve => rl.question(q, resolve));

    console.log('\n🍕 DoorDash Cookie Exporter\n');

    // Load existing accounts
    let accounts = [];
    if (fs.existsSync(ACCOUNTS_PATH)) {
        try { accounts = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8')).filter(a => !a._comment); } catch {}
    }

    const expired = accounts.filter(a => {
        const exp = getJwtExpiry(a.cookies || '');
        return !exp || exp < new Date();
    });

    let queue = [];

    if (expired.length > 0) {
        console.log(`ℹ️  Detected ${expired.length} expired or missing account(s).`);
        const mode = await ask(`Use "Smart Renew" to iterate through them? (Y/n): `);
        if (mode.toLowerCase() !== 'n') {
            queue = expired;
        }
    }

    if (queue.length === 0) {
        const email = await ask('Email address for manual entry: ');
        const label = await ask('Label (e.g. account-1): ');
        queue = [{ email, label, manual: true }];
    }

    for (const target of queue) {
        console.log(`\n--- Processing: ${target.email} (${target.label || 'New'}) ---`);
        console.log('Launching Chrome...');

        const browser = await chromium.launchPersistentContext(TEMP_PROFILE, {
            executablePath: CHROME_PATH,
            headless: false,
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
            ignoreDefaultArgs: ['--enable-automation'],
        });

        const page = browser.pages()[0] || await browser.newPage();
        await page.goto('https://www.doordash.com/login/', { waitUntil: 'domcontentloaded' });

        console.log(`\n✅ Chrome opened for ${target.email}`);
        console.log('   1. Log in to this specific account.');
        console.log('   2. Once you see the homepage, press Enter here.');

        await ask('\nPress Enter once logged in...');

        const cookies = await browser.cookies('https://www.doordash.com');
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        await browser.close();

        if (!cookieStr || cookieStr.length < 50) {
            console.error('❌ No cookies found for this account. Skipping.');
            continue;
        }

        // Update accounts array
        const idx = accounts.findIndex(a => a.email === target.email);
        if (idx !== -1) {
            accounts[idx].cookies = cookieStr;
            accounts[idx].banned = false;
        } else {
            accounts.push({ 
                email: target.email, 
                label: target.label, 
                cookies: cookieStr, 
                last_used: 0, 
                request_count: 0, 
                banned: false 
            });
        }

        fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
        console.log(`✅ Saved cookies for ${target.email}`);
    }

    rl.close();
    console.log(`\n✨ Finished. Total active accounts in pool: ${accounts.filter(a => a.cookies && !a.banned).length}\n`);
}

function getJwtExpiry(cookies) {
    if (!cookies) return null;
    const match = cookies.match(/ddweb_token=([A-Za-z0-9._-]+)/);
    if (!match) return null;
    try {
        const payload = match[1].split('.')[1];
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
        if (decoded.exp) return new Date(decoded.exp * 1000);
    } catch {}
    return null;
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
