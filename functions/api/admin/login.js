import { issueAdminToken } from "./auth.js";
import { verifyAdminPassword } from "./admin-users-store.js";

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json();
        const { username, password } = body || {};

        if (!username || !password) {
            return new Response(JSON.stringify({ error: "账号和密码不能为空" }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        const verify = await verifyAdminPassword(env, username, password);
        if (!verify.ok) {
            return new Response(JSON.stringify({ error: "账号或密码错误" }), {
                status: 401,
                headers: { "Content-Type": "application/json" }
            });
        }

        const token = await issueAdminToken(env, username);
        return new Response(JSON.stringify({
            success: true,
            token,
            user: username,
            profile: verify.user
        }), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store"
            }
        });
    } catch (error) {
        if (error?.message === "ADMIN_SESSION_SECRET is missing") {
            return new Response(JSON.stringify({ error: "服务端缺少 ADMIN_SESSION_SECRET 配置" }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
        return new Response(JSON.stringify({ error: error?.message || "请求格式错误" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
        });
    }
}
