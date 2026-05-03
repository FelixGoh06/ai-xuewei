const EXEMPTIONS_KEY = "_system/deadline-exemptions.json";

async function readJson(bucket, key, fallback) {
    const obj = await bucket.get(key);
    if (!obj) return fallback;
    try {
        return JSON.parse(await obj.text());
    } catch {
        return fallback;
    }
}

function normalize(data) {
    if (!data || typeof data !== "object") return {};
    const out = {};
    for (const [subject, arr] of Object.entries(data)) {
        if (!Array.isArray(arr)) continue;
        out[subject] = Array.from(new Set(arr.map((v) => String(v || "").trim()).filter(Boolean)));
    }
    return out;
}

export async function readExemptions(bucket) {
    const data = await readJson(bucket, EXEMPTIONS_KEY, {});
    return normalize(data);
}

export async function writeExemptions(bucket, exemptions) {
    await bucket.put(EXEMPTIONS_KEY, JSON.stringify(normalize(exemptions)), {
        httpMetadata: { contentType: "application/json" }
    });
}

export async function setExemption(bucket, subject, studentName, enabled) {
    const all = await readExemptions(bucket);
    const list = new Set(all[subject] || []);
    if (enabled) list.add(studentName);
    else list.delete(studentName);
    if (list.size === 0) delete all[subject];
    else all[subject] = Array.from(list);
    await writeExemptions(bucket, all);
    return all[subject] || [];
}

export async function isExempted(bucket, subject, studentName) {
    const all = await readExemptions(bucket);
    return Boolean(all[subject]?.includes(studentName));
}
