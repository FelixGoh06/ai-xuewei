import { verifyAdminRequest } from "./auth.js";
import { readDeadlines } from "../deadlines-store.js";
import { getActiveRosterNames } from "../student-db.js";
import { readSubjectSettings } from "../subject-settings-store.js";

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
}

// functions/api/admin/dashboard.js
export async function onRequestGet(context) {
    const { request, env } = context;
    const auth = await verifyAdminRequest(request, env);
    if (!auth.ok) return json({ error: "Unauthorized" }, 401);

    try {
        const subjects = {};
        const deadlines = await readDeadlines(env.R2_BUCKET);
        const subjectSettings = await readSubjectSettings(env.R2_BUCKET);
        const allRosterNames = await getActiveRosterNames(env);
        const rosterCache = new Map();
        async function rosterForClasses(classes = []) {
            const normalized = Array.isArray(classes) ? classes.map((item) => String(item || "").trim()).filter(Boolean) : [];
            if (normalized.length === 0) return allRosterNames;
            const key = normalized.slice().sort().join("\n");
            if (rosterCache.has(key)) return rosterCache.get(key);
            const set = new Set();
            for (const className of normalized) {
                const names = await getActiveRosterNames(env, className);
                names.forEach((name) => set.add(name));
            }
            const result = Array.from(set);
            rosterCache.set(key, result);
            return result;
        }
        let cursor;
        do {
            const listed = await env.R2_BUCKET.list({ cursor });
            for (const obj of listed.objects || []) {
                if (obj.key === "notice.json" || !obj.key.includes("/")) continue;
                if (obj.key.startsWith("_system/")) continue;

                const parts = obj.key.split("/");
                const folder = parts[0];
                if (!subjects[folder]) subjects[folder] = new Set();
                if (parts.length >= 2 && !obj.key.endsWith(".keep")) subjects[folder].add(parts[1]);
            }
            cursor = listed.truncated ? listed.cursor : undefined;
        } while (cursor);

        const result = [];
        for (const name of Object.keys(subjects)) {
            const classes = subjectSettings[name]?.classNames || [];
            const rosterNames = await rosterForClasses(classes);
            const eligible = new Set(rosterNames);
            const submitted = subjects[name];
            const eligibleSubmitted = rosterNames.length > 0
                ? Array.from(submitted).filter((studentName) => eligible.has(studentName)).length
                : submitted.size;
            result.push({
                name,
                count: eligibleSubmitted,
                rawCount: submitted.size,
                rosterCount: rosterNames.length,
                classNames: classes,
                deadline: deadlines[name] || ""
            });
        }
        const rosterCount = allRosterNames.length;
        const subjectCount = result.length;
        const totalExpected = result.reduce((sum, item) => sum + Number(item.rosterCount || rosterCount || 0), 0);
        const totalSubmitted = result.reduce((sum, item) => {
            const count = Number(item.count || 0);
            const expected = Number(item.rosterCount || rosterCount || 0);
            return sum + (expected > 0 ? Math.min(count, expected) : count);
        }, 0);
        const submissionRate = totalExpected > 0 ? Math.round((totalSubmitted / totalExpected) * 100) : 0;

        return json({
            subjects: result,
            stats: {
                subjectCount,
                rosterCount,
                totalExpected,
                totalSubmitted,
                submissionRate
            }
        });
    } catch (error) {
        return json({ error: error.message }, 500);
    }
}
