import { readDeadlines } from "./deadlines-store.js";
import { readAssignmentRequirements } from "./requirements-store.js";
import { readSubjectMeta } from "./subject-meta-store.js";
import { getActiveRosterNames } from "./student-db.js";

async function listAllObjects(bucket) {
    const all = [];
    let cursor;
    do {
        const listed = await bucket.list({ cursor });
        all.push(...(listed.objects || []));
        cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    return all;
}

// functions/api/folders.js
export async function onRequest(context) {
    const { env } = context;

    try {
        const listed = await env.R2_BUCKET.list({ delimiter: "/" });
        const folders = new Set();

        if (listed.delimitedPrefixes) {
            listed.delimitedPrefixes.forEach((prefix) => folders.add(prefix.replace(/\/$/, "")));
        }
        if (listed.objects) {
            listed.objects.forEach((obj) => {
                if (obj.key.endsWith("/")) folders.add(obj.key.replace(/\/$/, ""));
            });
        }

        const visibleFolders = Array.from(folders).filter((name) => name && !name.startsWith("_system"));
        const complexSubjects = String(env.COMPLEX_SUBJECTS || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        const deadlines = await readDeadlines(env.R2_BUCKET);
        const requirements = await readAssignmentRequirements(env.R2_BUCKET);
        const subjectMeta = await readSubjectMeta(env.R2_BUCKET);
        let defaultCreator = "管理员";
        try {
            const adminUsers = JSON.parse(env.ADMIN_USERS || "{}");
            const firstAdmin = Object.keys(adminUsers || {}).find(Boolean);
            if (firstAdmin) defaultCreator = firstAdmin;
        } catch { }
        const publicSubjectMeta = {};
        for (const folder of visibleFolders) {
            publicSubjectMeta[folder] = {
                createdBy: String(subjectMeta[folder]?.createdBy || defaultCreator).trim()
            };
        }
        const rosterNames = await getActiveRosterNames(env);
        const submittedNamesBySubject = {};
        const allObjects = await listAllObjects(env.R2_BUCKET);
        for (const obj of allObjects) {
            const key = String(obj?.key || "");
            if (!key || key.startsWith("_system/") || key === "notice.json" || key.endsWith("/.keep")) continue;
            const parts = key.split("/");
            if (parts.length < 2) continue;
            const subject = parts[0];
            const name = parts[1];
            if (!subject || !name) continue;
            if (!submittedNamesBySubject[subject]) submittedNamesBySubject[subject] = new Set();
            submittedNamesBySubject[subject].add(name);
        }
        const submittedCounts = {};
        for (const folder of visibleFolders) {
            submittedCounts[folder] = submittedNamesBySubject[folder]?.size || 0;
        }

        return new Response(JSON.stringify({
            folders: visibleFolders,
            complexSubjects,
            deadlines,
            requirements,
            subjectMeta: publicSubjectMeta,
            submittedCounts,
            rosterCount: rosterNames.length
        }), {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache"
            }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
