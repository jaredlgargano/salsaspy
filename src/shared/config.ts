export interface AppConfig {
    compliance_mode: "on" | "off";
    enabled_categories: string[];
    enabled_surfaces: string[];
    shards_total: number;
    max_markets_per_run: number;
    rate_limit_ms: number;
    retry_max: number;
    lunch_window_et: string;
}

export const DEFAULT_CONFIG: AppConfig = {
    compliance_mode: "off",
    enabled_categories: ["Healthy", "Mexican", "Salad", "Chicken"],
    enabled_surfaces: ["searchCategory"],
    shards_total: 20,
    max_markets_per_run: 200,
    rate_limit_ms: 500,
    retry_max: 3,
    lunch_window_et: "11:30-13:30"
};

export async function loadConfig(db: D1Database): Promise<AppConfig> {
    const result = await db.prepare("SELECT key, value FROM config").all<{ key: string, value: string }>();

    if (!result.success || !result.results) {
        return DEFAULT_CONFIG;
    }

    const config = { ...DEFAULT_CONFIG } as Record<string, any>;

    for (const row of result.results) {
        if (row.key === "enabled_categories" || row.key === "enabled_surfaces") {
            try {
                config[row.key] = JSON.parse(row.value);
            } catch (e) { }
        } else if (["shards_total", "max_markets_per_run", "rate_limit_ms", "retry_max"].includes(row.key)) {
            config[row.key] = parseInt(row.value, 10);
        } else {
            config[row.key] = row.value;
        }
    }

    return config as AppConfig;
}
