const DEADLINES_KEY = "_system/deadlines.json";

async function readJson(bucket, key, fallback) {
    const obj = await bucket.get(key);
    if (!obj) return fallback;
    try {
        return JSON.parse(await obj.text());
    } catch {
        return fallback;
    }
}

export async function readDeadlines(bucket) {
    const data = await readJson(bucket, DEADLINES_KEY, {});
    return typeof data === "object" && data ? data : {};
}

export async function writeDeadlines(bucket, deadlines) {
    await bucket.put(DEADLINES_KEY, JSON.stringify(deadlines || {}), {
        httpMetadata: { contentType: "application/json" }
    });
}
