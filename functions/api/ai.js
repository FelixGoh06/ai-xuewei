import { runStudentAi } from "./ai-helper.js";
import { verifyStudentRequest } from "./student/auth.js";

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const auth = await verifyStudentRequest(request, env);
    if (!auth.ok) return json({ success: false, error: "未登录或登录已过期" }, 401);

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: "Invalid JSON body" }, 400);
    }

    try {
        const result = await runStudentAi(context, {
            ...(body || {}),
            name: auth.name
        });
        return json({ success: true, ...result });
    } catch (error) {
        return json({ success: false, error: error.message || "AI error" }, 500);
    }
}
