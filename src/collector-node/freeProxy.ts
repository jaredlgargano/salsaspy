import fs from 'fs';
import path from 'path';

// List of free proxy sources (HTTP/HTTPS)
const PROXY_SOURCES = [
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt'
];

let proxyList: string[] = [];

/**
 * Downloads and aggregates free HTTP proxies from known GitHub repositories.
 */
export async function initializeProxies() {
    console.log(`Downloading free proxies from ${PROXY_SOURCES.length} sources...`);
    const allProxies = new Set<string>();

    for (const source of PROXY_SOURCES) {
        try {
            const res = await fetch(source);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            
            const lines = text.split('\n');
            let count = 0;
            for (const line of lines) {
                const proxy = line.trim();
                // Basic validation: ip:port format
                if (proxy && /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+$/.test(proxy)) {
                    allProxies.add(`http://${proxy}`);
                    count++;
                }
            }
            console.log(` -> Loaded ${count} proxies from ${source}`);
        } catch (e: any) {
            console.warn(` -> Failed to fetch proxies from ${source}: ${e.message}`);
        }
    }

    proxyList = Array.from(allProxies);
    // Shuffle the array to distribute load
    for (let i = proxyList.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [proxyList[i], proxyList[j]] = [proxyList[j], proxyList[i]];
    }

    console.log(`Total unique free proxies ready: ${proxyList.length}`);
}

/**
 * Gets a random proxy from the loaded list.
 * Returns undefined if no proxies are available.
 */
export function getRandomProxy(): string | undefined {
    if (proxyList.length === 0) return undefined;
    const randomIndex = Math.floor(Math.random() * proxyList.length);
    return proxyList[randomIndex];
}
