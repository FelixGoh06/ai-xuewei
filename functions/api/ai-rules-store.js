const AI_RULES_KEY = "_system/ai-rules.json";

function normalizeRule(rule) {
    if (!rule || typeof rule !== "object") {
        return { requirements: "", instruction: "", faq: "", examples: "", updatedAt: "" };
    }
    const requirements = String(rule.requirements || rule.instruction || "").trim().slice(0, 12000);
    return {
        requirements,
        instruction: requirements,
        faq: String(rule.faq || "").trim().slice(0, 12000),
        examples: String(rule.examples || "").trim().slice(0, 12000),
        updatedAt: String(rule.updatedAt || "")
    };
}

function normalizeStore(data) {
    const base = {
        global: { requirements: "", instruction: "", faq: "", examples: "", updatedAt: "" },
        subjects: {}
    };
    if (!data || typeof data !== "object") return base;

    base.global = normalizeRule(data.global);
    const subjects = data.subjects && typeof data.subjects === "object" ? data.subjects : {};
    for (const [k, v] of Object.entries(subjects)) {
        const key = String(k || "").trim();
        if (!key) continue;
        base.subjects[key] = normalizeRule(v);
    }
    return base;
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
    await bucket.put(key, JSON.stringify(value), {
        httpMetadata: { contentType: "application/json" }
    });
}

export async function readAiRules(bucket) {
    const raw = await readJson(bucket, AI_RULES_KEY, null);
    return normalizeStore(raw);
}

export async function writeAiRules(bucket, next) {
    await writeJson(bucket, AI_RULES_KEY, normalizeStore(next));
}

export async function setAiRule(bucket, subject, rule) {
    const store = await readAiRules(bucket);
    const normalized = normalizeRule({ ...rule, updatedAt: new Date().toISOString() });

    const subjectKey = String(subject || "").trim();
    if (!subjectKey) {
        store.global = normalized;
    } else {
        store.subjects[subjectKey] = normalized;
    }

    await writeAiRules(bucket, store);
    return store;
}

export async function getMergedAiRule(bucket, subject) {
    const store = await readAiRules(bucket);
    const subjectKey = String(subject || "").trim();
    const subjectRule = subjectKey
        ? normalizeRule(store.subjects[subjectKey])
        : { requirements: "", instruction: "", faq: "", examples: "", updatedAt: "" };
    const globalRule = normalizeRule(store.global);

    const requirements = [globalRule.requirements, subjectRule.requirements].filter(Boolean).join("\n\n").trim();
    const instruction = requirements;
    const faq = [globalRule.faq, subjectRule.faq].filter(Boolean).join("\n\n").trim();
    const examples = [globalRule.examples, subjectRule.examples].filter(Boolean).join("\n\n").trim();
    return { globalRule, subjectRule, instruction, requirements, faq, examples };
}
