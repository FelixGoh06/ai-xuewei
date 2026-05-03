const SUBJECT_META_KEY = "_system/subject-meta.json";

function normalizeMeta(value) {
    if (!value || typeof value !== "object") {
        return { createdBy: "", createdAt: "", updatedAt: "" };
    }
    return {
        createdBy: String(value.createdBy || "").trim().slice(0, 100),
        createdAt: String(value.createdAt || ""),
        updatedAt: String(value.updatedAt || "")
    };
}

function normalizeStore(data) {
    const out = {};
    if (!data || typeof data !== "object") return out;
    for (const [subject, value] of Object.entries(data)) {
        const key = String(subject || "").trim();
        if (!key) continue;
        out[key] = normalizeMeta(value);
    }
    return out;
}

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
    await bucket.put(key, JSON.stringify(value || {}), {
        httpMetadata: { contentType: "application/json" }
    });
}

export async function readSubjectMeta(bucket) {
    return normalizeStore(await readJson(bucket, SUBJECT_META_KEY, {}));
}

export async function setSubjectCreatedBy(bucket, subject, username) {
    const subjectKey = String(subject || "").trim();
    if (!subjectKey) throw new Error("Subject required");
    const store = await readSubjectMeta(bucket);
    const now = new Date().toISOString();
    const current = normalizeMeta(store[subjectKey]);
    store[subjectKey] = {
        ...current,
        createdBy: current.createdBy || String(username || "").trim().slice(0, 100),
        createdAt: current.createdAt || now,
        updatedAt: now
    };
    await writeJson(bucket, SUBJECT_META_KEY, store);
    return store[subjectKey];
}

export async function deleteSubjectMeta(bucket, subject) {
    const subjectKey = String(subject || "").trim();
    if (!subjectKey) return;
    const store = await readSubjectMeta(bucket);
    if (!(subjectKey in store)) return;
    delete store[subjectKey];
    await writeJson(bucket, SUBJECT_META_KEY, store);
}
