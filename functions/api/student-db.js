function parseCsvNames(value) {
    return String(value || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

function hasDb(env) {
    return Boolean(env?.DB && typeof env.DB.prepare === "function");
}

const DEFAULT_STUDENT_COLUMNS = ["classname", "name", "id"];

function normalizeColumnKey(key) {
    return String(key || "").trim().replace(/\s+/g, "");
}

function normalizeColumns(columns) {
    const base = Array.isArray(columns) ? columns : [];
    const seen = new Set();
    const out = [];
    for (const raw of base) {
        const key = normalizeColumnKey(raw);
        if (!key) continue;
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key)) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(key);
    }
    if (!seen.has("name")) out.unshift("name");
    return out.slice(0, 30);
}

function parseJsonSafe(text, fallback) {
    try {
        return JSON.parse(String(text || ""));
    } catch {
        return fallback;
    }
}

function pickStudentField(data, aliases) {
    if (!data || typeof data !== "object") return "";
    const normalized = new Set(aliases.map((item) => String(item || "").toLowerCase()));
    const key = Object.keys(data).find((item) => normalized.has(String(item || "").trim().toLowerCase()));
    return key ? String(data[key] || "").trim() : "";
}

let dbReady = false;

export async function ensureStudentDb(env) {
    if (!hasDb(env) || dbReady) return;
    const db = env.DB;

    await db.prepare(`
CREATE TABLE IF NOT EXISTS student_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`).run();

    await db.prepare(`
CREATE TABLE IF NOT EXISTS student_records (
  name TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
)`).run();

    await db.prepare(`
CREATE TABLE IF NOT EXISTS naming_rules (
  subject TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`).run();

    await db.prepare(`
CREATE TABLE IF NOT EXISTS student_auth (
  name TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
)`).run();

    dbReady = true;
}

export async function listStudentColumns(env) {
    if (!hasDb(env)) return [...DEFAULT_STUDENT_COLUMNS];
    await ensureStudentDb(env);
    const row = await env.DB.prepare("SELECT v FROM student_meta WHERE k = 'columns' LIMIT 1").first();
    const cols = normalizeColumns(parseJsonSafe(row?.v, []));
    return cols.length > 0 ? cols : [...DEFAULT_STUDENT_COLUMNS];
}

async function saveStudentColumns(env, columns) {
    const cols = normalizeColumns(columns);
    await env.DB.prepare(`
INSERT INTO student_meta (k, v, updated_at)
VALUES ('columns', ?1, CURRENT_TIMESTAMP)
ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = CURRENT_TIMESTAMP
`).bind(JSON.stringify(cols)).run();
    return cols;
}

export async function listStudents(env) {
    if (!hasDb(env)) {
        return parseCsvNames(env.ALLOWED_NAMES).map((name) => ({
            classname: "",
            name,
            id: "",
            active: true
        }));
    }
    await ensureStudentDb(env);
    const columns = await listStudentColumns(env);
    const res = await env.DB.prepare(`
SELECT name, data, active
FROM student_records
ORDER BY name COLLATE NOCASE ASC
`).all();
    return (res?.results || []).map((row) => {
        const data = parseJsonSafe(row?.data, {});
        const item = { active: Number(row?.active || 0) === 1 };
        for (const col of columns) {
            item[col] = String(data?.[col] || "").trim();
        }
        item.name = String(item.name || row?.name || "").trim();
        return item;
    });
}

export async function listStudentClasses(env) {
    const students = await listStudents(env);
    const set = new Set();
    for (const student of students) {
        const className = pickStudentField(student, ["className", "classname", "class", "班级"]);
        if (className) set.add(className);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export async function replaceStudentsBulk(env, rows, columnsInput) {
    if (!hasDb(env)) throw new Error("D1 未配置：请先绑定 DB");
    await ensureStudentDb(env);

    const columns = await saveStudentColumns(env, columnsInput);
    const clean = (Array.isArray(rows) ? rows : [])
        .map((r) => {
            const obj = {};
            for (const col of columns) {
                obj[col] = String(r?.[col] || "").trim();
            }
            obj.name = String(obj.name || "").trim();
            return obj;
        })
        .filter((r) => r.name)
        .slice(0, 5000);

    await env.DB.prepare("DELETE FROM student_records").run();

    const stmts = clean.map((r) => {
        const name = r.name;
        const payload = JSON.stringify(r);
        return env.DB.prepare(`
INSERT INTO student_records (name, data, active, updated_at)
VALUES (?1, ?2, 1, CURRENT_TIMESTAMP)
`).bind(name, payload);
    });
    if (stmts.length > 0) await env.DB.batch(stmts);

    const students = await listStudents(env);
    return { students, columns };
}

export async function getActiveRosterNames(env, className = "") {
    if (!hasDb(env)) return parseCsvNames(env.ALLOWED_NAMES);
    await ensureStudentDb(env);
    const filterClass = String(className || "").trim();
    const res = await env.DB.prepare(`
SELECT name, data
FROM student_records
WHERE active = 1
ORDER BY name COLLATE NOCASE ASC
`).all();
    return (res?.results || [])
        .filter((r) => {
            if (!filterClass) return true;
            const data = parseJsonSafe(r?.data, {});
            const rowClass = pickStudentField(data, ["className", "classname", "class", "班级"]);
            return rowClass === filterClass;
        })
        .map((r) => String(r?.name || "").trim())
        .filter(Boolean);
}

export async function getStudentByName(env, name) {
    const target = String(name || "").trim();
    if (!target) return null;

    if (!hasDb(env)) {
        return { name: target, studentId: "", className: "" };
    }

    await ensureStudentDb(env);
    const row = await env.DB.prepare(`
SELECT name, data, active
FROM student_records
WHERE name = ?1
LIMIT 1
`).bind(target).first();
    if (!row || Number(row.active || 0) !== 1) return null;

    const data = parseJsonSafe(row.data, {});
    return {
        ...data,
        name: String(data?.name || row.name || "").trim()
    };
}

export async function getNamingRule(env, subject) {
    if (!hasDb(env)) return { subject: "", template: "" };
    await ensureStudentDb(env);
    const subjectKey = String(subject || "").trim();
    if (subjectKey) {
        const row = await env.DB.prepare("SELECT subject, template FROM naming_rules WHERE subject = ?1 LIMIT 1")
            .bind(subjectKey)
            .first();
        if (row?.template) return { subject: subjectKey, template: String(row.template) };
    }
    const globalRow = await env.DB.prepare("SELECT subject, template FROM naming_rules WHERE subject = '*GLOBAL*' LIMIT 1").first();
    if (globalRow?.template) return { subject: String(globalRow.subject || "*GLOBAL*"), template: String(globalRow.template) };
    return { subject: "", template: "" };
}

export async function setNamingRule(env, subject, template) {
    if (!hasDb(env)) throw new Error("D1 未配置：请先绑定 DB");
    await ensureStudentDb(env);
    const subjectKey = String(subject || "").trim();
    if (!subjectKey) throw new Error("科目不能为空");

    const tpl = String(template || "").trim().slice(0, 400);
    if (!tpl) {
        await env.DB.prepare("DELETE FROM naming_rules WHERE subject = ?1").bind(subjectKey).run();
        return { subject: subjectKey, template: "" };
    }

    await env.DB.prepare(`
INSERT INTO naming_rules (subject, template, updated_at)
VALUES (?1, ?2, CURRENT_TIMESTAMP)
ON CONFLICT(subject) DO UPDATE SET template = excluded.template, updated_at = CURRENT_TIMESTAMP
`).bind(subjectKey, tpl).run();

    return { subject: subjectKey, template: tpl };
}

export function isD1Ready(env) {
    return hasDb(env);
}

export async function getActiveStudentByLogin(env, loginRaw) {
    const login = String(loginRaw || "").trim();
    if (!login) return null;
    if (!hasDb(env)) return null;
    await ensureStudentDb(env);

    const res = await env.DB.prepare(`
SELECT name, data, active
FROM student_records
WHERE active = 1
`).all();
    for (const row of res?.results || []) {
        const data = parseJsonSafe(row?.data, {});
        const name = String(data?.name || row?.name || "").trim();
        const studentId = pickStudentField(data, ["studentId", "studentid", "id", "学号"]);
        const username = String(data?.username || data?.user || "").trim();
        const className = pickStudentField(data, ["className", "classname", "class", "班级"]);
        if (!name) continue;
        if (login === name || (studentId && login === studentId) || (username && login === username)) {
            return {
                ...data,
                name,
                studentId,
                username,
                className
            };
        }
    }
    return null;
}

export async function getStudentAuthByName(env, nameRaw) {
    const name = String(nameRaw || "").trim();
    if (!name || !hasDb(env)) return null;
    await ensureStudentDb(env);
    const row = await env.DB.prepare(`
SELECT name, password_hash, must_change_password
FROM student_auth
WHERE name = ?1
LIMIT 1
`).bind(name).first();
    if (!row) return null;
    return {
        name: String(row.name || "").trim(),
        passwordHash: String(row.password_hash || ""),
        mustChangePassword: Number(row.must_change_password || 0) === 1
    };
}

export async function upsertStudentAuth(env, nameRaw, passwordHash, mustChangePassword = true) {
    const name = String(nameRaw || "").trim();
    if (!name || !hasDb(env)) throw new Error("D1 未配置或姓名为空");
    await ensureStudentDb(env);
    await env.DB.prepare(`
INSERT INTO student_auth (name, password_hash, must_change_password, updated_at)
VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
ON CONFLICT(name) DO UPDATE SET
  password_hash = excluded.password_hash,
  must_change_password = excluded.must_change_password,
  updated_at = CURRENT_TIMESTAMP
`).bind(name, String(passwordHash || ""), mustChangePassword ? 1 : 0).run();
}
