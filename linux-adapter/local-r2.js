import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

function toPosixKey(key) {
    return String(key || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function assertSafeKey(key) {
    const normalized = path.posix.normalize(toPosixKey(key));
    if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
        throw new Error("Invalid object key");
    }
    return normalized;
}

async function bodyToBuffer(body) {
    if (body == null) return Buffer.alloc(0);
    if (typeof body === "string") return Buffer.from(body);
    if (Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (body instanceof ArrayBuffer) return Buffer.from(body);
    if (typeof body.arrayBuffer === "function") return Buffer.from(await body.arrayBuffer());
    if (typeof body.getReader === "function") {
        const chunks = [];
        for await (const chunk of Readable.fromWeb(body)) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
    }
    if (typeof body[Symbol.asyncIterator] === "function") {
        const chunks = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
    }
    return Buffer.from(String(body));
}

async function walkFiles(root, dir = root) {
    let entries = [];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    const out = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...await walkFiles(root, full));
        } else {
            out.push(full);
        }
    }
    return out;
}

export class LocalR2Object {
    constructor({ key, filePath, meta = {}, stats }) {
        this.key = key;
        this.filePath = filePath;
        this.size = stats?.size || 0;
        this.uploaded = stats?.mtime || new Date();
        this.httpMetadata = meta.httpMetadata || {};
        this.body = createReadStream(filePath);
    }

    async text() {
        return readFile(this.filePath, "utf8");
    }

    async arrayBuffer() {
        const buf = await readFile(this.filePath);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }

    writeHttpMetadata(headers) {
        const contentType = this.httpMetadata?.contentType || this.httpMetadata?.content_type;
        if (contentType) headers.set("Content-Type", contentType);
        headers.set("Content-Length", String(this.size));
    }
}

export class LocalR2Bucket {
    constructor(rootDir) {
        this.rootDir = path.resolve(rootDir);
        this.metaDir = path.join(this.rootDir, ".meta");
    }

    resolveKey(key) {
        const safe = assertSafeKey(key);
        const full = path.resolve(this.rootDir, safe);
        if (!full.startsWith(this.rootDir + path.sep) && full !== this.rootDir) {
            throw new Error("Invalid object key");
        }
        return { safe, full };
    }

    metaPath(key) {
        const safe = assertSafeKey(key);
        return path.join(this.metaDir, `${encodeURIComponent(safe)}.json`);
    }

    async put(key, value, options = {}) {
        const { safe, full } = this.resolveKey(key);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, await bodyToBuffer(value));
        await mkdir(this.metaDir, { recursive: true });
        await writeFile(this.metaPath(safe), JSON.stringify({
            httpMetadata: options.httpMetadata || {},
            uploaded: new Date().toISOString()
        }));
        return { key: safe };
    }

    async get(key) {
        const { safe, full } = this.resolveKey(key);
        let stats;
        try {
            stats = await stat(full);
            if (!stats.isFile()) return null;
        } catch {
            return null;
        }
        let meta = {};
        try {
            meta = JSON.parse(await readFile(this.metaPath(safe), "utf8"));
        } catch { }
        return new LocalR2Object({ key: safe, filePath: full, meta, stats });
    }

    async delete(key) {
        const { safe, full } = this.resolveKey(key);
        await rm(full, { force: true });
        await rm(this.metaPath(safe), { force: true });
    }

    async list(options = {}) {
        await mkdir(this.rootDir, { recursive: true });
        const prefix = toPosixKey(options.prefix || "");
        const delimiter = options.delimiter || "";
        const files = await walkFiles(this.rootDir);
        const objects = [];
        const delimitedPrefixes = new Set();

        for (const file of files) {
            if (file.startsWith(this.metaDir + path.sep)) continue;
            const rel = path.relative(this.rootDir, file).split(path.sep).join("/");
            if (prefix && !rel.startsWith(prefix)) continue;
            const rest = prefix ? rel.slice(prefix.length) : rel;
            if (delimiter && rest.includes(delimiter)) {
                delimitedPrefixes.add(`${prefix}${rest.split(delimiter)[0]}${delimiter}`);
                continue;
            }
            const stats = await stat(file);
            objects.push({ key: rel, size: stats.size, uploaded: stats.mtime });
        }

        return {
            objects: objects.sort((a, b) => a.key.localeCompare(b.key)),
            delimitedPrefixes: Array.from(delimitedPrefixes).sort(),
            truncated: false,
            cursor: undefined
        };
    }
}
