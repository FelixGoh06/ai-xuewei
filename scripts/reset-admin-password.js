#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) globalThis.btoa = (value) => Buffer.from(String(value), "binary").toString("base64");
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(String(value), "base64").toString("binary");

const ROOT = process.cwd();
const ADMIN_USERS_KEY = path.join("_system", "admin-users.json");

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

function usage() {
    console.log([
        "Usage:",
        "  node scripts/reset-admin-password.js <username> <new-password>",
        "",
        "Examples:",
        "  node scripts/reset-admin-password.js admin MyNewPassword123",
        "  node scripts/reset-admin-password.js teacher01 TempPass123",
        "",
        "The script updates the Linux local R2 admin store:",
        "  linux-data/r2/_system/admin-users.json"
    ].join("\n"));
}

function isValidUsername(username) {
    return /^[A-Za-z0-9_-]{3,32}$/.test(username);
}

function nowIso() {
    return new Date().toISOString();
}

async function readJson(filePath, fallback) {
    try {
        return JSON.parse(await readFile(filePath, "utf8"));
    } catch {
        return fallback;
    }
}

async function main() {
    parseEnvFile(path.join(ROOT, ".dev.vars"));
    parseEnvFile(path.join(ROOT, ".env"));

    const [, , usernameRaw, passwordRaw] = process.argv;
    const username = String(usernameRaw || "").trim();
    const password = String(passwordRaw || "");

    if (!username || !password || process.argv.includes("--help") || process.argv.includes("-h")) {
        usage();
        process.exit(username || password ? 0 : 1);
    }
    if (!isValidUsername(username)) {
        throw new Error("Username must be 3-32 characters: letters, numbers, underscore, or hyphen.");
    }
    if (password.length < 6) {
        throw new Error("New password must be at least 6 characters.");
    }

    const dataDir = path.resolve(process.env.LINUX_DATA_DIR || path.join(ROOT, "linux-data"));
    const r2Dir = path.resolve(process.env.LINUX_R2_DIR || path.join(dataDir, "r2"));
    const storePath = path.join(r2Dir, ADMIN_USERS_KEY);

    const { hashStudentPassword } = await import("../functions/api/student/auth.js");
    const store = await readJson(storePath, { version: 1, users: {} });
    if (!store.users || typeof store.users !== "object") store.users = {};

    const existing = store.users[username] || {};
    store.users[username] = {
        username,
        role: existing.role || (username === "admin" ? "owner" : "admin"),
        createdAt: existing.createdAt || nowIso(),
        ...existing,
        passwordHash: await hashStudentPassword(password),
        updatedAt: nowIso(),
        resetBy: "linux-cli",
        mustChangePassword: false
    };

    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, JSON.stringify(store, null, 2));

    console.log(`Admin password reset complete: ${username}`);
    console.log(`Store: ${storePath}`);
    console.log("Restart the Linux service if it is already running under a process manager.");
}

main().catch((error) => {
    console.error(`Reset failed: ${error.message || error}`);
    process.exit(1);
});
