import fs from 'fs';
import path from 'path';

const ACCOUNTS_PATH = path.resolve(process.cwd(), 'accounts.json');
const MAX_REQUESTS_PER_ACCOUNT_PER_DAY = 1000;
const EXPIRY_WARNING_DAYS = 1;

/** Decode a JWT and return its expiry Date, or null if unparseable. */
function getJwtExpiry(cookies: string): Date | null {
    const match = cookies.match(/ddweb_token=([A-Za-z0-9._-]+)/);
    if (!match) return null;
    try {
        const payload = match[1].split('.')[1];
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
        if (decoded.exp) return new Date(decoded.exp * 1000);
    } catch {}
    return null;
}

export interface Account {
    email: string;
    label: string;
    cookies: string;
    last_used: number;
    request_count: number;
    banned: boolean;
}

function loadAccounts(): Account[] {
    if (!fs.existsSync(ACCOUNTS_PATH)) return [];
    try {
        const raw = fs.readFileSync(ACCOUNTS_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as Account[];
        // Filter out the template comment entry, banned accounts, and EXPIRED accounts
    return parsed.filter(a => {
        if (!a.cookies || a.cookies.length === 0 || a.banned) return false;
        const expiry = getJwtExpiry(a.cookies);
        if (expiry && expiry < new Date()) {
            console.warn(`[CookieRotator] ⚠️  Account ${a.email} cookies EXPIRED on ${expiry.toDateString()} — run 'npm run export-cookies' to refresh.`);
            return false;
        }
        if (expiry) {
            const daysLeft = (expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
            if (daysLeft < EXPIRY_WARNING_DAYS) {
                console.warn(`[CookieRotator] ⚠️  Account ${a.email} expires in ${Math.ceil(daysLeft)} day(s) (${expiry.toDateString()}) — refresh soon with 'npm run export-cookies'.`);
            }
        }
        return true;
    });
    } catch {
        return [];
    }
}

function saveAccounts(accounts: Account[]): void {
    // We need to merge back with the original file (which may have banned accounts etc.)
    if (!fs.existsSync(ACCOUNTS_PATH)) return;
    const raw = fs.readFileSync(ACCOUNTS_PATH, 'utf-8');
    const all = JSON.parse(raw) as Account[];
    for (const account of accounts) {
        const idx = all.findIndex(a => a.email === account.email);
        if (idx !== -1) all[idx] = account;
    }
    fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(all, null, 2));
}

/**
 * Returns a Cookie header string from the least-recently-used, non-banned account.
 * Returns null if no authenticated accounts are available.
 */
export function getNextCookies(): string | null {
    const accounts = loadAccounts();
    if (accounts.length === 0) return null;

    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Reset daily request counts if the day has changed
    const today = new Date().toDateString();
    for (const a of accounts) {
        const lastDate = new Date(a.last_used).toDateString();
        if (lastDate !== today) {
            a.request_count = 0;
        }
    }

    // Pick the least-recently-used account that hasn't hit the daily limit
    const eligible = accounts
        .filter(a => a.request_count < MAX_REQUESTS_PER_ACCOUNT_PER_DAY)
        .sort((a, b) => a.last_used - b.last_used);

    if (eligible.length === 0) {
        console.warn('[CookieRotator] All accounts have hit their daily request limit. Falling back to unauthenticated.');
        return null;
    }

    const selected = eligible[0];
    selected.last_used = now;
    selected.request_count++;
    saveAccounts(accounts);

    return selected.cookies;
}

/**
 * Marks an account as banned based on its cookie string.
 * Call this when you receive a 401/403 that suggests the account was flagged.
 */
export function markBanned(cookies: string): void {
    if (!fs.existsSync(ACCOUNTS_PATH)) return;
    const raw = fs.readFileSync(ACCOUNTS_PATH, 'utf-8');
    const all = JSON.parse(raw) as Account[];
    const account = all.find(a => a.cookies === cookies);
    if (account) {
        account.banned = true;
        fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(all, null, 2));
        console.warn(`[CookieRotator] Marked account ${account.email} as banned.`);
    }
}

export function getAccountCount(): number {
    return loadAccounts().length;
}
