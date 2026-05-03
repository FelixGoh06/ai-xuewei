import { verifyDeleteToken } from "./delete-token.js";
import { markHistoryDeletedByPath } from "./history-store.js";
import { appendAuditLog } from "./audit-store.js";
import { verifyStudentRequest } from "./student/auth.js";

function isSafeStudentFilePath(path) {
    if (typeof path !== "string") return false;
    const trimmed = path.trim();
    if (!trimmed || trimmed.length > 512) return false;
    if (trimmed.includes("..") || trimmed.includes("\\")) return false;
    return /^[^/]+\/[^/]+\/.+$/.test(trimmed);
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" }
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const auth = await verifyStudentRequest(request, env);
        if (!auth.ok) return json({ error: "未登录或登录已过期" }, 401);

        const body = await request.json();
        const filePath = String(body?.path || "").trim();
        const deleteToken = String(body?.deleteToken || "").trim();

        if (!isSafeStudentFilePath(filePath)) return json({ error: "非法文件路径" }, 400);
        if (filePath === "notice.json" || filePath.endsWith("/.keep") || filePath.startsWith("_system/")) {
            return json({ error: "禁止删除系统文件" }, 403);
        }

        const owner = filePath.split("/")[1] || "";
        if (owner !== auth.name) return json({ error: "只能删除本人文件" }, 403);

        const verify = await verifyDeleteToken(env, filePath, deleteToken);
        if (!verify.ok) return json({ error: "删除凭证无效或已过期" }, 401);

        await env.R2_BUCKET.delete(filePath);
        const parts = filePath.split("/");
        const studentName = parts.length >= 3 ? parts[1] : "";
        if (studentName) {
            await markHistoryDeletedByPath(env.R2_BUCKET, studentName, filePath);
        }
        await appendAuditLog(env.R2_BUCKET, {
            actorType: "student",
            actor: auth.name || studentName || "unknown",
            action: "delete_file",
            target: filePath,
            source: "student_api"
        });
        return json({ success: true, message: "文件已成功撤回" }, 200);
    } catch (error) {
        return json({ error: error.message || "删除失败" }, 500);
    }
}
