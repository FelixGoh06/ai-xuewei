const REQUIREMENTS_KEY = "_system/assignment-requirements.json";

function normalizeRequirement(value) {
    if (!value || typeof value !== "object") {
        return { content: "", updatedAt: "" };
    }
    return {
        content: String(value.content || value.requirement || "").trim().slice(0, 20000),
        updatedAt: String(value.updatedAt || "")
    };
}

function normalizeStore(data) {
    const out = {};
    if (!data || typeof data !== "object") return out;
    for (const [subject, value] of Object.entries(data)) {
        const key = String(subject || "").trim();
        if (!key) continue;
        out[key] = normalizeRequirement(value);
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

export async function readAssignmentRequirements(bucket) {
    return normalizeStore(await readJson(bucket, REQUIREMENTS_KEY, {}));
}

export async function getAssignmentRequirement(bucket, subject) {
    const subjectKey = String(subject || "").trim();
    if (!subjectKey) return { content: "", updatedAt: "" };
    const store = await readAssignmentRequirements(bucket);
    return normalizeRequirement(store[subjectKey]);
}

export async function setAssignmentRequirement(bucket, subject, content) {
    const subjectKey = String(subject || "").trim();
    if (!subjectKey) throw new Error("Subject required");
    const store = await readAssignmentRequirements(bucket);
    const body = String(content || "").trim().slice(0, 20000);
    if (!body) {
        delete store[subjectKey];
    } else {
        store[subjectKey] = { content: body, updatedAt: new Date().toISOString() };
    }
    await writeJson(bucket, REQUIREMENTS_KEY, store);
    return normalizeRequirement(store[subjectKey]);
}

export async function deleteAssignmentRequirement(bucket, subject) {
    const subjectKey = String(subject || "").trim();
    if (!subjectKey) return;
    const store = await readAssignmentRequirements(bucket);
    if (!(subjectKey in store)) return;
    delete store[subjectKey];
    await writeJson(bucket, REQUIREMENTS_KEY, store);
}
