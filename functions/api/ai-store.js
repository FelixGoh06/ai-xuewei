const AI_CACHE_KEY = "_system/ai-cache.json";
const AI_RATE_KEY = "_system/ai-rate.json";

async function readJson(bucket, key, fallback) {
    const obj = await bucket.get(key);
    if (!obj) return fallback;
    try {
        return JSON.parse(await obj.text());
    } catch {
        return fallback;
    }
}

async function writeJson(bucket, key, value) {
    await bucket.put(key, JSON.stringify(value), {
        httpMetadata: { contentType: "application/json" }
    });
}

export async function hashText(text) {
    const data = new TextEncoder().encode(String(text || ""));
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getCachedAi(bucket, key, ttlSeconds) {
    const store = await readJson(bucket, AI_CACHE_KEY, {});
    const row = store?.[key];
    if (!row) return null;
    const now = Date.now();
    if (!row.ts || now - Number(row.ts) > ttlSeconds * 1000) return null;
    return String(row.value || "");
}

export async function setCachedAi(bucket, key, value, maxEntries = 500) {
    const store = await readJson(bucket, AI_CACHE_KEY, {});
    const next = (store && typeof store === "object") ? store : {};
    next[key] = { ts: Date.now(), value: String(value || "") };

    const entries = Object.entries(next).sort((a, b) => Number(b[1]?.ts || 0) - Number(a[1]?.ts || 0));
    const sliced = entries.slice(0, Math.max(10, Math.min(maxEntries, 2000)));
    const compact = {};
    for (const [k, v] of sliced) compact[k] = v;
    await writeJson(bucket, AI_CACHE_KEY, compact);
}

export async function consumeRate(bucket, actor, limit, windowSeconds) {
    const key = String(actor || "anonymous").slice(0, 200);
    const store = await readJson(bucket, AI_RATE_KEY, {});
    const next = (store && typeof store === "object") ? store : {};

    const now = Math.floor(Date.now() / 1000);
    const row = next[key] || { count: 0, resetAt: now + windowSeconds };
    if (!row.resetAt || now >= row.resetAt) {
        row.count = 0;
        row.resetAt = now + windowSeconds;
    }

    row.count += 1;
    next[key] = row;
    await writeJson(bucket, AI_RATE_KEY, next);

    return {
        ok: row.count <= limit,
        remaining: Math.max(0, limit - row.count),
        resetAt: row.resetAt
    };
}
