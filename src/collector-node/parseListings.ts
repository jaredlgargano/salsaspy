export interface ExtractedMerchant {
    merchant_name: string;
    rank: number;
    is_sponsored: boolean;
    has_discount: boolean;
    offer_title: string | null;
    raw_snippet: string;
    store_id: string | null;
    discount_type: string | null;
    delivery_fee: string | null;
    rating: number | null;
    review_count: number | null;
    source?: string;
    raw_badges?: any[];
}

export type ParseStatus = "SUCCESS" | "BLOCKED" | "JS_REQUIRED" | "PARSE_SCHEMA_CHANGED";

export interface ParseResult {
    status: ParseStatus;
    merchants: ExtractedMerchant[];
}

export function parseListings(jsonStr: string): ParseResult {
    if (!jsonStr || jsonStr.length < 50) return { status: "PARSE_SCHEMA_CHANGED", merchants: [] };

    let data;
    try {
        data = JSON.parse(jsonStr);
    } catch (e) {
        return { status: "PARSE_SCHEMA_CHANGED", merchants: [] };
    }

    if (data.errors && data.errors.length > 0) {
        // If GraphQL throws an error like rate limit or validation
        return { status: "BLOCKED", merchants: [] };
    }

    const feedBody = data.data?.searchWithFilterFacetFeed?.body || [];
    
    // Recursive flatten
    const flattenNodes = (nodes: any[]): any[] => {
        let results: any[] = [];
        for (const n of nodes) {
            results.push(n);
            if (n.items) results.push(...flattenNodes(n.items));
            if (n.body) results.push(...flattenNodes(n.body));
            if (n.childrenMap) results.push(...flattenNodes(n.childrenMap));
            if (n.children) results.push(...flattenNodes(n.children));
        }
        return results;
    };

    const nodes = flattenNodes(feedBody);
    
    const storeNodes = nodes.filter(n => 
        n && n.events && n.events.click && typeof n.events.click.data === 'string' && n.events.click.data.includes('store/')
    );
    
    const merchants: ExtractedMerchant[] = [];
    let rank = 1;

    for (let i = 0; i < storeNodes.length; i++) {
        const store = storeNodes[i];
        
        try {
            const clickData = JSON.parse(store.events.click.data);
            const matchId = clickData.uri?.match(/store\/(\d+)/);
            const storeId = matchId ? matchId[1] : null;
            if (!storeId) continue;

            const name = store.text?.title || store.name || "Unknown";
            let rating = null;
            let deliveryFee = "";
            let isSponsored = false;
            let hasDiscount = false;
            let offerTitle = null;
            
            const rawStr = JSON.stringify(store);
            const texts = [
                store.text?.subtitle,
                store.text?.description,
                store.text?.accessory
            ].filter(Boolean);
            
            for (const t of texts) {
                if (t.includes('★') || t.includes('.')) {
                    const match = t.match(/(\d+\.\d+)/);
                    if (match) rating = Number(match[1]);
                }
                if (t.toLowerCase().includes('delivery') || t.includes('$')) {
                    deliveryFee = t;
                }
            }

            if (rawStr.includes('Sponsored') || rawStr.includes('ad_impression') || store.logging?.includes('ad_impression')) {
                isSponsored = true;
            }
            
            if (rawStr.toLowerCase().includes('offer') || rawStr.includes('discount') || rawStr.includes('% off')) {
                hasDiscount = true;
                // Roughly attach the best subtitle as the offer title if applicable
                offerTitle = texts.find(t => t.includes('off') || t.toLowerCase().includes('offer')) || null;
            }

            // Deduplicate (Sponsorship takes precedence)
            const existing = merchants.find(m => m.store_id === storeId);
            if (existing) {
                if (isSponsored) existing.is_sponsored = true;
                if (hasDiscount) existing.has_discount = true;
            } else {
                merchants.push({
                    rank: rank++,
                    store_id: storeId,
                    merchant_name: name,
                    rating,
                    delivery_fee: deliveryFee,
                    is_sponsored: isSponsored,
                    has_discount: hasDiscount,
                    offer_title: offerTitle,
                    discount_type: hasDiscount ? "PROMOTION" : null,
                    review_count: null, // Hard to extract reliably from this payload
                    source: "graphql_direct"
                } as ExtractedMerchant);
            }
        } catch (e) {}
    }

    if (merchants.length > 0) {
        return { status: "SUCCESS", merchants };
    }

    return { status: "PARSE_SCHEMA_CHANGED", merchants: [] };
}
