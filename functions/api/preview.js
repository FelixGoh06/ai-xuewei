import { readHistory } from "./history-store.js";
import { verifyStudentRequest } from "./student/auth.js";

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
}

function isSafeObjectKey(key) {
    if (typeof key !== "string") return false;
    const trimmed = key.trim();
    if (!trimmed || trimmed.length > 512) return false;
    if (trimmed.includes("..") || trimmed.includes("\\")) return false;
    return /^[^/]+(?:\/[^/]+)+$/.test(trimmed);
}

function contentTypeForName(fileName) {
    const ext = String(fileName || "").toLowerCase().split(".").pop() || "";
    const map = {
        pdf: "application/pdf",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
        bmp: "image/bmp",
        txt: "text/plain; charset=utf-8",
        md: "text/markdown; charset=utf-8",
        csv: "text/csv; charset=utf-8",
        json: "application/json; charset=utf-8",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ppt: "application/vnd.ms-powerpoint",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    };
    return map[ext] || "application/octet-stream";
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const auth = await verifyStudentRequest(request, env);
    if (!auth.ok) return json({ error: "请先登录" }, 401);

    const url = new URL(request.url);
    const key = String(url.searchParams.get("path") || "").trim();
    const download = url.searchParams.get("download") === "1";
    if (!isSafeObjectKey(key) || key.startsWith("_system/") || key === "notice.json") {
        return json({ error: "非法文件路径" }, 400);
    }

    const owner = key.split("/")[1] || "";
    if (owner !== auth.name) return json({ error: "无权预览该文件" }, 403);

    const history = await readHistory(env.R2_BUCKET, auth.name);
    const matched = Array.isArray(history)
        ? history.some((item) => item?.fullPath === key && item?.deleted !== true)
        : false;
    if (!matched) return json({ error: "历史记录中未找到该文件" }, 404);

    const object = await env.R2_BUCKET.get(key);
    if (!object) return new Response("Not Found", { status: 404 });

    const fileName = key.split("/").pop() || "file";
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    const fallbackContentType = contentTypeForName(fileName);
    const currentContentType = String(headers.get("Content-Type") || "").toLowerCase();
    if (!currentContentType || currentContentType === "application/octet-stream") {
        headers.set("Content-Type", fallbackContentType);
    }
    headers.set("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(fileName)}"`);
    headers.set("Cache-Control", "private, no-store");
    return new Response(object.body, { headers });
}
