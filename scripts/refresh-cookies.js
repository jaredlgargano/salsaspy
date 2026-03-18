/**
 * refresh-cookies.js
 *
 * Visits DoorDash with each account's existing cookies to keep sessions alive.
 * Saves the updated cookies back to accounts.json.
 *
 * Run manually:  node scripts/refresh-cookies.js
 * Automated:     .github/workflows/refresh-cookies.yml runs this weekly via GitHub Actions.
 *
 * HOW IT WORKS:
 *   - Opens a headless Chrome with each account's saved cookies pre-loaded
 *   - Navigates to doordash.com (this tells DoorDash the session is still active)
 *   - Captures the updated cookie set (DoorDash refreshes the JWT on each visit)
 *   - Saves the new cookies back to accounts.json
 *   No login required — no SMS, no CAPTCHA.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Load local .dev.vars if running outside GitHub Actions (override stale shell env vars)
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.dev.vars'), override: true }); } catch {}

const ACCOUNTS_PATH = path.resolve(__dirname, '..', 'accounts.json');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TEMP_PROFILE_BASE = require('os').tmpdir();

function getJwtExpiry(cookies) {
    const match = cookies.match(/ddweb_token=([A-Za-z0-9._-]+)/);
    if (!match) return null;
    try {
        const payload = match[1].split('.')[1];
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
        if (decoded.exp) return new Date(decoded.exp * 1000);
    } catch {}
    return null;
}

async function refreshAccount(account, index) {
    console.log(`\n[${index + 1}] Refreshing: ${account.email}`);

    const profileDir = path.join(TEMP_PROFILE_BASE, `dd-refresh-${index}`);

    // Parse cookie string into Playwright cookie objects for doordash.com
    const cookieObjects = account.cookies.split('; ').map(pair => {
        const eqIdx = pair.indexOf('=');
        return {
            name: pair.substring(0, eqIdx),
            value: pair.substring(eqIdx + 1),
            domain: '.doordash.com',
            path: '/',
        };
    }).filter(c => c.name && c.value);

    const executablePath = fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined;

    const browser = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        executablePath,
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
        ignoreDefaultArgs: ['--enable-automation'],
    });

    try {
        // Pre-load the existing cookies
        await browser.addCookies(cookieObjects);

        const page = browser.pages()[0] || await browser.newPage();

        // Visit the homepage — this naturally refreshes the session token
        await page.goto('https://www.doordash.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 20000
        });

        await page.waitForTimeout(3000);

        // Capture the new (refreshed) cookies
        const newCookies = await browser.cookies('https://www.doordash.com');
        const newCookieStr = newCookies.map(c => `${c.name}=${c.value}`).join('; ');

        const newExpiry = getJwtExpiry(newCookieStr);
        const isLoggedIn = newCookieStr.includes('dd_cx_logged_in=true');

        if (!isLoggedIn) {
            console.log(`  ⚠️  Session expired for ${account.email} — manual re-login required ('npm run export-cookies')`);
            account.banned = false; // Don't ban, just flag as needing refresh
            return { ...account, cookies: account.cookies, needsRelogin: true };
        }

        console.log(`  ✅ Refreshed. New expiry: ${newExpiry ? newExpiry.toDateString() : 'unknown'}`);
        return { ...account, cookies: newCookieStr };

    } finally {
        await browser.close();
    }
}

async function main() {
    if (!fs.existsSync(ACCOUNTS_PATH)) {
        console.error('No accounts.json found. Run: npm run export-cookies');
        process.exit(1);
    }

    const allAccounts = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'));
    const active = allAccounts.filter(a => !a._comment && a.cookies && !a.banned);

    console.log(`\n🔄 Refreshing ${active.length} DoorDash sessions...\n`);

    const reloginNeeded = [];

    for (let i = 0; i < active.length; i++) {
        const account = active[i];
        try {
            const updated = await refreshAccount(account, i);
            const idx = allAccounts.findIndex(a => a.email === account.email);
            if (idx !== -1) allAccounts[idx] = updated;
            if (updated.needsRelogin) reloginNeeded.push(account.email);
        } catch (err) {
            console.log(`  ❌ Error refreshing ${account.email}: ${err.message}`);
        }
        // Brief pause between accounts to avoid triggering rate limits
        if (i < active.length - 1) await new Promise(r => setTimeout(r, 2000));
    }


    fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(allAccounts, null, 2));
    console.log('\n✅ accounts.json updated.');

    // --- Sync with Remote API ---
    const apiUrl = process.env.API_URL || 'https://doordash-scraper-api.uberscraper.workers.dev';
    const apiKey = process.env.API_KEY || process.env.SCRAPER_API_KEY;

    if (!apiKey) {
        console.warn('  ⚠️  Skipping remote sync: API_KEY or SCRAPER_API_KEY not found in environment.');
    } else {
        console.log(`  🔄 Syncing updated health to ${apiUrl}...`);
        const payload = allAccounts.filter(a => !a._comment).map(a => {
            const exp = getJwtExpiry(a.cookies || '');
            let status = 'Active';
            if (a.banned) status = 'Banned';
            else if (!a.cookies) status = 'No Cookies';
            else if (!exp || exp < new Date()) status = 'Expired';
            else if ((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24) <= 3) status = 'Expiring Soon';

            return {
                email: a.email,
                label: a.label,
                status: status,
                expiry_at: exp ? exp.toISOString() : null
            };
        });

        try {
            const res = await fetch(`${apiUrl}/v1/status/cookies/sync`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({ accounts: payload })
            });
            if (res.ok) console.log('  ✅ Remote dashboard sync complete.');
        } catch (err) {
            console.error(`  ❌ Sync error: ${err.message}`);
        }
    }

    if (reloginNeeded.length > 0) {
        console.log(`\n⚠️  The following accounts need manual re-login:`);
        reloginNeeded.forEach(e => console.log(`   - ${e}`));
        console.log(`   Run: npm run export-cookies\n`);
        process.exit(1); // Non-zero exit lets GitHub Actions flag it
    }
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
