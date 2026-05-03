const AUDIT_KEY = "_system/audit-log.json";
const MAX_AUDIT_LOGS = 3000;

async function readJson(bucket, key, fallback) {
    const obj = await bucket.get(key);
    if (!obj) return fallback;
    try {
        return JSON.parse(await obj.text());
    } catch {
        return fallback;
    }
}

export async function readAuditLogs(bucket, limit = 200) {
    const logs = await readJson(bucket, AUDIT_KEY, []);
    if (!Array.isArray(logs)) return [];
    return logs.slice(0, Math.max(1, Math.min(Number(limit || 200), 1000)));
}

export async function appendAuditLog(bucket, entry) {
    const logs = await readJson(bucket, AUDIT_KEY, []);
    const next = Array.isArray(logs) ? logs : [];
    next.unshift({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        ...entry
    });
    await bucket.put(AUDIT_KEY, JSON.stringify(next.slice(0, MAX_AUDIT_LOGS)), {
        httpMetadata: { contentType: "application/json" }
    });
}
