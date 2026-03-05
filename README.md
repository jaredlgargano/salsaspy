# DoorDash HTTP Web Scraper (Cloudflare Workers + D1)

A robust, HTTP-only web scraper built to collect and aggregate DoorDash visibility metrics (Chipotle Report Style) without headless browsers.

## Architecture

This service runs entirely on Cloudflare Workers using a Cron Trigger (`collector`) and an HTTP API (`api`). It relies on a D1 (SQLite) database.

```text
  [ Cloudflare Cron Trigger ] 
      │ (Every 15 min weekdays 16:30Z-18:30Z)
      ▼
┌──────────────┐     Selects Target Markets      ┌───────────┐
│              │ ──────────────────────────────► │           │
│  Collector   │                                 │   D1 DB   │
│              │ ◄────────────────────────────── │ (SQLite)  │
└──────┬───────┘     Reads/Writes Observations   └─────▲─────┘
       │                                               │
       ▼ (HTTP Fetch)                                  │
[ DoorDash Search / Best Of Lunch ]                Read/Export
                                                       │
                                                       │
[ Client / Data Team ] ◄───────────────────────────────┘
                                   │
                                   ▼
                            ┌───────────────┐
                            │   API Worker  │
                            └───────────────┘
```

## Getting Started

1. **Prerequisites**: Install Node.js, `npm`, and create a Cloudflare account.
2. **Install CLI**: Intall wrangler if you haven't `npm install -g wrangler`
3. **Install Dependencies**:
   ```bash
   npm install
   ```
4. **Setup Database**:
   ```bash
   npx wrangler d1 create scraper-db
   ```
   Take the generated `database_id` and update both `database_id` fields in `wrangler.toml`.
5. **Apply Migrations**:
   ```bash
   npx wrangler d1 execute scraper-db --local --file=migrations/0001_init.sql
   ```
6. **Seed Locations (Optional but needed to run)**:
   ```bash
   # Build demo locations limit
   npx tsx scripts/build_locations_csv.ts
   
   # Import
   npx tsx scripts/import_markets_to_d1.ts
   ```
7. **Set Secrets**:
   To secure API endpoints, set a secret:
   ```bash
   echo "my-super-secret-key" | npx wrangler secret put API_KEY
   ```
8. **Test & Dev**:
   ```bash
   npx vitest run
   npx wrangler dev
   ```
9. **Deploy**:
   ```bash
   npx wrangler deploy
   ```

## Runbook

### How to add a category or surface
Categories and surfaces are defined in the `config` table in the D1 database. To add one without redeploying:
```bash
# Example query to update categories to just 'Mexican' and 'Healthy'
npx wrangler d1 execute scraper-db --remote \
  --command="UPDATE config SET value = '[\"Healthy\", \"Mexican\"]' WHERE key = 'enabled_categories';"
```

If you add a fundamentally new surface, you must:
1. Create a fetch adapter in `src/collector/surfaces/newSurface.ts`
2. Update the `runShard.ts` loop to dispatch it and parse it using `parseListings`.

### How to pause collection (Compliance Mode)
In case of DoS, blocks, or legal requests, kill the collector instantly:
```bash
npx wrangler d1 execute scraper-db --remote \
  --command="UPDATE config SET value = 'on' WHERE key = 'compliance_mode';"
```

### How to change `shards_total`
If your runs are taking too long (approaching CF Worker limits) or you want to spread the load across more cron triggers:
1. Update your Cron Trigger schedule in `wrangler.toml` to have more time slots.
2. Update the DB: `UPDATE config SET value = '30' WHERE key = 'shards_total';`
No code changes required. The sharding algorithm will adapt dynamically on next run.

### Local Endpoints
- **Health**: `GET /health`
- **Markets**: `GET /v1/markets`
- **Runs**: `GET /v1/runs`
- **CSV Export**: `GET /v1/export/monthly.csv?month=YYYY-MM`
- **Manual Trigger**: `POST /v1/run` (include `Authorization: Bearer <API_KEY>`)
