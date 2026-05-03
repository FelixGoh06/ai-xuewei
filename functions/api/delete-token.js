const DELETE_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function getDeleteSecret(env) {
    return (env.DELETE_TOKEN_SECRET || env.ADMIN_SESSION_SECRET || "").trim();
}

function toBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(str) {
    const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function hmac(secret, message) {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    return new Uint8Array(sig);
}

function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export async function issueDeleteToken(env, filePath) {
    const secret = getDeleteSecret(env);
    if (!secret) throw new Error("DELETE_TOKEN_SECRET missing");

    const payload = {
        path: filePath,
        exp: Math.floor(Date.now() / 1000) + DELETE_TOKEN_TTL_SECONDS
    };
    const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const sigB64 = toBase64Url(await hmac(secret, payloadB64));
    return `${payloadB64}.${sigB64}`;
}

export async function verifyDeleteToken(env, filePath, token) {
    const secret = getDeleteSecret(env);
    if (!secret) return { ok: false, reason: "Server delete-token config missing" };
    if (!token || typeof token !== "string") return { ok: false, reason: "Missing delete token" };

    const parts = token.split(".");
    if (parts.length !== 2) return { ok: false, reason: "Malformed delete token" };
    const [payloadB64, sigB64] = parts;

    const expectedSig = toBase64Url(await hmac(secret, payloadB64));
    if (!safeEqual(sigB64, expectedSig)) return { ok: false, reason: "Invalid delete token signature" };

    let payload;
    try {
        payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
    } catch {
        return { ok: false, reason: "Invalid delete token payload" };
    }

    const now = Math.floor(Date.now() / 1000);
    if (!payload?.exp || payload.exp <= now) return { ok: false, reason: "Delete token expired" };
    if (payload?.path !== filePath) return { ok: false, reason: "Delete token does not match file path" };

    return { ok: true };
}
