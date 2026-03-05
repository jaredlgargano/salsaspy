export async function pushToApi(apiUrl: string, apiKey: string, runData: any, observations: any[]) {
    const res = await fetch(`${apiUrl}/v1/ingest`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            run: runData,
            observations: observations
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ingest failed with status ${res.status}: ${text}`);
    }

    return await res.json();
}
