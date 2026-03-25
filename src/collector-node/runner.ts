import { pushToApi } from "./ingest";
import { parseListings } from "./parseListings";
import { getNextCookies, markBanned } from "./cookieRotator";
import { setDeliveryAddress } from "./sessionManager";

const GRAPHQL_QUERY = `query searchWithFilterFacetFeed($cursor: String, $filterQuery: String, $query: String!, $isDebug: Boolean, $fromFilterChange: Boolean, $serializedBundleGlobalSearchContext: String, $address: String, $searchType: String) {
  searchWithFilterFacetFeed(
    cursor: $cursor
    filterQuery: $filterQuery
    query: $query
    isDebug: $isDebug
    fromFilterChange: $fromFilterChange
    serializedBundleGlobalSearchContext: $serializedBundleGlobalSearchContext
    address: $address
    searchType: $searchType
  ) {
    ...FacetFeedV2ResultFragment
    __typename
  }
}

fragment FacetFeedV2ResultFragment on FacetFeedV2Result {
  body {
    id
    header {
      ...FacetV2Fragment
      __typename
    }
    body {
      ...FacetV2Fragment
      __typename
    }
    layout {
      omitFooter
      __typename
    }
    __typename
  }
  page {
    ...FacetV2PageFragment
    __typename
  }
  header {
    ...FacetV2Fragment
    __typename
  }
  footer {
    ...FacetV2Fragment
    __typename
  }
  custom
  logging
  __typename
}

fragment FacetV2Fragment on FacetV2 {
  ...FacetV2BaseFragment
  childrenMap {
    ...FacetV2BaseFragment
    __typename
  }
  __typename
}

fragment FacetV2BaseFragment on FacetV2 {
  id
  childrenCount
  component {
    ...FacetV2ComponentFragment
    __typename
  }
  name
  text {
    ...FacetV2TextFragment
    __typename
  }
  images {
    main {
      ...FacetV2ImageFragment
      __typename
    }
    icon {
      ...FacetV2ImageFragment
      __typename
    }
    background {
      ...FacetV2ImageFragment
      __typename
    }
    accessory {
      ...FacetV2ImageFragment
      __typename
    }
    custom {
      key
      value {
        ...FacetV2ImageFragment
        __typename
      }
      __typename
    }
    __typename
  }
  events {
    click {
      name
      data
      __typename
    }
    __typename
  }
  style {
    spacing
    background_color
    border {
      color
      width
      style
      __typename
    }
    sizeClass
    dlsType
    __typename
  }
  layout {
    omitFooter
    gridSpecs {
      Mobile { ...FacetV2LayoutGridFragment __typename }
      Phablet { ...FacetV2LayoutGridFragment __typename }
      Tablet { ...FacetV2LayoutGridFragment __typename }
      Desktop { ...FacetV2LayoutGridFragment __typename }
      WideScreen { ...FacetV2LayoutGridFragment __typename }
      UltraWideScreen { ...FacetV2LayoutGridFragment __typename }
      __typename
    }
    dlsPadding { top right bottom left __typename }
    __typename
  }
  custom
  logging
  __typename
}
fragment FacetV2ComponentFragment on FacetV2Component { id category __typename }
fragment FacetV2TextFragment on FacetV2Text { title subtitle accessory description custom { key value __typename } __typename }
fragment FacetV2ImageFragment on FacetV2Image { uri videoUri placeholder local style logging events { click { name data __typename } __typename } __typename }
fragment FacetV2LayoutGridFragment on FacetV2LayoutGrid { interRowSpacing interColumnSpacing minDimensionCount __typename }
fragment FacetV2PageFragment on FacetV2Page { next { name data __typename } onLoad { name data __typename } __typename }
`;

export async function runShard(apiUrl: string, apiKey: string, now: Date, runId: string, manualShard: number): Promise<string> {
    console.log(`Starting runShard (Session-Aware GraphQL) for shard ${manualShard}`);
    const SHARDS_TOTAL = parseInt(process.env.SHARDS_TOTAL || "100");
    const FORCE = process.env.FORCE_SCRAPE === "1";
    
    const urlParams = `shard=${manualShard}&shards_total=${SHARDS_TOTAL}&active=1${FORCE ? '' : '&unscraped_only=1'}`;
    let marketRes;
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
        marketRes = await fetch(`${apiUrl}/v1/markets?${urlParams}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (marketRes.ok) break;
        
        console.warn(`Retry ${i+1}/${maxRetries} to fetch markets...`);
        await new Promise(r => setTimeout(r, 1000 * (i + 1))); 
    }
    
    if (!marketRes || !marketRes.ok) {
        const errText = marketRes ? await marketRes.text() : "Request Timeout";
        console.error(`Failed to fetch markets after ${maxRetries} attempts: ${marketRes?.status || '??'}`);
        console.error(`URL: ${apiUrl}/v1/markets?${urlParams}`);
        return "FAILED";
    }

    let { markets } = await marketRes.json() as { markets: any[] };
    if (markets.length === 0) return "SUCCESS";

    console.log(`Processing ${markets.length} markets for Shard ${manualShard}.`);

    let successCount = 0;
    let failCount = 0;
    let lastFailureReason: string = "";
    
    // Objectives now map to the GraphQL search query parameter instead of a URL path
    const objectives = [
        { name: "Home", query: "restaurants", surface: "searchCategory" as const },
        { name: "Healthy", query: "healthy", surface: "searchCategory" as const },
        { name: "Mexican", query: "mexican", surface: "searchCategory" as const },
        { name: "Salad", query: "salad", surface: "searchCategory" as const },
        { name: "Chicken", query: "chicken", surface: "searchCategory" as const },
        { name: "Best of Lunch", query: "lunch", surface: "bestOfLunch" as const }
    ];

    for (const market of markets) {
        console.log(`\n🌎 Market: ${market.city}`);

        // 1. Get an authenticated session for this market
        let sessionCookies = getNextCookies() || "";
        if (sessionCookies) {
            console.log(`  -> [Session] Binding DMA Location via GraphQL...`);
            const boundCookies = await setDeliveryAddress(market.latitude, market.longitude, market.city, sessionCookies);
            if (!boundCookies) {
                console.log(`     ⚠️  Soft Warning: Address bind failed. Data might be inaccurate if default address falls back.`);
            } else {
                sessionCookies = boundCookies;
            }
        } else {
            console.log(`  -> [Session] ⚠️ No valid cookies available. High risk of Cloudflare block.`);
        }

        const cursorB64 = Buffer.from(JSON.stringify({
            "offset": 0, "vertical_ids": [], "cross_vertical_page_type": "GLOBAL_SEARCH_PAGE",
            "page_stack_trace": [], "layout_override": "UNSPECIFIED", "is_pagination_fallback": null,
            "source_page_type": null, "vertical_names": {}
        })).toString('base64');

        // 2. Fetch all objectives using native GraphQL
        for (const obj of objectives) {
            let success = false;
            console.log(`  -> [${obj.name}] Fetching direct feed (No Proxy)...`);

            const payload = {
                "operationName": "searchWithFilterFacetFeed",
                "variables": {
                    "cursor": cursorB64,
                    "filterQuery": "",
                    "query": obj.query,
                    "isDebug": false,
                    "searchType": ""
                },
                "query": GRAPHQL_QUERY
            };

            try {
                const { gotScraping } = await import('got-scraping');
                const response = await gotScraping({
                    url: "https://www.doordash.com/graphql/searchWithFilterFacetFeed",
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Cookie": sessionCookies ? sessionCookies : "",
                        "Origin": "https://www.doordash.com",
                        "Referer": "https://www.doordash.com/search/store/restaurants/"
                    },
                    body: JSON.stringify(payload),
                    headerGeneratorOptions: { browsers: ['chrome'], os: ['macos', 'windows'] },
                    timeout: { request: 30000 }
                });
                
                const statusCode = response.statusCode;
                
                if (statusCode === 200) {
                    const result = parseListings(response.body);
                    if (result.status === "SUCCESS") {
                        console.log(`     ✅ Found ${result.merchants.length}`);
                        success = true;
                        successCount++;

                        const merchantObs = result.merchants.map((m: any) => ({
                            run_id: runId, market_id: market.market_id, city: market.city,
                            observed_at: now.toISOString(), category: obj.surface === "bestOfLunch" ? "None" : (obj.name === "Home" ? "None" : obj.name), 
                            surface: obj.surface, merchant_name: m.merchant_name, store_id: m.store_id, 
                            rank: m.rank, is_sponsored: m.is_sponsored, has_discount: m.has_discount, 
                            delivery_fee: m.delivery_fee, rating: m.rating, review_count: m.review_count,
                            raw_snippet: ""
                        }));

                        if (merchantObs.length > 0) {
                            try {
                                await pushToApi(apiUrl, apiKey, { run_id: runId, base_run_id: runId, shard: manualShard }, merchantObs);
                                const s = merchantObs.filter(o => o.is_sponsored).length;
                                const d = merchantObs.filter(o => o.has_discount).length;
                                console.log(`     ✅ Ingested ${merchantObs.length} items (S: ${s}, D: ${d})`);
                            } catch (e: any) {
                                console.error(`     ❌ Ingest API Failed: ${e.message}`);
                            }
                        }
                    } else {
                        console.log(`     ⚠️  Parse Failed: ${result.status}`);
                        lastFailureReason = `${obj.name}: ${result.status}`;
                    }
                } else if (statusCode === 401 || statusCode === 403) {
                    console.log(`     ⚠️  HTTP ${statusCode} (Cloudflare Block / Expired Session)`);
                    if (sessionCookies) markBanned(sessionCookies);
                    lastFailureReason = `${obj.name}: HTTP ${statusCode}`;
                } else {
                    console.log(`     ⚠️  HTTP ${statusCode} Error`);
                    lastFailureReason = `${obj.name}: HTTP ${statusCode}`;
                }
            } catch (e: any) {
                console.log(`     💥 Error: ${e.message.split('\n')[0]}`);
                lastFailureReason = `${obj.name} Fetch Error`;
            }

            if (!success) {
                failCount++;
            }
        }
    }

    const finalStatus = failCount === 0 ? "SUCCESS" : (successCount > 0 ? "PARTIAL" : "FAILED");
    const runData = {
        run_id: runId, shard: manualShard, shard_total: SHARDS_TOTAL, status: finalStatus,
        started_at: now.toISOString(), ended_at: new Date().toISOString(),
        failure_reason: lastFailureReason, metadata: { successCount, failCount }
    };

    console.log(`\nShard Result: ${finalStatus} (${successCount} S, ${failCount} F)`);
    await pushToApi(apiUrl, apiKey, runData, []);

    return finalStatus;
}
