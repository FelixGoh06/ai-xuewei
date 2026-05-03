import {
    getActiveStudentByLogin,
    getStudentAuthByName,
    isD1Ready,
    upsertStudentAuth
} from "../student-db.js";
import {
    hashStudentPassword,
    isDefaultStudentPassword,
    issueStudentToken,
    verifyStudentPassword
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
        if (!isD1Ready(env)) {
            return json({ error: "D1 未绑定，学生登录不可用" }, 500);
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return json({ error: "请求格式错误" }, 400);
        }

        const login = String(body?.login || "").trim();
        const password = String(body?.password || "");
        if (!login || !password) {
            return json({ error: "账号和密码不能为空" }, 400);
        }

        const profile = await getActiveStudentByLogin(env, login);
        if (!profile?.name) {
            return json({ error: "账号不存在或未启用" }, 401);
        }

        const authRow = await getStudentAuthByName(env, profile.name);
        if (!authRow) {
            if (!isDefaultStudentPassword(password)) {
                return json({ error: "账号或密码错误" }, 401);
            }
            const hash = await hashStudentPassword(password);
            await upsertStudentAuth(env, profile.name, hash, true);
        } else {
            const ok = await verifyStudentPassword(password, authRow.passwordHash);
            if (!ok) return json({ error: "账号或密码错误" }, 401);
        }

        const latestAuth = await getStudentAuthByName(env, profile.name);
        const token = await issueStudentToken(env, profile);
        return json({
            success: true,
            token,
            user: {
                name: profile.name,
                studentId: String(profile.studentId || ""),
                className: String(profile.className || ""),
                username: String(profile.username || "")
            },
            mustChangePassword: Boolean(latestAuth?.mustChangePassword)
        });
    } catch (error) {
        return json(
            { error: `学生登录服务异常：${error?.message || "unknown"}` },
            500
        );
    }
}

