const SUBJECT_SETTINGS_KEY = "_system/subject-settings.json";

function normalizeCsv(value) {
    return String(value || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

function normalizeExtensions(value) {
    const list = Array.isArray(value) ? value : normalizeCsv(value);
    const seen = new Set();
    const out = [];
    for (const raw of list) {
        let ext = String(raw || "").trim().toLowerCase();
        if (!ext) continue;
        if (!ext.startsWith(".")) ext = `.${ext}`;
        if (!/^\.[a-z0-9]{1,12}$/.test(ext)) continue;
        if (seen.has(ext)) continue;
        seen.add(ext);
        out.push(ext);
    }
    return out.slice(0, 40);
}

function normalizeMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    if (mode === "manual") return "normal";
    if (mode === "normal" || mode === "embedding" || mode === "auto") return mode;
    return "normal";
}

function normalizeClassNames(value) {
    const list = Array.isArray(value) ? value : normalizeCsv(value);
    const seen = new Set();
    const out = [];
    for (const raw of list) {
        const name = String(raw || "").trim();
        if (!name || name.length > 80) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        out.push(name);
    }
    return out.slice(0, 100);
}

function normalizeSettings(value) {
    if (!value || typeof value !== "object") {
        return { allowedExtensions: [], plagiarismMode: "normal", classNames: [], updatedAt: "" };
    }
    return {
        allowedExtensions: normalizeExtensions(value.allowedExtensions || value.extensions || ""),
        plagiarismMode: normalizeMode(value.plagiarismMode || value.checkMode),
        classNames: normalizeClassNames(value.classNames || value.classes || ""),
        updatedAt: String(value.updatedAt || "")
    };
}

function normalizeStore(data) {
    const out = {};
    if (!data || typeof data !== "object") return out;
    for (const [subject, settings] of Object.entries(data)) {
        const key = String(subject || "").trim();
        if (!key) continue;
        out[key] = normalizeSettings(settings);
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

export function normalizeAllowedExtensions(value) {
    return normalizeExtensions(value);
}

export async function readSubjectSettings(bucket) {
    return normalizeStore(await readJson(bucket, SUBJECT_SETTINGS_KEY, {}));
}

export async function getSubjectSettings(bucket, subject, env = {}) {
    const subjectKey = String(subject || "").trim();
    const store = await readSubjectSettings(bucket);
    const subjectSettings = subjectKey ? normalizeSettings(store[subjectKey]) : normalizeSettings({});
    const fallbackExtensions = normalizeExtensions(env.ALLOWED_EXTENSIONS || "");
    return {
        subject: subjectKey,
        allowedExtensions: subjectSettings.allowedExtensions.length ? subjectSettings.allowedExtensions : fallbackExtensions,
        customAllowedExtensions: subjectSettings.allowedExtensions,
        plagiarismMode: subjectSettings.plagiarismMode || "normal",
        classNames: subjectSettings.classNames || [],
        updatedAt: subjectSettings.updatedAt
    };
}

export async function setSubjectSettings(bucket, subject, settings) {
    const subjectKey = String(subject || "").trim();
    if (!subjectKey) throw new Error("科目不能为空");
    const store = await readSubjectSettings(bucket);
    const next = normalizeSettings({
        allowedExtensions: settings?.allowedExtensions || settings?.extensions || "",
        plagiarismMode: settings?.plagiarismMode || settings?.checkMode || "normal",
        classNames: settings?.classNames || settings?.classes || []
    });
    next.updatedAt = new Date().toISOString();
    store[subjectKey] = next;
    await writeJson(bucket, SUBJECT_SETTINGS_KEY, store);
    return { subject: subjectKey, ...next };
}

export async function deleteSubjectSettings(bucket, subject) {
    const subjectKey = String(subject || "").trim();
    if (!subjectKey) return;
    const store = await readSubjectSettings(bucket);
    if (!(subjectKey in store)) return;
    delete store[subjectKey];
    await writeJson(bucket, SUBJECT_SETTINGS_KEY, store);
}
