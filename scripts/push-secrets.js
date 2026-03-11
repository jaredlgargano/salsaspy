/**
 * push-secrets.js
 *
 * Encodes your local accounts.json and pushes it to GitHub as a secret.
 * Run this after manually refreshing cookies with 'npm run export-cookies'.
 *
 * Requirements:
 *   - GitHub CLI installed: brew install gh
 *   - Authenticated: gh auth login
 *   - GH_PAT secret set in GitHub repo (for the refresh workflow to update secrets)
 *
 * Usage: npm run push-secrets
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ACCOUNTS_PATH = path.resolve(__dirname, '..', 'accounts.json');

function main() {
    if (!fs.existsSync(ACCOUNTS_PATH)) {
        console.error('No accounts.json found. Run: npm run export-cookies');
        process.exit(1);
    }

    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'))
        .filter(a => !a._comment);

    const valid = accounts.filter(a => a.cookies && !a.banned);
    console.log(`\n🔐 Pushing ${valid.length} account(s) to GitHub Secrets...\n`);

    // Base64-encode the full accounts.json
    const encoded = Buffer.from(JSON.stringify(accounts, null, 2)).toString('base64');

    try {
        execSync(`gh secret set DOORDASH_ACCOUNTS --body "${encoded}"`, {
            stdio: 'inherit'
        });
        console.log('\n✅ Secret DOORDASH_ACCOUNTS updated successfully.');
        console.log('   GitHub Actions will now use these cookies in all future runs.\n');
    } catch (err) {
        console.error('\n❌ Failed to set secret. Make sure GitHub CLI is installed and authenticated:');
        console.error('   brew install gh && gh auth login\n');
        process.exit(1);
    }
}

main();
