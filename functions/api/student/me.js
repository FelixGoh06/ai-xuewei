import { getStudentAuthByName, getStudentByName } from "../student-db.js";
import { verifyStudentRequest } from "./auth.js";

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const auth = await verifyStudentRequest(request, env);
    if (!auth.ok) return json({ error: "未登录或登录已过期" }, 401);

    const profile = await getStudentByName(env, auth.name);
    if (!profile?.name) return json({ error: "学生账号不存在或未启用" }, 401);

    const authRow = await getStudentAuthByName(env, auth.name);
    return json({
        success: true,
        user: {
            name: profile.name,
            studentId: String(profile.studentId || ""),
            className: String(profile.className || ""),
            username: String(profile.username || "")
        },
        mustChangePassword: Boolean(authRow?.mustChangePassword)
    });
}

