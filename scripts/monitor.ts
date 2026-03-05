import * as fs from 'fs';

const TOTAL_STORES_ESTIMATE = 3450;
const CACHE_DIR = ".cache";

console.log("=========================================");
console.log("       CHIPOTLE CRAWLER TRACKER       ");
console.log("=========================================\n");

function updateStatus() {
    if (!fs.existsSync(CACHE_DIR)) {
        console.log("Waiting for crawler to start...");
        return;
    }

    const files = fs.readdirSync(CACHE_DIR);
    const count = files.length;

    // Calculate percentage based on roughly 50 states + 3400 cities/stores = ~3450 pages
    const percentage = Math.min(100, Math.round((count / TOTAL_STORES_ESTIMATE) * 100));

    // Draw a progress bar
    const barLength = 40;
    const filledLength = Math.round((barLength * percentage) / 100);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

    const timeRemainingMins = Math.round((TOTAL_STORES_ESTIMATE - count) / 60);

    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`Progress: [${bar}] ${percentage}% | Files Cached: ${count} | Est. Remaining: ~${timeRemainingMins} mins`);
}

// Update the console every second
setInterval(updateStatus, 1000);
updateStatus();
