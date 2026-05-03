const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_PASSWORD = "123456";
const PASSWORD_PBKDF2_ITERATIONS = 10000;
const PASSWORD_PBKDF2_MIN_ITERATIONS = 5000;
const PASSWORD_PBKDF2_MAX_ITERATIONS = 100000;

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

function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function getStudentSecret(env) {
    return String(env.STUDENT_SESSION_SECRET || env.ADMIN_SESSION_SECRET || "").trim();
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

function readTokenFromRequest(request) {
    const authHeader = request.headers.get("Authorization") || "";
    if (authHeader.startsWith("Bearer ")) return authHeader.slice(7).trim();
    const url = new URL(request.url);
    return String(url.searchParams.get("token") || "").trim();
}

async function pbkdf2(password, saltBytes, iterations = PASSWORD_PBKDF2_ITERATIONS) {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(String(password || "")),
        "PBKDF2",
        false,
        ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
        key,
        256
    );
    return new Uint8Array(bits);
}

export async function hashStudentPassword(passwordRaw) {
    const password = String(passwordRaw || "");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = PASSWORD_PBKDF2_ITERATIONS;
    const hash = await pbkdf2(password, salt, iterations);
    return `pbkdf2$${iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(hash)}`;
}

export async function verifyStudentPassword(passwordRaw, storedRaw) {
    const stored = String(storedRaw || "");
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const iterations = Number(parts[1] || 0);
    if (
        !Number.isFinite(iterations) ||
        iterations < PASSWORD_PBKDF2_MIN_ITERATIONS ||
        iterations > PASSWORD_PBKDF2_MAX_ITERATIONS
    ) return false;
    const salt = base64UrlDecodeToBytes(parts[2]);
    const expected = parts[3];
    try {
        const actual = base64UrlEncode(await pbkdf2(String(passwordRaw || ""), salt, iterations));
        return timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}

export async function issueStudentToken(env, profile) {
    const secret = getStudentSecret(env);
    if (!secret) throw new Error("STUDENT_SESSION_SECRET missing");
    const payload = {
        name: String(profile?.name || "").trim(),
        studentId: String(profile?.studentId || "").trim(),
        username: String(profile?.username || "").trim(),
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
    };
    const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
    const sigB64 = base64UrlEncode(await hmacSha256(secret, payloadB64));
    return `${payloadB64}.${sigB64}`;
}

export async function verifyStudentRequest(request, env) {
    const secret = getStudentSecret(env);
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
    const name = String(payload?.name || "").trim();
    if (!name) return { ok: false, reason: "Token missing name" };
    return {
        ok: true,
        name,
        studentId: String(payload?.studentId || "").trim(),
        username: String(payload?.username || "").trim()
    };
}

export function isDefaultStudentPassword(passwordRaw) {
    return String(passwordRaw || "") === DEFAULT_PASSWORD;
}
