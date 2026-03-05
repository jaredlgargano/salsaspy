// FNV-1a hash algorithm
export function hashString(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash >>> 0;
}

export function getShard(marketId: string, shardsTotal: number): number {
    const hash = hashString(marketId);
    return hash % shardsTotal;
}
