export async function generateCsvForMonth(db: any, month: string): Promise<string> {
    const query = `
    SELECT month, city, category, brand_normalized as brand, 
           avg_min_rank, sponsored_share, discount_store_share, total_observations 
    FROM aggregates_monthly 
    WHERE month = ?
    ORDER BY city, category, brand
  `;

    const result = await db.prepare(query).bind(month).all();
    const rows = result.results || [];

    const headers = ["month", "city", "category", "brand", "avg_min_rank", "sponsored_share", "discount_store_share", "total_observations"];

    if (rows.length === 0) {
        return headers.join(",") + "\n";
    }

    let csv = headers.join(",") + "\n";

    for (const row of rows as any[]) {
        const cols = [
            row.month || "",
            `"${(row.city || "").replace(/"/g, '""')}"`,
            row.category || "",
            `"${(row.brand || "").replace(/"/g, '""')}"`,
            row.avg_min_rank?.toString() || "",
            row.sponsored_share?.toString() || "",
            row.discount_store_share?.toString() || "",
            row.total_observations?.toString() || ""
        ];
        csv += cols.join(",") + "\n";
    }

    return csv;
}
