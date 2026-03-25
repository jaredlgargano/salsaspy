

export async function setDeliveryAddress(lat: number, lng: number, city: string, cookies: string): Promise<string | null> {
    const url = 'https://www.doordash.com/graphql';

    // Using a simplified mutation that is commonly used by the frontend to update the active location session
    const payload = {
        operationName: "addConsumerAddressV2",
        variables: {
            lat: lat,
            lng: lng,
            city: city || "Unknown",
            street: "1 Main St",
            state: "CA",
            zipCode: "90210",
            printableAddress: `${city || "Unknown"}, CA 90210`,
            shortname: city || "City",
            googlePlaceId: ""
        },
        query: `mutation addConsumerAddressV2($lat: Float!, $lng: Float!, $city: String!, $state: String!, $zipCode: String!, $printableAddress: String!, $shortname: String!, $googlePlaceId: String!) {
            addConsumerAddressV2(
                lat: $lat
                lng: $lng
                city: $city
                state: $state
                zipCode: $zipCode
                printableAddress: $printableAddress
                shortname: $shortname
                googlePlaceId: $googlePlaceId
            ) {
                id
            }
        }`
    };

    try {
        const { gotScraping } = await import('got-scraping');
        const res = await gotScraping({
            url,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Cookie": cookies,
                "Origin": "https://www.doordash.com",
                "Referer": "https://www.doordash.com/"
            },
            body: JSON.stringify(payload),
            headerGeneratorOptions: { browsers: ['chrome'], os: ['macos'] },
            timeout: { request: 15000 }
        });

        if (res.statusCode === 200) {
            console.log(`[SessionManager] Address bind success for ${city} (${lat}, ${lng})`);
            try {
                const bodyJson = JSON.parse(res.body);
                const addressId = bodyJson.data?.addConsumerAddressV2?.id;
                if (addressId) {
                    return `${cookies}; dd_active_address_id=${addressId}`;
                }
            } catch(e) { }
            return cookies;
        } else {
            console.error(`[SessionManager] Address bind failed: HTTP ${res.statusCode}`, res.body.substring(0, 200));
            return null;
        }
    } catch (e: any) {
        console.error(`[SessionManager] Address bind error: ${e.message}`);
        return null;
    }
}
