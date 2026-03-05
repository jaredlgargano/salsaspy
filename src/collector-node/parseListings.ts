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
    $('a[href*="/store/"]').filter((i, el) => {
        const href = $(el).attr('href') || "";
        return !href.includes('search_type=') && $(el).text().trim().length > 0;
    }).each((i, el) => {
        const href = $(el).attr('href') || "";
        let store_id = null;
        const matchStore = href.match(/\/store\/(\d+)/);
        if (matchStore) {
            store_id = matchStore[1];
        }

        const name = $(el).find('[data-telemetry-id="store.name"]').text() || $(el).find('h2, h3, span').first().text();
        const text = $(el).text();
        const is_sponsored = text.includes('Sponsored');
        const pricingInfo = $(el).find('[data-testid="STORE_TEXT_PRICING_INFO"]').text() || $(el).find('[color="discount"]').text() || "";

        const has_discount = pricingInfo.toLowerCase().includes('fee') || pricingInfo.toLowerCase().includes('off') || pricingInfo.toLowerCase().includes('promo');

        let delivery_fee = null;
        const feeMatch = pricingInfo.match(/\$?([0-9.]+)\s*delivery fee/i);
        if (feeMatch) {
            delivery_fee = feeMatch[1];
        } else if (pricingInfo.toLowerCase().includes("0 delivery fee") || pricingInfo.toLowerCase().includes("free delivery")) {
            delivery_fee = "0";
        }

        let rating = null;
        let review_count = null;
        const ratingMatch = text.match(/([0-9]\.[0-9]).*?\(([0-9]+[kK]?\+?)\)/);
        if (ratingMatch) {
            rating = parseFloat(ratingMatch[1]);
            let rcStr = ratingMatch[2].toLowerCase();
            if (rcStr.includes('k')) {
                review_count = parseFloat(rcStr) * 1000;
            } else {
                review_count = parseInt(rcStr);
            }
        }

        if (name && name !== "Sponsored") {
            merchants.push({
                merchant_name: name.trim(),
                rank: rank++,
                is_sponsored,
                has_discount,
                offer_title: pricingInfo ? pricingInfo.trim() : null,
                raw_snippet: text.substring(0, 200).replace(/\s+/g, ' '),
                store_id,
                discount_type: has_discount ? pricingInfo.trim() : null,
                delivery_fee,
                rating,
                review_count
            });
        }
    });

    if (merchants.length > 0) {
        return { status: "SUCCESS", merchants };
    }

    // If nothing found, but not blocked
    return { status: "PARSE_SCHEMA_CHANGED", merchants: [] };
}
