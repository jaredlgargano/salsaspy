/**
 * check-cookies.js
 * Quickly shows the status of all accounts in your cookie pool.
 * 
 * Usage: node scripts/check-cookies.js
 */
const fs = require('fs');
const path = require('path');

const ACCOUNTS_PATH = path.resolve(__dirname, '..', 'accounts.json');

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

function main() {
    if (!fs.existsSync(ACCOUNTS_PATH)) {
        console.log('No accounts.json found. Run: npm run export-cookies');
        return;
    }

    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'))
        .filter(a => !a._comment);

    console.log(`\n🍕 Cookie Pool Status (${accounts.length} accounts)\n`);
    console.log('  ' + 'Email'.padEnd(40) + 'Status'.padEnd(20) + 'Expires');
    console.log('  ' + '─'.repeat(80));

    const now = Date.now();
    for (const account of accounts) {
        const expiry = getJwtExpiry(account.cookies || '');
        let statusIcon, statusText, expiryText;

        if (account.banned) {
            statusIcon = '🚫'; statusText = 'BANNED'; expiryText = '—';
        } else if (!account.cookies) {
            statusIcon = '⚠️ '; statusText = 'NO COOKIES'; expiryText = '—';
        } else if (!expiry) {
            statusIcon = '❓'; statusText = 'Unknown'; expiryText = 'No JWT found';
        } else if (expiry < new Date()) {
            statusIcon = '🔴'; statusText = 'EXPIRED'; expiryText = expiry.toDateString();
        } else {
            const daysLeft = Math.ceil((expiry.getTime() - now) / (1000 * 60 * 60 * 24));
            if (daysLeft <= 3) {
                statusIcon = '🟡'; statusText = `Expires soon`; 
            } else {
                statusIcon = '🟢'; statusText = 'Active';
            }
            expiryText = `${expiry.toDateString()} (${daysLeft}d)`;
        }

        console.log(`  ${statusIcon} ${account.email.padEnd(38)} ${statusText.padEnd(18)} ${expiryText}`);
    }

    const active = accounts.filter(a => {
        if (a.banned || !a.cookies) return false;
        const exp = getJwtExpiry(a.cookies);
        return !exp || exp > new Date();
    }).length;

    console.log(`\n  Active accounts: ${active}/${accounts.length}`);
    const needsRefresh = accounts.filter(a => {
        const exp = getJwtExpiry(a.cookies || '');
        return exp && exp < new Date();
    });
    if (needsRefresh.length > 0) {
        console.log(`  ⚠️  ${needsRefresh.length} account(s) need refreshing. Run: npm run export-cookies\n`);
    } else {
        console.log(`  ✅ All cookies are valid!\n`);
    }
}

main();
