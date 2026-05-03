const GRADES_KEY = "_system/grades.json";

async function readJson(bucket, key, fallback) {
    const obj = await bucket.get(key);
    if (!obj) return fallback;
    try {
        return JSON.parse(await obj.text());
    } catch {
        return fallback;
    }
}

function normalizeSubjectRecord(record) {
    if (!record || typeof record !== "object") return {};
    const out = {};
    for (const [name, item] of Object.entries(record)) {
        if (!item || typeof item !== "object") continue;
        out[name] = {
            score: String(item.score || "").trim(),
            comment: String(item.comment || "").trim(),
            updatedAt: String(item.updatedAt || ""),
            by: String(item.by || "")
        };
    }
    return out;
}

export async function readGrades(bucket) {
    const data = await readJson(bucket, GRADES_KEY, {});
    if (!data || typeof data !== "object") return {};
    const out = {};
    for (const [subject, record] of Object.entries(data)) out[subject] = normalizeSubjectRecord(record);
    return out;
}

export async function writeGrades(bucket, grades) {
    await bucket.put(GRADES_KEY, JSON.stringify(grades || {}), {
        httpMetadata: { contentType: "application/json" }
    });
}

export async function readGradesBySubject(bucket, subject) {
    const all = await readGrades(bucket);
    return all[subject] || {};
}

export async function upsertGradesBySubject(bucket, subject, items, updatedBy) {
    const all = await readGrades(bucket);
    if (!all[subject]) all[subject] = {};
    const now = new Date().toISOString();

    for (const item of items) {
        const name = String(item?.name || "").trim();
        if (!name) continue;
        all[subject][name] = {
            score: String(item?.score || "").trim(),
            comment: String(item?.comment || "").trim(),
            updatedAt: now,
            by: String(updatedBy || "")
        };
    }

    await writeGrades(bucket, all);
    return all[subject];
}
