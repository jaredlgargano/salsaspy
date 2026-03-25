export async function pushToApi(apiUrl: string, apiKey: string, runData: any, observations: any[]) {
    let retries = 5;
    let delay = 2000;

    while (retries > 0) {
        try {
            const res = await fetch(`${apiUrl}/v1/ingest`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                    "User-Agent": "DoorDashScraper/1.0"
                },
                body: JSON.stringify({
                    run: runData || undefined,
                    observations: observations
                })
            });

            if (res.ok) {
                return await res.json();
            }

            const text = await res.text();
            console.error(`Ingest attempt failed (${retries} left). Status ${res.status}: ${text.substring(0, 100)}...`);
            
            if (res.status === 403 || res.status === 429) {
                // WAF or Rate Limit - back off
                await new Promise(r => setTimeout(r, delay));
                delay *= 2;
                retries--;
                continue;
            }

            throw new Error(`Ingest failed with status ${res.status}: ${text}`);
        } catch (e: any) {
            console.error(`Ingest Error: ${e.message}`);
            retries--;
            if (retries === 0) throw e;
            await new Promise(r => setTimeout(r, delay));
            delay *= 2;
        }
    }
}
