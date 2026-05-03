import { issueDeleteToken } from "./delete-token.js";
import { prependHistory, readHistory } from "./history-store.js";
import { readDeadlines } from "./deadlines-store.js";
import { isExempted } from "./exemptions-store.js";
import { getActiveRosterNames, getNamingRule, getStudentByName } from "./student-db.js";
import { verifyStudentRequest } from "./student/auth.js";
import { getSubjectSettings } from "./subject-settings-store.js";
import { runPlagiarismCheck } from "./plagiarism-store.js";
import { getModelSettings } from "./model-settings-store.js";
const MAX_FILE_SIZE_MB = 95;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" }
    });
}

function makeReceiptCode() {
    const stamp = Date.now().toString(36).toUpperCase();
    const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    return `RC-${stamp}-${rand}`;
}

function buildHistoryEntry({ filePath, fileName, folder, subType, deleteToken, size, submitCount }) {
    return {
        id: crypto.randomUUID(),
        receiptCode: makeReceiptCode(),
        fileName,
        fullPath: filePath,
        deleteToken,
        displayType: subType ? `${folder} - ${subType}` : folder,
        size,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        deleted: false,
        submitMode: submitCount > 1 ? "modified" : "new",
        submitCount: Math.max(1, Number(submitCount || 1)),
        score: "",
        comment: ""
    };
}

function normalizeCsvEnv(value) {
    return String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function extOfFile(fileName) {
    const dot = String(fileName || "").lastIndexOf(".");
    return dot >= 0 ? String(fileName).slice(dot).toLowerCase() : "";
}

async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sanitizeFileStem(stem) {
    return String(stem || "")
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, "")
        .trim()
        .slice(0, 120);
}

function renderTemplate(template, ctx) {
    return String(template || "").replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => String(ctx[key] || ""));
}

function extractTemplateTokens(template) {
    const matches = String(template || "").match(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g) || [];
    return Array.from(new Set(matches.map((m) => m.slice(1, -1))));
}

function isPastDeadline(deadlineStr) {
    if (!deadlineStr) return false;
    const d = new Date(deadlineStr);
    if (Number.isNaN(d.getTime())) return false;
    return Date.now() > d.getTime();
}

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const auth = await verifyStudentRequest(request, env);
        if (!auth.ok) return json({ error: "未登录或登录已过期" }, 401);

        const formData = await request.formData();
        const name = String(auth.name || "").trim();
        const folder = String(formData.get("folder") || "").trim();
        const subType = String(formData.get("subType") || "").trim();
        const files = formData.getAll("files");

        if (!name || !folder || files.length === 0) {
            return json({ error: "姓名、科目和文件不能为空" }, 400);
        }

        const complexSubjects = normalizeCsvEnv(env.COMPLEX_SUBJECTS);
        const isComplex = complexSubjects.includes(folder);
        if (isComplex && !subType) {
            return json({ error: "该科目需要填写作业单元/小类型" }, 400);
        }

        const subjectSettings = await getSubjectSettings(env.R2_BUCKET, folder, env);
        const classNames = Array.isArray(subjectSettings.classNames) ? subjectSettings.classNames : [];
        const classRoster = new Set();
        for (const className of classNames) {
            const names = await getActiveRosterNames(env, className);
            names.forEach((item) => classRoster.add(item));
        }
        const allowedNames = classNames.length ? Array.from(classRoster) : await getActiveRosterNames(env);
        const enforceWhitelist = classNames.length > 0 || allowedNames.length > 0 || String(env.ALLOWED_NAMES || "").trim().length > 0;
        if (enforceWhitelist && !allowedNames.includes(name)) {
            return json({ error: classNames.length ? "该作业不面向你所在的班级开放" : "你的姓名不在允许提交名单内" }, 403);
        }

        const deadlines = await readDeadlines(env.R2_BUCKET);
        const deadline = String(deadlines[folder] || "").trim();
        if (deadline && isPastDeadline(deadline)) {
            const exempt = await isExempted(env.R2_BUCKET, folder, name);
            if (!exempt) {
                return json({
                    error: "该科目已截止，当前账号无延期权限",
                    code: "DEADLINE_LOCKED",
                    deadline
                }, 403);
            }
        }

        const allowedExts = subjectSettings.allowedExtensions || [];
        const hasExtensionLimit = allowedExts.length > 0;
        for (const file of files) {
            const fileName = String(file?.name || "");
            const dot = fileName.lastIndexOf(".");
            const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
            if (hasExtensionLimit && !allowedExts.includes(ext)) {
                return json({ error: `不支持的文件格式: ${fileName}` }, 400);
            }
            if (Number(file?.size || 0) > MAX_FILE_SIZE_BYTES) {
                return json({ error: `文件超出大小限制（${MAX_FILE_SIZE_MB}MB）: ${fileName}` }, 413);
            }
        }

        const uploaded = [];
        const existingHistory = await readHistory(env.R2_BUCKET, name);
        const pathSubmitCount = {};
        for (const item of existingHistory) {
            const path = String(item?.fullPath || "");
            if (!path) continue;
            pathSubmitCount[path] = (pathSubmitCount[path] || 0) + 1;
        }
        for (const file of files) {
            const fileName = String(file.name || "").trim();
            const fileBuffer = await file.arrayBuffer();
            const contentHash = await sha256Hex(fileBuffer);
            let finalFileName = fileName;
            const namingRule = await getNamingRule(env, folder);
            if (namingRule.template) {
                const profile = (await getStudentByName(env, name)) || { name };
                const ext = extOfFile(fileName);
                const originalBase = fileName.replace(/\.[^/.]+$/, "");
                const ctx = {
                    ...profile,
                    name,
                    subject: folder,
                    originalBase
                };
                const tokens = extractTemplateTokens(namingRule.template);
                for (const tk of tokens) {
                    if (tk === "subject" || tk === "originalBase") continue;
                    if (!String(ctx[tk] || "").trim()) {
                        return json({ error: `姓名【${name}】缺少字段【${tk}】，无法按模板命名` }, 400);
                    }
                }
                const stem = sanitizeFileStem(renderTemplate(namingRule.template, {
                    ...ctx
                }));
                if (!stem) return json({ error: "命名模板生成失败，请检查模板配置" }, 400);
                finalFileName = `${stem}${ext}`;
            }
            const filePath = isComplex ? `${folder}/${name}/${subType}/${finalFileName}` : `${folder}/${name}/${finalFileName}`;
            await env.R2_BUCKET.put(filePath, fileBuffer, { httpMetadata: { contentType: file.type } });
            const deleteToken = await issueDeleteToken(env, filePath);
            const submitCount = Number(pathSubmitCount[filePath] || 0) + 1;
            pathSubmitCount[filePath] = submitCount;
            const historyEntry = buildHistoryEntry({
                filePath,
                fileName: finalFileName,
                folder,
                subType: isComplex ? subType : "",
                deleteToken,
                size: Number(file.size || 0),
                submitCount
            });
            historyEntry.originalFileName = fileName;
            historyEntry.contentHash = contentHash;
            if (subjectSettings.plagiarismMode === "auto") {
                const modelSettings = await getModelSettings(env);
                historyEntry.plagiarism = await runPlagiarismCheck(env.R2_BUCKET, folder, filePath, {
                    hash: contentHash,
                    mode: "auto",
                    env,
                    modelSettings
                });
            }
            await prependHistory(env.R2_BUCKET, name, historyEntry);
            uploaded.push({ path: filePath, deleteToken, receiptCode: historyEntry.receiptCode, historyEntry });
        }

        return json({ success: true, message: "上传成功", uploaded }, 200);
    } catch (error) {
        if (error?.message === "DELETE_TOKEN_SECRET missing") {
            return json({ error: "服务端缺少 DELETE_TOKEN_SECRET（或 ADMIN_SESSION_SECRET）配置" }, 500);
        }
        return json({ error: error.message || "上传失败" }, 500);
    }
}

