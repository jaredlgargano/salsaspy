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
    source?: string;
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

    const $ = cheerio.load(html);
    let rank = 1;
    const merchantMap = new Map<string, ExtractedMerchant>();

    // Centralized Metadata Extraction Logic
    function getMetadata(item: any, customData: any = {}) {
        const itemStr = JSON.stringify(item).toLowerCase();
        const promo_title = String(item.promotion_title || item.promotionTitle || customData.promotion_title || customData.promotionTitle || item.subtitle || item.accessory_text || item.description || customData.subtitle || item.offer_title || "").toLowerCase();
        
        const is_sponsored = !!(
            item.is_sponsored || item.isSponsored || item.ad_id || item.isAd || item.is_promoted || item.sponsored || 
            customData.is_sponsored || customData.isSponsored || customData.ad_id || 
            (item.logging && (item.logging.includes('ad_id') || item.logging.includes('adId'))) ||
            (item.source === 'dom' && (itemStr.includes('sponsored') || itemStr.includes(' ad ')))
        );

        const offers = item.offers || item.promotions || customData.offers || [];
        const has_discount = !!(
            item.has_discount || item.hasDiscount || customData.has_discount || customData.hasDiscount || 
            (Array.isArray(offers) && offers.length > 0) ||
            promo_title.includes('off') || promo_title.includes('save') || promo_title.includes('$0') || 
            promo_title.includes('free') || promo_title.includes('promo') || promo_title.includes('reduced') ||
            itemStr.includes('off on $') || itemStr.includes('save $')
        );

        const rating = item.star_rating || item.rating || item.average_rating || customData.rating?.average_rating || customData.rating || null;
        const reviewCount = item.num_star_rating || item.review_count || item.ratings_count || customData.rating?.display_num_ratings || null;
        
        return { is_sponsored, has_discount, rating, reviewCount, promo_title, offers };
    }

    // Helper to merge or add merchant
    function addMerchantFromData(item: any) {
        if (!item || typeof item !== 'object') return;
        
        let customData: any = {};
        if (typeof item.custom === 'string' && item.custom.startsWith('{')) {
            try { customData = JSON.parse(item.custom); } catch (e) {}
        }

        let store_id = String(item.store_id || item.business_id || item.id || item.id_str || customData.store_id || '');
        if (store_id.startsWith('row.store:')) store_id = store_id.split(':')[1];
        else if (store_id.includes('-')) {
            const match = store_id.match(/-([0-9]+)$/);
            if (match) store_id = match[1];
        }
        
        if (!store_id || store_id === 'undefined' || store_id === 'null' || store_id === '') return;

        const { is_sponsored, has_discount, rating, reviewCount, promo_title, offers } = getMetadata(item, customData);
        const availability = item.is_currently_available || customData.is_currently_available;
        const firstOffer = Array.isArray(offers) && offers.length > 0 ? (offers[0].title || offers[0].text) : null;
        const finalOffer = item.offer_title || (promo_title.length > 3 ? promo_title : null) || firstOffer;

        if (merchantMap.has(store_id)) {
            const existing = merchantMap.get(store_id)!;
            if (is_sponsored) existing.is_sponsored = true;
            if (has_discount) existing.has_discount = true;
            if (!existing.offer_title && finalOffer) existing.offer_title = String(finalOffer);
            if (!existing.rating && rating) existing.rating = Number(rating);
            if (!existing.review_count && reviewCount) existing.review_count = Number(reviewCount);
            
            const nameCandidate = item.store_name || item.merchant_name || item.name || customData.store_name || "";
            if (nameCandidate && nameCandidate.length > existing.merchant_name.length && !nameCandidate.toLowerCase().includes('sticks') && !nameCandidate.toLowerCase().includes('bread')) {
                existing.merchant_name = String(nameCandidate);
            }
            return;
        }

        const name = item.store_name || item.merchant_name || item.name || item.business_name || item.title || item.text?.title;
        if (!name || String(name).toLowerCase().includes('doordash')) return;
        
        const lowerName = name.toLowerCase();
        if (['all', 'alcohol', 'grocery', 'restaurant', 'deals', 'convenience'].includes(lowerName)) return;
        const isItemName = lowerName.includes(' inch') || lowerName.includes(' pizza') || lowerName.includes(' bread') || 
                           lowerName.includes(' salad') || lowerName.includes(' wings') || lowerName.includes(' slice') ||
                           lowerName.includes(' sticks') || lowerName.includes(' bites') || lowerName.includes(' side');
        if (isItemName) return;

        const isSecureStore = (rating !== null) || (reviewCount !== null) || (availability !== undefined) || 
                             item.__typename === 'Store' || item.source === 'dom' || item.source === 'regex' ||
                             is_sponsored || has_discount;
        
        if (!isSecureStore) return;

        merchantMap.set(store_id, {
            merchant_name: String(name).replace(/\\u0026/g, '&'),
            rank: rank++,
            is_sponsored,
            has_discount,
            offer_title: finalOffer ? String(finalOffer).replace(/\\u0026/g, '&') : null,
            raw_snippet: JSON.stringify(item).substring(0, 300),
            store_id: store_id,
            discount_type: item.discount_type || (has_discount ? "PROMOTION" : null),
            delivery_fee: String(item.delivery_fee || item.delivery_fee_amount || item.deliveryFee || ""),
            rating: rating ? Number(rating) : null,
            review_count: reviewCount ? Number(reviewCount) : null,
            source: item.source || 'script'
        });
    }

    function findMerchantsNested(obj: any) {
        if (!obj || typeof obj !== 'object') return;
        if (obj.__typename === 'Store' || obj.__typename === 'Merchant' || obj.__typename === 'Business' || obj.__typename === 'FacetV2' || obj.store_id || obj.business_id || obj.id || obj.id_str) {
            addMerchantFromData(obj);
        }
        if (Array.isArray(obj)) {
            obj.forEach(i => findMerchantsNested(i));
        } else {
            Object.values(obj).forEach(v => findMerchantsNested(v));
        }
    }

    // 1. Extract from Scripts
    $('script').each((idx, s) => {
        const content = $(s).html() || '';
        const id = $(s).attr('id') || '';
        try {
            if (content.includes('__NEXT_DATA__') || id === '__NEXT_DATA__') {
                const clean = content.trim().startsWith('{') ? content : content.match(/\{.*\}/)?.[0];
                if (clean) findMerchantsNested(JSON.parse(clean));
            } else if (content.includes('__APOLLO_STATE__') || id === '__APOLLO_STATE__') {
                const jsonMatch = content.match(/__APOLLO_STATE__\s*=\s*(\{.*?\});?$/m) || content.match(/(\{.*\})/);
                if (jsonMatch) findMerchantsNested(JSON.parse(jsonMatch[1]));
            } else if (content.includes('self.__next_f.push')) {
                const matches = content.matchAll(/self\.__next_f\.push\(\[1,"([^"]+)"\]\)/g);
                for (const m of matches) {
                    try {
                        const unescaped = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                        const jsonContent = unescaped.match(/(\{.*\})/);
                        if (jsonContent) findMerchantsNested(JSON.parse(jsonContent[1]));
                    } catch (e) {}
                }
            }
        } catch (e: any) {}
    });

    // 2. Fallback to DOM (Cheerio)
    $('[data-anchor-id="StoreCard"], [data-testid="StoreCard"], a[href*="/store/"]').each((i, el) => {
        const $el = $(el);
        const name = $el.find('[data-testid="StoreName"], h3, h2, span[title]').first().text() || $el.find('span').first().text() || $el.attr('aria-label') || "";
        const href = $el.attr('href') || $el.find('a[href*="/store/"]').attr('href') || "";
        const store_id = href.match(/\/store\/[^/]+-([0-9]+)/)?.[1] || href.match(/\/store\/([^\/?#]+)/)?.[1] || "";
        const offerText = $el.find('[data-testid*="offer"], [data-testid="STORE_TEXT_PRICING_INFO"], [color="discount"]').text() || "";
        
        if (name && store_id) {
            addMerchantFromData({ name, store_id, offer_title: offerText, source: 'dom' });
        }
    });

    // 3. Deep Scan (Regex)
    const storeIdMatches = html.matchAll(/\\{0,7}"store_id\\{0,7}":\\{0,7}"([0-9]+)\\{0,7}"/g);
    for (const match of storeIdMatches) {
        const storeId = match[1];
        const pos = match.index || 0;
        const context = html.substring(Math.max(0, pos - 2500), Math.min(html.length, pos + 2500));
        
        const titleMatch = context.match(/\\{0,7}"(?:title|name|merchant_name)\\{0,7}":\\{0,7}"((?:\\\\"|[^"])*?)\\{0,7}"/);
        const promoMatch = context.match(/\\{0,7}"(?:promotion_title|promotionTitle|subtitle|accessory_text|description)\\{0,7}":\\{0,7}"((?:\\\\"|[^"])*?(?:off|save|promo|free|reduced|\$[0-9])(?:\\\\"|[^"])*?)\\{0,7}"/i);
        const sponsoredMatch = context.match(/\\{0,7}"(?:is_sponsored|isSponsored|is_promoted)\\{0,7}":\\{0,7}"?(?:true|1)\\{0,7}"?/i);
        const adMatch = context.match(/\\{0,7}"(?:ad_id|_ad_id|adId)\\{0,7}":\\{0,7}"([^\\"n][^\\"]*)\\{0,7}"/);

        if (titleMatch) {
            addMerchantFromData({ 
                title: titleMatch[1].replace(/\\\\"/g, '"'), 
                store_id: storeId, 
                is_sponsored: !!(sponsoredMatch || adMatch),
                promotion_title: promoMatch?.[1]?.replace(/\\\\"/g, '"'),
                source: 'regex'
            });
        }
    }

    const merchants = Array.from(merchantMap.values()).sort((a, b) => a.rank - b.rank);
    return merchants.length > 0 ? { status: "SUCCESS", merchants } : { status: "PARSE_SCHEMA_CHANGED", merchants: [] };
}
