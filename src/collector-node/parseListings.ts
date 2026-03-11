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
    // Capability checks
    // 1. Are we blocked? (e.g. captcha, 403, Cloudflare/PerimeterX block page)
    if (html.includes("cf-browser-verification") || html.includes("px-captcha") || html.includes("Pardon Our Interruption") || html.includes("Access Denied")) {
        return { status: "BLOCKED", merchants: [] };
    }

    // 2. Do we require JS to see anything?
    if (html.includes("You need to enable JavaScript to run this app.") || html.length < 5000) {
        return { status: "JS_REQUIRED", merchants: [] };
    }

    const merchants: ExtractedMerchant[] = [];
    const $ = cheerio.load(html);

    let rank = 1;
    // More robust store card selection - catch them in carousels and lists
    $('[data-anchor-id="StoreCard"], [data-testid="StoreCard"], a[href*="/store/"]').each((i, el) => {
        const $el = $(el);
        const href = $el.attr('href') || $el.find('a[href*="/store/"]').attr('href') || "";
        
        // Skip if not a valid store link
        if (!href.includes('/store/')) return;
        if (href.includes('search_type=')) return;

        let store_id = null;
        const matchStore = href.match(/\/store\/(\d+)/);
        if (matchStore) {
            store_id = matchStore[1];
        } else {
            // Check for store_id in parent attributes or name
            const parentHref = $el.closest('a').attr('href');
            if (parentHref) {
                const pMatch = parentHref.match(/\/store\/(\d+)/);
                if (pMatch) store_id = pMatch[1];
            }
        }

        const name = $el.find('[data-telemetry-id="store.name"]').text() || 
                     $el.find('h2, h3, span').first().text();
        
        if (!name || name.trim() === "" || name.trim() === "Sponsored" || name.trim().length > 100) return;

        const text = $el.text();
        
        // Broaden sponsored check - DoorDash sometimes uses aria-label on an icon
        const is_sponsored = text.includes('Sponsored') || 
                             text.includes('Ad') || 
                             text.includes('Promoted') || 
                             $el.find('[aria-label*="Sponsored"]').length > 0 ||
                             $el.find('[aria-label*="Promoted"]').length > 0;
        
        // Collect offer text from multiple sources
        const specificOfferText = $el.find('[data-testid*="offer"]').text() || 
                                  $el.find('[data-testid="STORE_TEXT_PRICING_INFO"]').text() || 
                                  $el.find('[color="discount"]').text();
        
        // Fall back to reading the full card text to capture pricing info that doesn't have specific selectors
        const fullCardText = $el.text();
        const offerText = specificOfferText || fullCardText;
        
        const lowerOffer = offerText.toLowerCase();
        
        // A listing has a genuine discount if it explicitly mentions a promotion beyond the standard new-user offer.
        // The "$0 delivery fee, first order" string is a platform-wide new-user promo — NOT a restaurant discount.
        const standardNewUserPromo = lowerOffer.includes('$0 delivery fee') && lowerOffer.includes('first order');
        const has_discount = !standardNewUserPromo && (
            lowerOffer.includes(' off') || 
            lowerOffer.includes('promo') || 
            lowerOffer.includes('discount') || 
            lowerOffer.includes('save ') || 
            lowerOffer.includes('% off') ||
            lowerOffer.includes('free delivery') ||
            (lowerOffer.includes('$0 delivery') && !lowerOffer.includes('first order')) || // $0 delivery for existing users = real discount
            (lowerOffer.includes('reduced') && lowerOffer.includes('fee'))
        );

        let delivery_fee = null;
        const feeMatch = offerText.match(/\$?([0-9.]+)\s*delivery fee/i);
        if (feeMatch) {
            delivery_fee = feeMatch[1];
        } else if (lowerOffer.includes("0 delivery fee") || lowerOffer.includes("free delivery")) {
            delivery_fee = "0";
        }

        if (name) {
            // Deduplicate merchants by store_id if possible
            const existing = merchants.find(m => m.store_id === store_id && m.merchant_name === name.trim());
            if (existing) return;

            merchants.push({
                merchant_name: name.trim(),
                rank: rank++,
                is_sponsored,
                has_discount,
                offer_title: offerText ? offerText.trim() : null,
                raw_snippet: text.substring(0, 200).replace(/\s+/g, ' '),
                store_id,
                discount_type: has_discount ? offerText.trim() : null,
                delivery_fee,
                rating: null, // Basic extraction for now
                review_count: null
            });
        }
    });

    if (merchants.length > 0) {
        return { status: "SUCCESS", merchants };
    }

    // If nothing found, but not blocked
    return { status: "PARSE_SCHEMA_CHANGED", merchants: [] };
}
