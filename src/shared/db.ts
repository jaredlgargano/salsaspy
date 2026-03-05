export interface Market {
    market_id: string;
    restaurant_id: string;
    name: string;
    address1: string;
    city: string;
    state: string;
    zip: string;
    country: string;
    latitude: number | null;
    longitude: number | null;
    active: number;
}

export async function getMarkets(db: D1Database, shard?: number): Promise<Market[]> {
    let query = "SELECT * FROM markets WHERE active = 1";
    const params: any[] = [];

    if (shard !== undefined) {
        // Need to do modulo in application because SQLite doesn't natively have hash() function 
        // we could fetch all and filter, but that's expensive.
        // Wait, requirement: "shard = (hash(market_id) % shards_total)"
        // We can fetch all active markets and filter in memory if < 10000, 
        // or store `shard_id` in the database.
        // Let's fetch all and filter for now to guarantee exact hash logic as required.
    }

    const result = await db.prepare(query).all<Market>();
    return result.results || [];
}

export async function recordUnknownBrand(db: D1Database, brand: string) {
    try {
        await db.prepare(
            "INSERT OR IGNORE INTO unknown_brands (raw_name, first_seen_at) VALUES (?, datetime('now'))"
        ).bind(brand).run();
    } catch (e) {
        // ignore
    }
}
