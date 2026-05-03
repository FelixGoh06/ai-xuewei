import { getSubjectSettings } from "./subject-settings-store.js";

const DEFAULT_MAX_MB = 95;

function normalizeCsvEnv(value) {
    return String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const folder = String(url.searchParams.get("folder") || "").trim();
    const settings = folder
        ? await getSubjectSettings(env.R2_BUCKET, folder, env)
        : { allowedExtensions: normalizeCsvEnv(env.ALLOWED_EXTENSIONS).map((e) => e.toLowerCase()), plagiarismMode: "manual" };
    const allowedExtensions = settings.allowedExtensions || [];
    const allowedNamesEnabled = String(env.ALLOWED_NAMES || "").trim().length > 0;

    return json({
        maxFileSizeMb: DEFAULT_MAX_MB,
        allowedExtensions,
        plagiarismMode: settings.plagiarismMode || "manual",
        allowedNamesEnabled
    });
}
