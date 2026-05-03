const PLAGIARISM_KEY = "_system/plagiarism-results.json";

function jsonSafeParse(text, fallback) {
    try {
        return JSON.parse(String(text || ""));
    } catch {
        return fallback;
    }
}

async function readJson(bucket, key, fallback) {
    const obj = await bucket.get(key);
    if (!obj) return fallback;
    return jsonSafeParse(await obj.text(), fallback);
}

async function writeJson(bucket, key, value) {
    await bucket.put(key, JSON.stringify(value || {}), {
        httpMetadata: { contentType: "application/json" }
    });
}

function normalizeResult(item) {
    if (!item || typeof item !== "object") return null;
    return {
        key: String(item.key || ""),
        subject: String(item.subject || ""),
        uploader: String(item.uploader || ""),
        checkedAt: String(item.checkedAt || ""),
        mode: String(item.mode || "normal"),
        engine: String(item.engine || "normal"),
        note: String(item.note || ""),
        status: String(item.status || "ok"),
        maxSimilarity: Number(item.maxSimilarity || 0),
        matches: Array.isArray(item.matches) ? item.matches.slice(0, 20).map((m) => ({
            key: String(m.key || ""),
            uploader: String(m.uploader || ""),
            fileName: String(m.fileName || ""),
            similarity: Number(m.similarity || 0),
            reason: String(m.reason || "")
        })) : []
    };
}

function normalizeMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    if (mode === "manual") return "normal";
    if (mode === "normal" || mode === "embedding" || mode === "auto") return mode;
    return "normal";
}

function normalizeStore(data) {
    const out = {};
    if (!data || typeof data !== "object") return out;
    for (const [key, value] of Object.entries(data)) {
        const normalized = normalizeResult(value);
        if (normalized?.key) out[key] = normalized;
    }
    return out;
}

function fileNameOf(key) {
    return String(key || "").split("/").pop() || "";
}

function uploaderOf(key) {
    return String(key || "").split("/")[1] || "";
}

function tokenizeName(value) {
    const stem = fileNameOf(value).replace(/\.[^/.]+$/, "").toLowerCase();
    const compact = stem.replace(/[\s_\-()[\]{}【】（）]+/g, "");
    const tokens = new Set();
    for (let i = 0; i < compact.length - 1; i++) {
        tokens.add(compact.slice(i, i + 2));
    }
    if (compact) tokens.add(compact);
    return tokens;
}

function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let same = 0;
    for (const item of a) if (b.has(item)) same++;
    return Math.round((same / (a.size + b.size - same)) * 100);
}

async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function objectHash(bucket, key) {
    const obj = await bucket.get(key);
    if (!obj) return "";
    const buffer = await obj.arrayBuffer();
    return sha256Hex(buffer);
}

async function listAllByPrefix(bucket, prefix) {
    const all = [];
    let cursor;
    do {
        const listed = await bucket.list({ prefix, cursor });
        all.push(...(listed.objects || []));
        cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    return all;
}

export async function readPlagiarismResults(bucket) {
    return normalizeStore(await readJson(bucket, PLAGIARISM_KEY, {}));
}

export async function getPlagiarismResult(bucket, key) {
    const store = await readPlagiarismResults(bucket);
    return normalizeResult(store[String(key || "")]);
}

export async function writePlagiarismResult(bucket, result) {
    const normalized = normalizeResult(result);
    if (!normalized?.key) return null;
    const store = await readPlagiarismResults(bucket);
    store[normalized.key] = normalized;
    await writeJson(bucket, PLAGIARISM_KEY, store);
    return normalized;
}

export async function runPlagiarismCheck(bucket, subject, targetKey, options = {}) {
    const subjectKey = String(subject || "").trim();
    const key = String(targetKey || "").trim();
    if (!subjectKey || !key) throw new Error("缺少科目或文件路径");

    const requestedMode = normalizeMode(options.mode);
    const env = options.env || {};
    const modelSettings = options.modelSettings || {};
    const embeddingModel = String(modelSettings.embeddingModel || env.EMBEDDING_MODEL || "").trim();
    const apiKey = String(modelSettings.apiKey || env.OPENAI_API_KEY || "").trim();
    const embeddingConfigured = Boolean(apiKey && embeddingModel);
    const engine = requestedMode === "embedding" && embeddingConfigured ? "embedding" : "normal";
    let note = "";
    if (requestedMode === "embedding" && !embeddingConfigured) {
        note = "Embedding is not configured. Falling back to normal check. Set EMBEDDING_MODEL and OPENAI_API_KEY to enable it.";
    } else if (requestedMode === "auto") {
        note = "Auto mode currently runs normal check on upload; embedding enhancement can be enabled later for high-risk files.";
    }

    const currentHash = options.hash || await objectHash(bucket, key);
    const currentTokens = tokenizeName(key);
    const objects = await listAllByPrefix(bucket, `${subjectKey}/`);
    const matches = [];

    for (const obj of objects) {
        const otherKey = String(obj.key || "");
        if (!otherKey || otherKey === key || otherKey.endsWith("/.keep")) continue;
        let similarity = jaccard(currentTokens, tokenizeName(otherKey));
        let reason = "文件名相似";
        if (currentHash) {
            const otherHash = await objectHash(bucket, otherKey);
            if (otherHash && otherHash === currentHash) {
                similarity = 100;
                reason = "文件内容完全一致";
            }
        }
        if (similarity >= 70) {
            matches.push({
                key: otherKey,
                uploader: uploaderOf(otherKey),
                fileName: fileNameOf(otherKey),
                similarity,
                reason
            });
        }
    }

    matches.sort((a, b) => b.similarity - a.similarity);
    const maxSimilarity = matches[0]?.similarity || 0;
    const result = await writePlagiarismResult(bucket, {
        key,
        subject: subjectKey,
        uploader: uploaderOf(key),
        checkedAt: new Date().toISOString(),
        mode: requestedMode,
        engine,
        note,
        status: maxSimilarity >= 90 ? "high-risk" : maxSimilarity >= 70 ? "warning" : "ok",
        maxSimilarity,
        matches
    });
    return result;
}
