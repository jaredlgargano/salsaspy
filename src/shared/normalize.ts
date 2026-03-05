const BRAND_MAP: Record<string, string> = {
    "chipotle": "Chipotle",
    "chipotle mexican grill": "Chipotle",
    "taco bell": "Taco Bell",
    "panera bread": "Panera Bread",
    "panera": "Panera Bread",
    "mcdonalds": "McDonald’s",
    "mcdonald's": "McDonald’s",
    "mcdonald’s": "McDonald’s",
    "chick-fil-a": "Chick-fil-A",
    "chick fil a": "Chick-fil-A",
    "burger king": "Burger King",
    "kfc": "KFC",
    "kentucky fried chicken": "KFC",
    "wendys": "Wendy’s",
    "wendy's": "Wendy’s",
    "wendy’s": "Wendy’s"
};

export function normalizeBrand(rawMerchantName: string): string {
    let clean = rawMerchantName.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
        .trim();

    // Strip franchise and location suffixes (e.g. #1234, - Downtown, LLC, Inc)
    clean = clean.replace(/\s*#\d+.*$/, '');
    clean = clean.replace(/\s*-\s*.*$/, '');
    clean = clean.replace(/\s+(llc|inc)\b/i, '');
    clean = clean.trim();

    for (const [key, value] of Object.entries(BRAND_MAP)) {
        if (clean === key || clean.startsWith(key)) {
            return value;
        }
    }

    // Fallback: Return original but without the junk suffix
    return rawMerchantName.replace(/\s*#\d+.*$/, '').replace(/\s*-\s*.*$/, '').trim();
}

export function isKnownBrand(rawMerchantName: string): boolean {
    let clean = rawMerchantName.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .trim();

    clean = clean.replace(/\s*#\d+.*$/, '');
    clean = clean.replace(/\s*-\s*.*$/, '');
    clean = clean.replace(/\s+(llc|inc)\b/i, '');
    clean = clean.trim();

    for (const [key, _] of Object.entries(BRAND_MAP)) {
        if (clean === key || clean.startsWith(key)) {
            return true;
        }
    }
    return false;
}
