import { getStudentAuthByName, upsertStudentAuth } from "../student-db.js";
import {
    hashStudentPassword,
    verifyStudentPassword,
    verifyStudentRequest
} from "./auth.js";

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const auth = await verifyStudentRequest(request, env);
        if (!auth.ok) return json({ error: "未登录或登录已过期" }, 401);

        let body;
        try {
            body = await request.json();
        } catch {
            return json({ error: "请求格式错误" }, 400);
        }

        const oldPassword = String(body?.oldPassword || "");
        const newPassword = String(body?.newPassword || "");
        if (newPassword.length < 6) return json({ error: "新密码至少 6 位" }, 400);
        if (newPassword.length > 64) return json({ error: "新密码过长" }, 400);
        if (/\s/.test(newPassword)) return json({ error: "新密码不能包含空白字符" }, 400);

        const currentAuth = await getStudentAuthByName(env, auth.name);
        if (currentAuth && !currentAuth.mustChangePassword) {
            if (!oldPassword) return json({ error: "请输入旧密码" }, 400);
            const ok = await verifyStudentPassword(oldPassword, currentAuth.passwordHash);
            if (!ok) return json({ error: "旧密码错误" }, 401);
        }

        const nextHash = await hashStudentPassword(newPassword);
        await upsertStudentAuth(env, auth.name, nextHash, false);
        return json({ success: true, message: "密码已更新" });
    } catch (error) {
        return json(
            { error: `修改密码服务异常：${error?.message || "unknown"}` },
            500
        );
    }
}

