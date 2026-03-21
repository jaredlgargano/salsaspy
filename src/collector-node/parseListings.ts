import * as cheerio from 'cheerio';

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
}

export type ParseStatus = "SUCCESS" | "BLOCKED" | "JS_REQUIRED" | "PARSE_SCHEMA_CHANGED";

export interface ParseResult {
    status: ParseStatus;
    merchants: ExtractedMerchant[];
}

export function parseListings(html: string): ParseResult {
    if (html.includes("cf-browser-verification") || html.includes("px-captcha") || html.includes("Pardon Our Interruption") || html.includes("Access Denied")) {
        return { status: "BLOCKED", merchants: [] };
    }

    if (html.includes("You need to enable JavaScript to run this app.") || html.length < 5000) {
        return { status: "JS_REQUIRED", merchants: [] };
    }

    const merchants: ExtractedMerchant[] = [];
    const $ = cheerio.load(html);
    let rank = 1;

    // 1. Extract from Scripts (Apollo / NEXT_DATA)
    $('script').each((idx, s) => {
        const content = $(s).html() || '';
        const scriptId = $(s).attr('id') || '';
        if (content.includes('__NEXT_DATA__') || content.includes('__APOLLO_STATE__')) {
            try {
                if (content.includes('__NEXT_DATA__')) {
                    const clean = content.trim().startsWith('{') ? content : content.match(/\{.*\}/)?.[0];
                    if (clean) {
                        const parsed = JSON.parse(clean);
                        findMerchantsNested(parsed);
                    }
                } else if (content.includes('__APOLLO_STATE__')) {
                    const jsonMatch = content.match(/__APOLLO_STATE__\s*=\s*(\{.*?\});?$/m) || 
                                     content.match(/(\{.*\})/);
                    if (jsonMatch) {
                        const data = JSON.parse(jsonMatch[1]);
                        Object.values(data).forEach((val: any) => {
                            if (val && (val.__typename === 'Store' || val.__typename === 'Merchant' || val.__typename === 'Business')) {
                                addMerchantFromData(val);
                            }
                        });
                        // Also search the whole tree in case they aren't top-level
                        findMerchantsNested(data);
                    }
                }
            } catch (e) {}
        }
    });

    function findMerchantsNested(obj: any) {
        if (!obj || typeof obj !== 'object') return;
        if (obj.__typename === 'Store' || obj.__typename === 'Merchant' || obj.store_id || obj.business_id) {
            addMerchantFromData(obj);
        }
        if (Array.isArray(obj)) {
            obj.forEach(i => findMerchantsNested(i));
        } else {
            Object.values(obj).forEach(v => findMerchantsNested(v));
        }
    }

    function addMerchantFromData(item: any) {
        const name = item.store_name || item.merchant_name || item.name || item.business_name;
        const store_id = item.store_id || item.business_id || item.id || item.id_str;
        if (!name || !store_id || String(name).toLowerCase().includes('doordash')) return;
        
        if (merchants.some(m => m.store_id === String(store_id))) return;

        const is_sponsored = !!(item.is_sponsored || item.isSponsored || item.ad_id || item.isAd || item.is_promoted);
        const offers = item.offers || item.promotions || [];
        const has_discount = !!(item.has_discount || (Array.isArray(offers) && offers.length > 0));
        const firstOffer = Array.isArray(offers) && offers.length > 0 ? (offers[0].title || offers[0].text) : null;

        merchants.push({
            merchant_name: String(name).trim(),
            rank: rank++,
            is_sponsored,
            has_discount,
            offer_title: item.offer_title || firstOffer || item.delivery_fee_str || null,
            raw_snippet: JSON.stringify(item).substring(0, 200),
            store_id: String(store_id),
            discount_type: item.discount_type || (has_discount ? "PROMOTION" : null),
            delivery_fee: String(item.delivery_fee || item.delivery_fee_amount || item.deliveryFee || ""),
            rating: item.star_rating || item.rating || item.average_rating || null,
            review_count: item.num_star_rating || item.review_count || item.ratings_count || null
        });
    }

    // 2. DOM Supplement
    $('[data-anchor-id="StoreCard"], [data-testid="StoreCard"], a[href*="/store/"]').each((i, el) => {
        const $el = $(el);
        const href = $el.attr('href') || $el.find('a[href*="/store/"]').attr('href') || "";
        const matchStore = href.match(/\/store\/([^\/?#]+)/);
        if (!matchStore) return;
        const store_id = matchStore[1];

        const name = $el.find('[data-telemetry-id="store.name"]').text() || 
                     $el.find('h2, h3, span').first().text();
        
        if (!name || name.trim() === "" || name.trim().length > 100) return;

        const text = $el.text();
        const is_sponsored = text.includes('Sponsored') || text.includes('Ad') || 
                             $el.find('[aria-label*="Sponsored"]').length > 0 ||
                             $el.find('[data-testid="sponsored-badge"]').length > 0;
        
        const offerText = $el.find('[data-testid*="offer"]').text() || 
                          $el.find('[data-testid="STORE_TEXT_PRICING_INFO"]').text() || 
                          $el.find('[color="discount"]').text() || "";
        
        const lowerOffer = offerText.toLowerCase();
        const has_discount = lowerOffer.includes(' off') || lowerOffer.includes('promo') || 
                             lowerOffer.includes('discount') || lowerOffer.includes('save ') || 
                             lowerOffer.includes('free delivery');

        const existingIdx = merchants.findIndex(m => m.store_id === store_id);
        if (existingIdx !== -1) {
            const existing = merchants[existingIdx];
            if (is_sponsored) existing.is_sponsored = true;
            if (has_discount) existing.has_discount = true;
        } else {
            merchants.push({
                merchant_name: name.trim(),
                rank: rank++,
                is_sponsored,
                has_discount,
                offer_title: offerText.trim() || null,
                raw_snippet: text.substring(0, 200).replace(/\s+/g, ' '),
                store_id: String(store_id),
                discount_type: has_discount ? "PROMOTION" : null,
                delivery_fee: null,
                rating: null,
                review_count: null
            });
        }
    });

    return merchants.length > 0 ? { status: "SUCCESS", merchants } : { status: "PARSE_SCHEMA_CHANGED", merchants: [] };
}
