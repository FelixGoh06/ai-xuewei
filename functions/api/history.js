import { readHistory } from "./history-store.js";
import { verifyStudentRequest } from "./student/auth.js";

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

    try {
        const history = await readHistory(env.R2_BUCKET, auth.name);
        return json({ name: auth.name, history });
    } catch (error) {
        return json({ error: error.message }, 500);
    }
}
