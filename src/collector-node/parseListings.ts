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
    raw_badges?: any[];
}

export type ParseStatus = "SUCCESS" | "BLOCKED" | "JS_REQUIRED" | "PARSE_SCHEMA_CHANGED";

export interface ParseResult {
    status: ParseStatus;
    merchants: ExtractedMerchant[];
}

export function parseListings(html: string): ParseResult {
    if (!html || html.length < 200) return { status: "PARSE_SCHEMA_CHANGED", merchants: [] };

    const lower = html.toLowerCase();
    if (html.includes("cf-browser-verification") || html.includes("px-captcha") || 
        lower.includes("pardon our interruption") || lower.includes("access denied") || 
        lower.includes("just a moment") || lower.includes("enable cookies") || 
        lower.includes("checking your browser") || lower.includes("address needed") || 
        lower.includes("choose an address") || lower.includes("select your address")) {
        return { status: "BLOCKED", merchants: [] };
    }

    const isRawRsc = !html.includes('<html') && (html.match(/^[0-9]+:/) || html.includes('"$Sreact.fragment"') || html.includes('__typename'));
    
    if (!isRawRsc && (html.includes("You need to enable JavaScript to run this app.") || html.length < 4000)) {
        return { status: "JS_REQUIRED", merchants: [] };
    }

    const merchantMap = new Map<string, ExtractedMerchant>();
    let rank = 1;
    let rscCounter = 0;

    // Centralized Metadata Extraction Logic
    function getMetadata(item: any, customParams: any = {}) {
        const itemStr = JSON.stringify(item).toLowerCase();
        
        const promo_title = String(item.promotion_title || item.promotionTitle || customParams.promotion_title || customParams.promotionTitle || item.subtitle || item.accessory_text || item.description || customParams.subtitle || item.offer_title || "").toLowerCase();
        
        const offers = item.offers || item.promotions || customParams.offers || [];
        const badges = item.badges || customParams.badges || [];
        const card_position = typeof item.card_position === 'number' ? item.card_position : (typeof customParams.card_position === 'number' ? customParams.card_position : 999);

        // High-confidence signals (explicit fields)
        const hasExplicitAdField = !!(
            item.is_sponsored || item.isSponsored || item.ad_id || item.isAd || item.is_promoted || item.sponsored || 
            customParams.is_sponsored || customParams.isSponsored || customParams.ad_id || 
            (item.logging && String(JSON.stringify(item.logging)).includes('ad_id'))
        );

        // Broad semantic signals (text and aria)
        const hasAdSemantic = (
            /("sponsored"|"ad"|"promoted"|aria-label":"sponsored)/i.test(itemStr) ||
            /("text":"(ad|sponsored|promoted)")/i.test(itemStr) ||
            (Array.isArray(badges) && badges.some((b: any) => {
                const bText = String(b.text || "").toLowerCase();
                return bText === 'ad' || bText === 'sponsored' || bText === 'promoted';
            }))
        );

        const is_sponsored = hasExplicitAdField || hasAdSemantic || (card_position < 2 && item.source !== 'dom' && item.__typename === 'Store');

        const has_discount = !!(
            item.has_discount || item.hasDiscount || customParams.has_discount || customParams.hasDiscount || 
            (Array.isArray(offers) && offers.length > 0) ||
            (Array.isArray(badges) && badges.some((b: any) => {
                const bText = String(b.text || "").toLowerCase();
                return bText.includes('off') || bText.includes('save') || bText.includes('promo') || bText.includes('deal');
            })) ||
            promo_title.includes('off') || promo_title.includes('save') || promo_title.includes('$0') || 
            promo_title.includes('free') || promo_title.includes('promo') || promo_title.includes('reduced') ||
            itemStr.includes('off on $') || itemStr.includes('save $')
        );

        const rating = item.star_rating || item.rating || item.average_rating || customParams.rating?.average_rating || customParams.rating || null;
        const reviewCount = item.num_star_rating || item.review_count || item.ratings_count || customParams.rating?.display_num_ratings || null;
        
        return { is_sponsored, has_discount, rating, reviewCount, promo_title, offers, badges };
    }

    // Helper to merge or add merchant
    function addMerchantFromData(item: any, customParams: any = {}) {
        if (!item || typeof item !== 'object') return;
        
        let customData: any = {};
        if (typeof item.custom === 'string' && item.custom.startsWith('{')) {
            try { customData = JSON.parse(item.custom); } catch (e) {}
        }

        const meta = getMetadata(item, { ...customData, ...customParams });
        let store_id = String(item.store_id || item.business_id || item.id || item.id_str || customData.store_id || customParams.store_id || '');
        if (!store_id || store_id === "undefined") return;

        if (merchantMap.has(store_id)) {
            const existing = merchantMap.get(store_id)!;
            if (meta.is_sponsored) existing.is_sponsored = true;
            if (meta.has_discount) existing.has_discount = true;
            if (meta.promo_title && !existing.offer_title) existing.offer_title = meta.promo_title;
            if (meta.rating && !existing.rating) existing.rating = Number(meta.rating);
            if (meta.reviewCount && !existing.review_count) existing.review_count = Number(meta.reviewCount);
            return;
        }

        merchantMap.set(store_id, {
            store_id,
            merchant_name: String(item.merchant_name || item.name || item.title || item.text?.title || customData.name || customParams.name || "Unknown").replace(/\\u0026/g, '&'),
            is_sponsored: meta.is_sponsored,
            has_discount: meta.has_discount,
            rank: customParams.rank || rank++,
            offer_title: meta.promo_title ? String(meta.promo_title).replace(/\\u0026/g, '&') : null,
            discount_type: item.discount_type || (meta.has_discount ? "PROMOTION" : null),
            delivery_fee: String(item.delivery_fee || item.delivery_fee_amount || item.deliveryFee || ""),
            rating: meta.rating ? Number(meta.rating) : null,
            review_count: meta.reviewCount ? Number(meta.reviewCount) : null,
            source: item.source || customParams.source || 'script',
            raw_badges: meta.badges,
            raw_snippet: JSON.stringify({ ...item, ...customParams }).substring(0, 1000)
        });
    }

    function findMerchantsNested(obj: any, customParams: any = {}) {
        if (!obj || typeof obj !== 'object') return;
        
        const isMerchant = obj.__typename === 'Store' || obj.__typename === 'Merchant' || 
                           obj.__typename === 'Business' || obj.__typename === 'FacetV2' ||
                           obj.store_id || obj.business_id || (obj.id && obj.merchant_name);
                           
        if (isMerchant) {
            addMerchantFromData(obj, customParams);
        }
        
        if (Array.isArray(obj)) {
            obj.forEach(i => findMerchantsNested(i, customParams));
        } else {
            for (const key in obj) {
                if (key !== '__typename' && typeof obj[key] === 'object') {
                    findMerchantsNested(obj[key], customParams);
                }
            }
        }
    }

    // 1. Raw RSC Path
    if (isRawRsc) {
        const jsonBlocks = html.match(/\{"__typename":"Store",.*?\}/g) || html.match(/\{.*?\}/g);
        if (jsonBlocks) {
            for (const block of jsonBlocks) {
                try {
                    const parsed = JSON.parse(block);
                    findMerchantsNested(parsed, { source: 'script', card_position: rscCounter++ });
                } catch (e) {}
            }
        }
        const merchants = Array.from(merchantMap.values()).sort((a, b) => a.rank - b.rank);
        if (merchants.length > 0) return { status: "SUCCESS", merchants };
    }

    // 2. HTML Path (Cheerio)
    const $ = cheerio.load(html);

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
                const matches = content.matchAll(/self\.__next_f\.push\(\[([0-9]),\s*"([^"]+)"\]\)/g);
                for (const m of matches) {
                    try {
                        const payload = m[2];
                        const unescaped = payload.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                        // Use a broader match and then filter in findMerchantsNested
                        const jsonBlocks = unescaped.match(/\{.*?\}/g);
                        if (jsonBlocks) {
                            for (const block of jsonBlocks) {
                                try { 
                                    const parsed = JSON.parse(block);
                                    findMerchantsNested(parsed, { source: 'script', card_position: rscCounter++ });
                                } catch (e) {}
                            }
                        }
                    } catch (e) {}
                }
            }
        } catch (e: any) {}
    });

    // 2. Fallback to DOM (Cheerio)
    $('[data-anchor-id="StoreCard"], [data-testid="StoreCard"], a[href*="/store/"]').each((i, el) => {
        const $el = $(el);
        const name = $el.find('[data-testid="StoreName"], h3, h2, span[title]').first().text() || $el.attr('aria-label') || "";
        const href = $el.attr('href') || $el.find('a[href*="/store/"]').attr('href') || "";
        const store_id = href.match(/\/store\/[^/]+-([0-9]+)/)?.[1] || href.match(/\/store\/([^\/?#]+)/)?.[1] || "";
        const is_sponsored = $el.text().toLowerCase().includes('sponsored') || $el.text().toLowerCase().includes(' ad ');
        
        if (name && store_id) {
            addMerchantFromData({ name, store_id, is_sponsored, source: 'dom' }, { card_position: i });
        }
    });

    // 3. Deep Scan (Regex)
    const storeIdMatches = html.matchAll(/"store_id":\s*"([0-9]+)"/g);
    for (const match of storeIdMatches) {
        const storeId = match[1];
        const pos = match.index || 0;
        const context = html.substring(Math.max(0, pos - 1000), Math.min(html.length, pos + 1000));
        const titleMatch = context.match(/"(?:title|name|merchant_name)":\s*"([^"]+)"/);
        if (titleMatch) {
            addMerchantFromData({ name: titleMatch[1], store_id: storeId, source: 'regex' });
        }
    }

    // 4. Brute Force (Final Fallback)
    if (merchantMap.size === 0) {
        // Look for any Store-like objects in the entire HTML (handles escaped JSON too)
        const blocks = html.match(/\\{0,7}"__typename\\{0,7}":\\{0,7}"Store\\{0,7}".*?\\{0,7}\}/g) || 
                       html.match(/\{"__typename":"Store".*?\}/g);
        if (blocks) {
            for (const b of blocks) {
                try {
                    // Try to clean/unescape for JSON.parse
                    let clean = b;
                    if (b.includes('\\"')) {
                         clean = b.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                    }
                    if (!clean.startsWith('{')) clean = '{' + clean;
                    if (!clean.endsWith('}')) clean = clean + '}';
                    
                    const parsed = JSON.parse(clean);
                    findMerchantsNested(parsed, { source: 'brute', card_position: rscCounter++ });
                } catch (e) {}
            }
        }
    }

    const merchants = Array.from(merchantMap.values()).sort((a, b) => a.rank - b.rank);
    return merchants.length > 0 ? { status: "SUCCESS", merchants } : { status: "PARSE_SCHEMA_CHANGED", merchants: [] };
}
