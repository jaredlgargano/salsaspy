export async function recomputeAggregatesForDate(db: any, dateStr: string) {
    // 1. Delete existing for the date
    await db.prepare("DELETE FROM aggregates_daily WHERE date = ?").bind(dateStr).run();

    // 2. Insert new Enterprise CI aggregates
    await db.prepare(`
        INSERT INTO aggregates_daily (
            date, city, category, surface, brand_normalized,
            avg_min_rank, sponsored_share, discount_store_share, total_observations, computed_at
        )
        WITH min_ranks AS (
            SELECT 
                run_id, city, category, surface, brand_normalized,
                MIN(rank) as min_rank
            FROM observations
            WHERE strftime('%Y-%m-%d', observed_at) = ?
            GROUP BY run_id, city, category, surface, brand_normalized
        ),
        avg_min_ranks AS (
            SELECT
                city, category, surface, brand_normalized,
                AVG(min_rank) as avg_min_rank
            FROM min_ranks
            GROUP BY city, category, surface, brand_normalized
        ),
        store_stats AS (
            SELECT
                city, category, surface, brand_normalized,
                COUNT(DISTINCT store_id) as unique_stores,
                COUNT(DISTINCT CASE WHEN has_discount = 1 THEN store_id END) as discounted_stores
            FROM observations
            WHERE strftime('%Y-%m-%d', observed_at) = ?
            GROUP BY city, category, surface, brand_normalized
        ),
        obs_stats AS (
            SELECT
                city, category, surface, brand_normalized,
                COUNT(*) as total_obs,
                SUM(is_sponsored) as sponsored_count
            FROM observations
            WHERE strftime('%Y-%m-%d', observed_at) = ?
            GROUP BY city, category, surface, brand_normalized
        )
        SELECT 
            ? as date,
            o.city,
            o.category,
            o.surface,
            o.brand_normalized,
            a.avg_min_rank,
            CAST(o.sponsored_count AS REAL) / o.total_obs as sponsored_share,
            CAST(s.discounted_stores AS REAL) / s.unique_stores as discount_store_share,
            o.total_obs as total_observations,
            CURRENT_TIMESTAMP as computed_at
        FROM obs_stats o
        JOIN avg_min_ranks a USING (city, category, surface, brand_normalized)
        JOIN store_stats s USING (city, category, surface, brand_normalized)
    `).bind(dateStr, dateStr, dateStr, dateStr).run();
}
