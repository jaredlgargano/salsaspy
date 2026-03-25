import fs from 'fs';

function parseGraphQL() {
    const raw = fs.readFileSync('scripts/graphql-out.json', 'utf-8');
    const data = JSON.parse(raw);
    
    const feedBody = data.data?.searchWithFilterFacetFeed?.body || [];
    
    // Flatten all store nodes
    const flattenNodes = (nodes) => {
        let results = [];
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
    console.log(`Flattened ${nodes.length} total node fragments`);

    const merchants = [];
    
    // We look for nodes that represent a store
    // A store node usually has `component.category === "Store"` or we can find it by looking for `name` and `style`
    // Or we can just look for nodes that contain `text.title` matching a store name.
    
    // In GraphQL FacetFeedV2, a store is usually a FacetV2 component.
    // Let's filter for nodes that have `text` and `images` and `events.click.data`.
    const storeNodes = nodes.filter(n => 
        n && n.events && n.events.click && typeof n.events.click.data === 'string' && n.events.click.data.includes('store/')
    );
    
    console.log(`Found ${storeNodes.length} storeNodes with click.data URL containing store/`);
    
    for (let i = 0; i < storeNodes.length; i++) {
        const store = storeNodes[i];
        
        try {
            const clickData = JSON.parse(store.events.click.data);
            const matchId = clickData.uri?.match(/store\/(\d+)/);
            const storeId = matchId ? matchId[1] : null;
            if (!storeId) continue;

            const name = store.text?.title || store.name;
            let rating = null;
            let reviewCount = null;
            let deliveryFee = null;
            let isSponsored = false;
            let hasDiscount = false;
            
            // Check descriptions / subtitles for rating and delivery fee
            const rawStr = JSON.stringify(store);
            const texts = [
                store.text?.subtitle,
                store.text?.description,
                store.text?.accessory
            ].filter(Boolean);
            
            for (const t of texts) {
                if (t.includes('★') || t.includes('.')) {
                    const match = t.match(/(\d+\.\d+)/);
                    if (match) rating = match[1];
                }
                if (t.toLowerCase().includes('delivery') || t.includes('$')) {
                    deliveryFee = t;
                }
            }

            // Check sponsorship - usually in custom tags, or an image icon
            if (rawStr.includes('Sponsored') || rawStr.includes('ad_impression') || store.logging?.includes('ad_impression')) {
                isSponsored = true;
            }
            
            // Check discount
            if (rawStr.toLowerCase().includes('offer') || rawStr.includes('discount') || rawStr.includes('% off')) {
                hasDiscount = true;
            }

            merchants.push({
                rank: i + 1,
                store_id: storeId,
                merchant_name: name,
                rating,
                delivery_fee: deliveryFee,
                is_sponsored: isSponsored,
                has_discount: hasDiscount
            });
        } catch (e) {
            console.error("Error parsing store block", e.message);
        }
    }
    
    console.table(merchants.slice(0, 10));
    console.log(`Extracted metadata for ${merchants.length} merchants.`);
}

parseGraphQL();
