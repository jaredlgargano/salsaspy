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

    const email = await ask('Email address for this account: ');
    const label = await ask('Label (e.g. account-1): ');

    console.log('\nLaunching Chrome...\n');

    const browser = await chromium.launchPersistentContext(TEMP_PROFILE, {
        executablePath: CHROME_PATH,
        headless: false,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
    });

    const page = browser.pages()[0] || await browser.newPage();
    await page.goto('https://www.doordash.com/login/', { waitUntil: 'domcontentloaded' });

    console.log('✅ Chrome opened — log in to your DoorDash account.');
    console.log('   Once you can see the DoorDash homepage, press Enter here.\n');

    await ask('Press Enter once logged in...');

    const cookies = await browser.cookies('https://www.doordash.com');
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    await browser.close();
    rl.close();

    if (!cookieStr || cookieStr.length < 50) {
        console.error('\n❌ No cookies found. Did you complete the login?');
        process.exit(1);
    }

    // Load & update accounts.json
    let accounts = [];
    if (fs.existsSync(ACCOUNTS_PATH)) {
        try { accounts = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8')); } catch {}
    }

    accounts = accounts.filter(a => !a._comment && a.email !== email);
    accounts.push({ email, label, cookies: cookieStr, last_used: 0, request_count: 0, banned: false });

    fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));

    console.log(`\n✅ Saved cookies for ${email}`);
    console.log(`   Total accounts in pool: ${accounts.filter(a => a.cookies && !a.banned).length}\n`);
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
