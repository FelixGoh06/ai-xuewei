import { hashStudentPassword, verifyStudentPassword } from "../student/auth.js";

const ADMIN_USERS_KEY = "_system/admin-users.json";
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "123456";

function nowIso() {
    return new Date().toISOString();
}

function normalizeUsername(username) {
    return String(username || "").trim();
}

function isValidUsername(username) {
    return /^[A-Za-z0-9_-]{3,32}$/.test(username);
}

function publicUser(user) {
    return {
        username: user.username,
        role: user.role || "admin",
        createdAt: user.createdAt || "",
        updatedAt: user.updatedAt || "",
        mustChangePassword: Boolean(user.mustChangePassword)
    };
}

async function readJson(bucket, key, fallback) {
    const obj = await bucket.get(key);
    if (!obj) return fallback;
    try {
        return JSON.parse(await obj.text());
    } catch {
        return fallback;
    }
}

async function writeStore(bucket, store) {
    await bucket.put(ADMIN_USERS_KEY, JSON.stringify(store, null, 2), {
        httpMetadata: { contentType: "application/json" }
    });
}

async function adminsFromEnv(env) {
    let raw = {};
    try {
        raw = JSON.parse(env.ADMIN_USERS || "{}");
    } catch {
        raw = {};
    }
    const entries = Object.entries(raw).filter(([username, password]) => username && password);
    const source = entries.length ? entries : [[DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD]];
    const users = {};
    for (const [usernameRaw, passwordRaw] of source) {
        const username = normalizeUsername(usernameRaw);
        if (!isValidUsername(username)) continue;
        users[username] = {
            username,
            role: username === DEFAULT_ADMIN_USERNAME ? "owner" : "admin",
            passwordHash: await hashStudentPassword(String(passwordRaw)),
            createdAt: nowIso(),
            updatedAt: nowIso(),
            mustChangePassword: username === DEFAULT_ADMIN_USERNAME && String(passwordRaw) === DEFAULT_ADMIN_PASSWORD
        };
    }
    if (!users[DEFAULT_ADMIN_USERNAME]) {
        users[DEFAULT_ADMIN_USERNAME] = {
            username: DEFAULT_ADMIN_USERNAME,
            role: "owner",
            passwordHash: await hashStudentPassword(DEFAULT_ADMIN_PASSWORD),
            createdAt: nowIso(),
            updatedAt: nowIso(),
            mustChangePassword: true
        };
    }
    return { version: 1, users };
}

export async function readAdminUserStore(env) {
    const existing = await readJson(env.R2_BUCKET, ADMIN_USERS_KEY, null);
    if (existing?.users && typeof existing.users === "object") return existing;
    const store = await adminsFromEnv(env);
    await writeStore(env.R2_BUCKET, store);
    return store;
}

export async function listAdminUsers(env) {
    const store = await readAdminUserStore(env);
    return Object.values(store.users || {}).map(publicUser).sort((a, b) => a.username.localeCompare(b.username));
}

export async function verifyAdminPassword(env, usernameRaw, passwordRaw) {
    const username = normalizeUsername(usernameRaw);
    const store = await readAdminUserStore(env);
    const user = store.users?.[username];
    if (!user?.passwordHash) return { ok: false };
    const ok = await verifyStudentPassword(String(passwordRaw || ""), user.passwordHash);
    return ok ? { ok: true, user: publicUser(user) } : { ok: false };
}

export async function createAdminUser(env, usernameRaw, passwordRaw, creator) {
    const username = normalizeUsername(usernameRaw);
    const password = String(passwordRaw || "");
    if (!isValidUsername(username)) throw new Error("账号只能使用 3-32 位字母、数字、下划线或短横线");
    if (password.length < 6) throw new Error("默认密码至少 6 位");

    const store = await readAdminUserStore(env);
    if (store.users?.[username]) throw new Error("管理员账号已存在");
    store.users[username] = {
        username,
        role: "admin",
        passwordHash: await hashStudentPassword(password),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        createdBy: creator || "",
        mustChangePassword: true
    };
    await writeStore(env.R2_BUCKET, store);
    return publicUser(store.users[username]);
}

export async function changeAdminPassword(env, usernameRaw, oldPasswordRaw, newPasswordRaw) {
    const username = normalizeUsername(usernameRaw);
    const newPassword = String(newPasswordRaw || "");
    if (newPassword.length < 6) throw new Error("新密码至少 6 位");

    const store = await readAdminUserStore(env);
    const user = store.users?.[username];
    if (!user?.passwordHash) throw new Error("管理员不存在");
    const ok = await verifyStudentPassword(String(oldPasswordRaw || ""), user.passwordHash);
    if (!ok) throw new Error("原密码不正确");

    user.passwordHash = await hashStudentPassword(newPassword);
    user.updatedAt = nowIso();
    user.mustChangePassword = false;
    await writeStore(env.R2_BUCKET, store);
    return publicUser(user);
}

export async function resetAdminPassword(env, usernameRaw, newPasswordRaw, operator) {
    const username = normalizeUsername(usernameRaw);
    const newPassword = String(newPasswordRaw || "");
    if (username === DEFAULT_ADMIN_USERNAME) throw new Error("admin 主账号不能在后台被重置");
    if (newPassword.length < 6) throw new Error("新密码至少 6 位");

    const store = await readAdminUserStore(env);
    const user = store.users?.[username];
    if (!user?.passwordHash) throw new Error("管理员不存在");
    user.passwordHash = await hashStudentPassword(newPassword);
    user.updatedAt = nowIso();
    user.resetBy = operator || "";
    user.mustChangePassword = true;
    await writeStore(env.R2_BUCKET, store);
    return publicUser(user);
}

export function isOwnerAdmin(username) {
    return normalizeUsername(username) === DEFAULT_ADMIN_USERNAME;
}
