const MODEL_SETTINGS_KEY = "_system/model-settings.json";

function jsonSafeParse(text, fallback) {
    try {
        return JSON.parse(String(text || ""));
    } catch {
        return fallback;
    }
}

async function readJson(bucket, key, fallback) {
    if (!bucket) return fallback;
    const obj = await bucket.get(key);
    if (!obj) return fallback;
    return jsonSafeParse(await obj.text(), fallback);
}

async function writeJson(bucket, key, value) {
    await bucket.put(key, JSON.stringify(value || {}, null, 2), {
        httpMetadata: { contentType: "application/json" }
    });
}

function cleanUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
}

function cleanModel(value) {
    return String(value || "").trim();
}

function cleanApiKey(value) {
    return String(value || "").trim();
}

function cleanTimeout(value) {
    const n = Number(value || 25000);
    if (!Number.isFinite(n)) return 25000;
    return Math.max(5000, Math.min(120000, Math.round(n)));
}

export function normalizeModelSettings(value = {}) {
    return {
        apiKey: cleanApiKey(value.apiKey),
        aiBaseUrl: cleanUrl(value.aiBaseUrl || value.baseUrl),
        lightModel: cleanModel(value.lightModel || value.aiLightModel),
        heavyModel: cleanModel(value.heavyModel || value.aiHeavyModel),
        embeddingModel: cleanModel(value.embeddingModel),
        timeoutMs: cleanTimeout(value.timeoutMs || value.aiTimeoutMs),
        updatedAt: String(value.updatedAt || "")
    };
}

export async function getStoredModelSettings(bucket) {
    return normalizeModelSettings(await readJson(bucket, MODEL_SETTINGS_KEY, {}));
}

export async function getModelSettings(env = {}) {
    const stored = await getStoredModelSettings(env.R2_BUCKET).catch(() => normalizeModelSettings({}));
    const fallback = normalizeModelSettings({
        apiKey: env.OPENAI_API_KEY || "",
        aiBaseUrl: env.AI_BASE_URL || "https://api.openai.com/v1",
        lightModel: env.AI_LIGHT_MODEL || env.AI_MODEL || "",
        heavyModel: env.AI_HEAVY_MODEL || env.AI_MODEL || env.AI_LIGHT_MODEL || "",
        embeddingModel: env.EMBEDDING_MODEL || "",
        timeoutMs: env.AI_TIMEOUT_MS || 25000
    });

    return {
        apiKey: stored.apiKey || fallback.apiKey,
        aiBaseUrl: stored.aiBaseUrl || fallback.aiBaseUrl || "https://api.openai.com/v1",
        lightModel: stored.lightModel || fallback.lightModel,
        heavyModel: stored.heavyModel || fallback.heavyModel || fallback.lightModel,
        embeddingModel: stored.embeddingModel || fallback.embeddingModel,
        timeoutMs: stored.timeoutMs || fallback.timeoutMs || 25000,
        updatedAt: stored.updatedAt || "",
        source: stored.updatedAt ? "store" : "env",
        apiKeySource: stored.apiKey ? "store" : (fallback.apiKey ? "env" : "")
    };
}

export async function setModelSettings(bucket, settings = {}) {
    if (!bucket) throw new Error("R2_BUCKET missing");
    const normalized = normalizeModelSettings(settings);
    const next = {
        ...normalized,
        updatedAt: new Date().toISOString()
    };
    await writeJson(bucket, MODEL_SETTINGS_KEY, next);
    return next;
}
