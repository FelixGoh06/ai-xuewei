const HISTORY_PREFIX = "_system/history/";

function getHistoryKey(name) {
    return `${HISTORY_PREFIX}${encodeURIComponent(name)}.json`;
}

async function readJsonObject(bucket, key, fallback) {
    const object = await bucket.get(key);
    if (!object) return fallback;
    try {
        return JSON.parse(await object.text());
    } catch {
        return fallback;
    }
}

async function writeJsonObject(bucket, key, value) {
    await bucket.put(key, JSON.stringify(value), {
        httpMetadata: { contentType: "application/json" }
    });
}

export async function readHistory(bucket, name) {
    if (!name) return [];
    return readJsonObject(bucket, getHistoryKey(name), []);
}

export async function prependHistory(bucket, name, entry) {
    if (!name) return;
    const history = await readHistory(bucket, name);
    history.unshift(entry);
    await writeJsonObject(bucket, getHistoryKey(name), history.slice(0, 500));
}

export async function markHistoryDeletedByPath(bucket, name, fullPath) {
    if (!name || !fullPath) return;
    const history = await readHistory(bucket, name);
    let changed = false;
    const next = history.map((item) => {
        if (item.fullPath === fullPath && item.deleted !== true) {
            changed = true;
            return { ...item, deleted: true, deletedAt: new Date().toISOString() };
        }
        return item;
    });
    if (changed) await writeJsonObject(bucket, getHistoryKey(name), next);
}

export async function applyGradeToHistoryBySubject(bucket, subject, studentName, grade) {
    if (!subject || !studentName) return;
    const history = await readHistory(bucket, studentName);
    if (!Array.isArray(history) || history.length === 0) return;

    let changed = false;
    const prefix = `${subject}/${studentName}/`;
    const next = history.map((item) => {
        const path = String(item?.fullPath || "");
        if (!path.startsWith(prefix)) return item;
        changed = true;
        return {
            ...item,
            score: String(grade?.score || "").trim(),
            comment: String(grade?.comment || "").trim(),
            gradedAt: String(grade?.updatedAt || new Date().toISOString()),
            gradedBy: String(grade?.by || "")
        };
    });

    if (changed) await writeJsonObject(bucket, getHistoryKey(studentName), next);
}
