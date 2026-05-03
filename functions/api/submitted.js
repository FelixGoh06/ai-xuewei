// functions/api/submitted.js
import { verifyStudentRequest } from "./student/auth.js";

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
    const subType = String(url.searchParams.get("subType") || "").trim();

    if (!folder) return json({ error: "必须提供科目名称(folder)" }, 400);

    try {
        const auth = await verifyStudentRequest(request, env);

        // 学生端：只返回本人在该科目的文件名（用于重名检测）。
        if (auth.ok) {
            const prefix = subType ? `${folder}/${auth.name}/${subType}/` : `${folder}/${auth.name}/`;
            const listed = await env.R2_BUCKET.list({ prefix });
            const fileNames = (listed.objects || [])
                .map((obj) => obj.key.split("/").pop())
                .filter(Boolean)
                .filter((v, i, arr) => arr.indexOf(v) === i);
            return json({ folder, name: auth.name, subType, fileNames });
        }

        // 兼容旧逻辑：未登录时仅支持统计已交姓名列表。
        const listed = await env.R2_BUCKET.list({ prefix: `${folder}/` });
        const submittedNames = new Set();
        (listed.objects || []).forEach((obj) => {
            const parts = obj.key.split("/");
            if (parts.length >= 2) submittedNames.add(parts[1]);
        });
        return json({ subject: folder, submitted: Array.from(submittedNames) });
    } catch (error) {
        return json({ error: error.message || "读取失败" }, 500);
    }
}
