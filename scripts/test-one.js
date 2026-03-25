const fs = require('fs');

async function test() {
    const { gotScraping } = await import('got-scraping');
    const raw = fs.readFileSync('accounts.json', 'utf-8');
    const accounts = JSON.parse(raw).filter(a => !a._comment && a.cookies);
    const account = accounts[0];
    
    if (!account) {
        console.error('No accounts found');
        return;
    }

    console.log(`Testing account: ${account.email}`);
    
    try {
        const res = await gotScraping({
            url: 'https://www.doordash.com/search/store/restaurants/?lat=37.7749&lng=-122.4194',
            headers: {
                'Cookie': account.cookies
            },
            headerGeneratorOptions: { browsers: ['chrome'], os: ['macos'] }
        });

        console.log(`Status Code: ${res.statusCode}`);
        const isLoggedIn = res.body.includes('dd_cx_logged_in=true') || res.body.includes('authenticated":true');
        console.log(`Is Logged In (marker in body): ${isLoggedIn}`);
        
        if (res.body.includes('Access Denied') || res.body.includes('challenge-running')) {
            console.log('⚠️  Cloudflare/WAF block detected!');
        } else if (res.statusCode === 403) {
            console.log('⚠️  HTTP 403 Forbidden (Likely Banned or Bot Blocked)');
        } else {
             console.log('✅ Response received.');
             console.log(`Body Length: ${res.body.length}`);
             if (res.body.length > 100000) {
                 console.log('✅ Likely successful search results page.');
             } else {
                 console.log('⚠️  Body too short, might be a block page.');
             }
        }
    } catch (err) {
        console.error(`Error: ${err.message}`);
    }
}

test();
