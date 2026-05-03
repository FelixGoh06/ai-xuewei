import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";
import { LocalR2Bucket } from "./linux-adapter/local-r2.js";
import { LocalD1Database } from "./linux-adapter/local-d1.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) globalThis.btoa = (value) => Buffer.from(String(value), "binary").toString("base64");
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(String(value), "base64").toString("binary");

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const FUNCTIONS_DIR = path.join(ROOT, "functions", "api");

function parseEnvFile(filePath, { override = false } = {}) {
    if (!existsSync(filePath)) return;
    const text = readFileSync(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx <= 0) continue;
        const key = trimmed.slice(0, idx).trim();
        let value = trimmed.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (override || !process.env[key]) process.env[key] = value;
    }
}

parseEnvFile(path.join(ROOT, ".dev.vars"));
parseEnvFile(path.join(ROOT, ".env"), { override: true });

const DATA_DIR = path.resolve(process.env.LINUX_DATA_DIR || path.join(ROOT, "linux-data"));
await mkdir(DATA_DIR, { recursive: true });

const env = {
    ...process.env,
    R2_BUCKET: new LocalR2Bucket(process.env.LINUX_R2_DIR || path.join(DATA_DIR, "r2")),
    DB: new LocalD1Database(process.env.LINUX_DB_PATH || path.join(DATA_DIR, "app.db"))
};

function contentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".ico": "image/x-icon"
    };
    return map[ext] || "application/octet-stream";
}

function safePublicPath(urlPath) {
    let pathname = decodeURIComponent(urlPath);
    if (pathname === "/") pathname = "/index.html";
    if (pathname === "/login") pathname = "/login.html";
    if (pathname === "/admin") pathname = "/admin.html";
    const full = path.resolve(PUBLIC_DIR, `.${pathname}`);
    if (!full.startsWith(PUBLIC_DIR + path.sep) && full !== PUBLIC_DIR) return null;
    return full;
}

async function serveStatic(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const filePath = safePublicPath(url.pathname);
    if (!filePath) return sendText(res, 403, "Forbidden");
    try {
        const info = await stat(filePath);
        if (!info.isFile()) return sendText(res, 404, "Not Found");
        const body = await readFile(filePath);
        res.writeHead(200, {
            "Content-Type": contentType(filePath),
            "Cache-Control": "no-cache"
        });
        res.end(body);
    } catch {
        sendText(res, 404, "Not Found");
    }
}

function sendText(res, status, text) {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(text);
}

function functionFileForPath(pathname) {
    const rel = pathname.replace(/^\/api\/?/, "");
    if (!rel || rel.includes("..") || rel.includes("\\")) return null;
    const full = path.resolve(FUNCTIONS_DIR, `${rel}.js`);
    if (!full.startsWith(FUNCTIONS_DIR + path.sep)) return null;
    return full;
}

function handlerNameForMethod(method) {
    const normalized = method === "HEAD" ? "GET" : method;
    return `onRequest${normalized.charAt(0)}${normalized.slice(1).toLowerCase()}`;
}

async function nodeRequestToWebRequest(req) {
    const url = `http://${req.headers.host || "localhost"}${req.url}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) headers.set(key, value.join(", "));
        else if (value != null) headers.set(key, String(value));
    }
    const init = { method: req.method, headers };
    if (!["GET", "HEAD"].includes(req.method || "GET")) {
        init.body = req;
        init.duplex = "half";
    }
    return new Request(url, init);
}

async function sendWebResponse(res, response) {
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (!response.body) {
        res.end();
        return;
    }
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
}

async function serveFunction(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const filePath = functionFileForPath(url.pathname);
    if (!filePath || !existsSync(filePath)) return sendText(res, 404, "API Not Found");

    try {
        const info = await stat(filePath);
        const mod = await import(`${pathToFileURL(filePath).href}?v=${info.mtimeMs}`);
        const methodHandler = mod[handlerNameForMethod(req.method || "GET")];
        const handler = methodHandler || mod.onRequest;
        if (typeof handler !== "function") return sendText(res, 405, "Method Not Allowed");

        const request = await nodeRequestToWebRequest(req);
        const response = await handler({
            request,
            env,
            params: {},
            waitUntil: () => {}
        });
        await sendWebResponse(res, response);
    } catch (error) {
        console.error(error);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: error?.message || "Linux server error" }));
    }
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
        await serveFunction(req, res);
        return;
    }
    await serveStatic(req, res);
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
    console.log(`AI学委 Linux server ready: http://127.0.0.1:${port}`);
});
