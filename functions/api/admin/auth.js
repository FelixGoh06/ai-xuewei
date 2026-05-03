const TOKEN_TTL_SECONDS = 8 * 60 * 60;

function base64UrlEncode(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeToBytes(str) {
    const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function getAdminSecret(env) {
    return (env.ADMIN_SESSION_SECRET || "").trim();
}

async function hmacSha256(secret, message) {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    return new Uint8Array(signature);
}

function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function readTokenFromRequest(request) {
    const authHeader = request.headers.get("Authorization") || "";
    if (authHeader.startsWith("Bearer ")) return authHeader.slice(7).trim();

    const url = new URL(request.url);
    const tokenQuery = url.searchParams.get("token");
    if (tokenQuery) return tokenQuery.trim();
    return "";
}

export async function issueAdminToken(env, username) {
    const secret = getAdminSecret(env);
    if (!secret) throw new Error("ADMIN_SESSION_SECRET is missing");

    const payload = {
        username,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
    };
    const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
    const sigB64 = base64UrlEncode(await hmacSha256(secret, payloadB64));
    return `${payloadB64}.${sigB64}`;
}

export async function verifyAdminRequest(request, env) {
    const secret = getAdminSecret(env);
    if (!secret) return { ok: false, reason: "Server auth config missing" };

    const token = readTokenFromRequest(request);
    if (!token) return { ok: false, reason: "Missing token" };

    const parts = token.split(".");
    if (parts.length !== 2) return { ok: false, reason: "Malformed token" };
    const [payloadB64, sigB64] = parts;

    const expectedSigB64 = base64UrlEncode(await hmacSha256(secret, payloadB64));
    if (!timingSafeEqual(sigB64, expectedSigB64)) return { ok: false, reason: "Invalid token signature" };

    let payload;
    try {
        payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(payloadB64)));
    } catch {
        return { ok: false, reason: "Invalid token payload" };
    }

    const now = Math.floor(Date.now() / 1000);
    if (!payload?.exp || payload.exp <= now) return { ok: false, reason: "Token expired" };
    if (!payload?.username) return { ok: false, reason: "Token missing username" };

    return { ok: true, username: payload.username };
}
