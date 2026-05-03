function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
}

function shouldShowNotice(notice) {
    const now = Date.now();
    const publishAt = String(notice?.publishAt || "").trim();
    const expireAt = String(notice?.expireAt || "").trim();

    if (publishAt) {
        const t = new Date(publishAt).getTime();
        if (!Number.isNaN(t) && now < t) return false;
    }
    if (expireAt) {
        const t = new Date(expireAt).getTime();
        if (!Number.isNaN(t) && now > t) return false;
    }
    return true;
}

export async function onRequestGet(context) {
    const { env } = context;

    try {
        const object = await env.R2_BUCKET.get("notice.json");
        if (!object) return json({ error: "No notice found" }, 404);

        const data = JSON.parse(await object.text());
        if (!shouldShowNotice(data)) return json({ error: "Notice is not active" }, 404);

        return json({
            title: String(data.title || ""),
            content: String(data.content || ""),
            publishAt: String(data.publishAt || ""),
            expireAt: String(data.expireAt || "")
        });
    } catch (error) {
        return json({ error: error.message }, 500);
    }
}
