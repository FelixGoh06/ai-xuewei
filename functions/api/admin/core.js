import { verifyAdminRequest } from "./auth.js";
import {
    formatKnowledgeForPrompt,
    searchAdminKnowledge,
    summarizeAdminKnowledge
} from "./knowledge.js";
import { readDeadlines, writeDeadlines } from "../deadlines-store.js";
import { readExemptions, setExemption } from "../exemptions-store.js";
import { readGradesBySubject, upsertGradesBySubject } from "../grades-store.js";
import { applyGradeToHistoryBySubject, readHistory } from "../history-store.js";
import { appendAuditLog, readAuditLogs } from "../audit-store.js";
import { callOpenAI, runAdminGradeDraftAi, runAdminReminderAi } from "../ai-helper.js";
import { getMergedAiRule, setAiRule } from "../ai-rules-store.js";
import {
    deleteAssignmentRequirement,
    getAssignmentRequirement,
    setAssignmentRequirement
} from "../requirements-store.js";
import {
    deleteSubjectSettings,
    getSubjectSettings,
    readSubjectSettings,
    setSubjectSettings
} from "../subject-settings-store.js";
import {
    getPlagiarismResult,
    readPlagiarismResults,
    runPlagiarismCheck
} from "../plagiarism-store.js";
import { getModelSettings, setModelSettings } from "../model-settings-store.js";
import { deleteSubjectMeta, setSubjectCreatedBy } from "../subject-meta-store.js";
import {
    getActiveRosterNames,
    getStudentByName,
    isD1Ready,
    listStudents,
    listStudentColumns,
    listStudentClasses,
    replaceStudentsBulk,
    getNamingRule,
    setNamingRule
} from "../student-db.js";
import { hashStudentPassword } from "../student/auth.js";
import {
    changeAdminPassword,
    createAdminUser,
    isOwnerAdmin,
    listAdminUsers,
    resetAdminPassword
} from "./admin-users-store.js";

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
}

function decorateAdminUsersForClient(users) {
    return (Array.isArray(users) ? users : []).map((user) => ({
        ...user,
        permissions: user.username === "admin"
            ? ["可配置模型", "可管理账号"]
            : []
    }));
}

function isSafeTopLevelName(name) {
    return typeof name === "string" && /^[^/\\]{1,100}$/.test(name.trim());
}

function isSafeObjectKey(key) {
    if (typeof key !== "string") return false;
    const trimmed = key.trim();
    if (!trimmed || trimmed.length > 512) return false;
    if (trimmed.includes("..") || trimmed.includes("\\")) return false;
    return /^[^/]+(?:\/[^/]+)+$/.test(trimmed);
}

async function listAllByPrefix(bucket, prefix) {
    const all = [];
    let cursor;
    do {
        const listed = await bucket.list({ prefix, cursor });
        all.push(...(listed.objects || []));
        cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    return all;
}

function isSystemSubject(name) {
    return String(name || "").startsWith("_system");
}

function isValidOptionalDateTime(value) {
    if (!value) return true;
    return !Number.isNaN(Date.parse(value));
}

function generateTempPassword(length = 10) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    let out = "";
    for (let i = 0; i < length; i++) {
        out += chars[bytes[i] % chars.length];
    }
    return out;
}

const DEFAULT_RESET_PASSWORD = "123456";

const ADMIN_ENTRY_MAP = [
    { view: "dashboard", label: "工作室 / 总览", keywords: ["总览", "首页", "工作室", "作业池", "dashboard"] },
    { view: "notice", label: "修改公告", keywords: ["公告", "通知", "弹幕"] },
    { view: "students", label: "学生库", keywords: ["学生", "学生库", "名单", "班级", "添加学生", "删除学生"] },
    { view: "ai-rules", label: "AI 规则", keywords: ["ai规则", "规则", "faq", "作业要求"] },
    { view: "model-settings", label: "模型配置中心", keywords: ["模型", "key", "api key", "base url", "embedding"] },
    { view: "audit", label: "审计日志", keywords: ["审计", "日志", "操作记录"] },
    { view: "admin-accounts", label: "管理员账号", keywords: ["管理员", "账号", "密码", "重置管理员"] }
];

function normalizeText(value) {
    return String(value || "").trim();
}

function findAdminEntry(message) {
    const text = normalizeText(message).toLowerCase();
    if (!/(在哪|入口|打开|跳转|进入|去|找|页面|功能)/u.test(text)) return null;
    return ADMIN_ENTRY_MAP.find((entry) => entry.keywords.some((keyword) => text.includes(String(keyword).toLowerCase()))) || null;
}

async function listSubjectStats(env) {
    const subjects = {};
    const deadlines = await readDeadlines(env.R2_BUCKET);
    const subjectSettings = await readSubjectSettings(env.R2_BUCKET);
    const allRosterNames = await getActiveRosterNames(env);
    const rosterCache = new Map();
    async function rosterForClasses(classNames = []) {
        const classes = Array.isArray(classNames) ? classNames.map((item) => String(item || "").trim()).filter(Boolean) : [];
        if (classes.length === 0) return allRosterNames;
        const cacheKey = classes.slice().sort().join("\n");
        if (rosterCache.has(cacheKey)) return rosterCache.get(cacheKey);
        const set = new Set();
        for (const className of classes) {
            const names = await getActiveRosterNames(env, className);
            names.forEach((name) => set.add(name));
        }
        const result = Array.from(set);
        rosterCache.set(cacheKey, result);
        return result;
    }
    let cursor;
    do {
        const listed = await env.R2_BUCKET.list({ cursor });
        for (const obj of listed.objects || []) {
            const key = String(obj.key || "");
            if (!key || key === "notice.json" || !key.includes("/") || key.startsWith("_system/")) continue;
            const parts = key.split("/");
            const subject = parts[0];
            if (!subjects[subject]) subjects[subject] = new Set();
            if (parts.length >= 2 && !key.endsWith("/.keep")) subjects[subject].add(parts[1]);
        }
        cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    const result = [];
    for (const name of Object.keys(subjects).sort()) {
        const classes = subjectSettings[name]?.classNames || [];
        const rosterNames = await rosterForClasses(classes);
        const submittedNames = Array.from(subjects[name]);
        const eligibleSet = new Set(rosterNames);
        const eligibleSubmitted = rosterNames.length > 0
            ? submittedNames.filter((studentName) => eligibleSet.has(studentName)).length
            : submittedNames.length;
        const missingNames = rosterNames.filter((studentName) => !subjects[name].has(studentName));
        result.push({
            name,
            submitted: eligibleSubmitted,
            rawSubmitted: submittedNames.length,
            expected: rosterNames.length,
            missing: missingNames.length,
            missingNames,
            classNames: classes,
            deadline: deadlines[name] || ""
        });
    }
    return result;
}

function pickSubjectFromMessage(message, stats) {
    const text = normalizeText(message);
    const sorted = [...stats].sort((a, b) => b.name.length - a.name.length);
    return sorted.find((item) => text.includes(item.name)) || null;
}

function parseStudentPayload(message) {
    const text = normalizeText(message);
    const classHint = parseClassNameFromMessage(text);
    const withoutClass = text
        .replace(/(?:班级|className|class)\s*[：: ]\s*[\u4e00-\u9fffA-Za-z0-9_-]{1,40}/giu, " ")
        .replace(/[0-9一二三四五六七八九十]{1,4}\s*班(?:级)?(?:的)?/gu, " ")
        .replace(/[\u4e00-\u9fffA-Za-z0-9_-]{1,20}\s*班(?:级)?(?:的)?/gu, (match) => {
            return normalizeClassAlias(match) === normalizeClassAlias(classHint) ? " " : match;
        });
    const nameMatch = text.match(/(?:姓名|名字|叫|名叫)\s*[：: ]?\s*([A-Za-z0-9_-]{1,40}|[\u4e00-\u9fff]{1,8})(?:的)?(?:同学|学生)?/u)
        || withoutClass.match(/(?:添加|新增|加入|删除|移除|删掉)\s*(?:这个|该|这位|那位|那个)?\s*([A-Za-z0-9_-]{1,40}|[\u4e00-\u9fff]{1,8})(?:的)?(?:同学|学生)?/u)
        || withoutClass.match(/(?:这个|该|这位|那位|那个)?\s*([A-Za-z0-9_-]{1,40}|[\u4e00-\u9fff]{1,8})\s*(?:同学|学生)/u);
    const idMatch = text.match(/(?:学号|id|ID)\s*[：: ]\s*([A-Za-z0-9_-]{1,40})/u);
    const classMatch = text.match(/(?:班级|className|class)\s*[：: ]\s*([\u4e00-\u9fffA-Za-z0-9_-]{1,40})/u);
    const cleanName = (value) => normalizeText(value)
        .replace(/^(这个|该|这位|那位|那个)/u, "")
        .replace(/^(的|把|将|要)$/u, "");
    return {
        name: nameMatch ? cleanName(nameMatch[1]) : "",
        studentId: idMatch ? normalizeText(idMatch[1]) : "",
        className: classMatch ? normalizeText(classMatch[1]) : classHint
    };
}

function parseBareStudentName(message) {
    const text = normalizeText(message);
    if (!text || text.length > 40) return "";
    if (/[，,。；;？！?\s]/u.test(text)) return "";
    if (/(班|科目|作业|公告|模型|密码|规则|设置|删除|新增|查询|查看|名单)/u.test(text)) return "";
    return /^[\u4e00-\u9fffA-Za-z0-9_-]{1,40}$/u.test(text) ? text : "";
}

function pendingContext(action, missing, extra = {}) {
    return {
        pendingAction: action,
        pendingSkill: ADMIN_ACTION_TO_SKILL[action] || "",
        missing,
        ...extra
    };
}

function normalizeClassAlias(value) {
    let text = normalizeText(value).toLowerCase();
    const zhMap = { 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10" };
    text = text.replace(/[一二三四五六七八九十]/g, (m) => zhMap[m] || m);
    text = text.replace(/班级|班|class(name)?|[\s_-]/g, "");
    if (/^\d+$/.test(text)) return String(Number(text));
    return text;
}

function parseClassNameFromMessage(message) {
    const text = normalizeText(message);
    const patterns = [
        /(?:班级|className|class)\s*[：: ]\s*([\u4e00-\u9fffA-Za-z0-9_-]{1,40})/iu,
        /([0-9一二三四五六七八九十]{1,4})\s*班/u,
        /^那?([0-9一二三四五六七八九十]{1,4})\s*班?(?:呢|那|的|名单)?$/u,
        /(?:^|[，,。；;\s])([\u4e00-\u9fffA-Za-z0-9_-]{1,20})\s*班(?:的)?(?:所有)?(?:人员|学生|名单|同学)/u
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return normalizeText(match[1]);
    }
    return "";
}

async function findClassNameInMessage(env, message) {
    const text = normalizeText(message);
    const explicit = parseClassNameFromMessage(text);
    const classes = await listStudentClasses(env).catch(() => []);
    if (explicit) {
        const alias = normalizeClassAlias(explicit);
        return classes.find((item) => normalizeClassAlias(item) === alias) || explicit;
    }
    for (const className of classes) {
        const alias = normalizeClassAlias(className);
        if (!alias) continue;
        const patterns = [
            new RegExp(`${alias}\\s*班`, "i"),
            new RegExp(`班级\\s*[：: ]\\s*${alias}`, "i")
        ];
        if (patterns.some((pattern) => pattern.test(text))) return className;
    }
    return "";
}

function looksLikeClassFollowUp(message) {
    return /^那?[0-9一二三四五六七八九十]{1,4}\s*班?(?:呢|那|的|名单)?$/u.test(normalizeText(message));
}

function studentClassOf(row) {
    if (!row || typeof row !== "object") return "";
    const key = Object.keys(row).find((item) => ["classname", "class", "班级"].includes(String(item || "").trim().toLowerCase()));
    return key ? normalizeText(row[key]) : "";
}

async function resolveClassName(env, requested) {
    const raw = normalizeText(requested);
    if (!raw) return "";
    const classes = await listStudentClasses(env);
    const target = normalizeClassAlias(raw);
    return classes.find((name) => normalizeClassAlias(name) === target) || raw;
}

const ADMIN_CAPABILITIES = [
    "打开后台页面：总览、公告、学生库、全局 AI 规则、模型配置、审计日志、管理员账号",
    "科目/作业：新增科目、删除科目、查询提交情况、设置或清除截止时间",
    "提交文件：列出文件、删除指定文件、对指定文件运行查重",
    "作业设置：设置命名模板、作业要求、允许后缀、查重模式、适用班级、免交学生",
    "学生库：新增学生、删除学生、修改学生字段、重置学生密码",
    "评分：为某个作业的学生保存分数和评语",
    "公告：修改标题、内容、发布时间、过期时间",
    "AI：修改全局或科目 AI 规则、模型 Base URL、模型名、API Key、超时时间",
    "管理员：修改当前密码、admin 主账号新增管理员、重置其他管理员密码"
];

const ADMIN_ASSISTANT_ACTIONS = [
    "help", "navigate", "query_submission", "create_subject", "delete_subject", "set_deadline",
    "query_students",
    "update_notice", "set_ai_rules", "set_model_settings", "create_admin", "change_admin_password", "reset_admin_password",
    "add_student", "delete_student", "delete_students_by_class", "reset_student_password", "set_student_columns",
    "set_naming_rule", "set_assignment_requirement", "set_subject_settings", "set_exemption",
    "save_grade", "run_plagiarism", "delete_file", "list_files"
];

const ADMIN_SKILLS = [
    { skill: "help.show", action: "help", params: [], description: "查看后台助手能力清单" },
    { skill: "page.open", action: "navigate", params: ["target"], description: "打开后台页面，例如 students/model-settings/audit" },
    { skill: "submission.query", action: "query_submission", params: ["subject"], description: "查询某个作业或全部作业提交情况" },
    { skill: "student.list", action: "query_students", params: ["className"], description: "查询学生库或某个班级学生名单" },
    { skill: "student.add", action: "add_student", params: ["name", "studentId", "className"], description: "新增学生" },
    { skill: "student.delete", action: "delete_student", params: ["name", "className"], description: "删除学生" },
    { skill: "student.delete_by_class", action: "delete_students_by_class", params: ["className"], description: "删除某个班级的所有学生" },
    { skill: "student.reset_password", action: "reset_student_password", params: ["name", "mode"], description: "重置学生密码" },
    { skill: "student.columns.set", action: "set_student_columns", params: ["columns"], description: "修改学生库字段" },
    { skill: "subject.create", action: "create_subject", params: ["subject"], description: "新增科目/作业" },
    { skill: "subject.delete", action: "delete_subject", params: ["subject"], description: "删除科目/作业" },
    { skill: "subject.deadline.set", action: "set_deadline", params: ["subject", "deadline"], description: "设置或清除截止时间" },
    { skill: "subject.naming.set", action: "set_naming_rule", params: ["subject", "template"], description: "设置命名模板" },
    { skill: "subject.requirement.set", action: "set_assignment_requirement", params: ["subject", "requirement"], description: "设置作业要求" },
    { skill: "subject.settings.set", action: "set_subject_settings", params: ["subject", "allowedExtensions", "plagiarismMode", "classNames"], description: "设置允许后缀、查重模式、适用班级" },
    { skill: "subject.exemption.set", action: "set_exemption", params: ["subject", "name", "enabled"], description: "设置或取消学生免交" },
    { skill: "file.list", action: "list_files", params: ["subject"], description: "列出作业提交文件" },
    { skill: "file.delete", action: "delete_file", params: ["subject", "key"], description: "删除提交文件" },
    { skill: "file.plagiarism.run", action: "run_plagiarism", params: ["subject", "key"], description: "运行文件查重" },
    { skill: "grade.save", action: "save_grade", params: ["subject", "name", "score", "comment"], description: "保存学生评分和评语" },
    { skill: "notice.update", action: "update_notice", params: ["title", "content", "publishAt", "expireAt"], description: "更新公告" },
    { skill: "ai.rules.set", action: "set_ai_rules", params: ["subject", "requirements", "faq", "examples"], description: "更新全局或科目 AI 规则" },
    { skill: "model.settings.set", action: "set_model_settings", params: ["aiBaseUrl", "apiKey", "lightModel", "heavyModel", "embeddingModel", "timeoutMs"], description: "更新模型配置" },
    { skill: "admin.create", action: "create_admin", params: ["username", "password"], description: "新增管理员" },
    { skill: "admin.password.change", action: "change_admin_password", params: ["oldPassword", "newPassword"], description: "修改当前管理员密码" },
    { skill: "admin.password.reset", action: "reset_admin_password", params: ["username", "password"], description: "重置其他管理员密码" }
];

const ADMIN_SKILL_BY_NAME = Object.fromEntries(ADMIN_SKILLS.map((item) => [item.skill, item]));
const ADMIN_ACTION_TO_SKILL = Object.fromEntries(ADMIN_SKILLS.map((item) => [item.action, item.skill]));

function cleanMaybeJson(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    return raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function parseJsonObject(text) {
    try {
        const parsed = JSON.parse(cleanMaybeJson(text));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function normalizeAdminAction(action) {
    const value = String(action || "").trim();
    return ADMIN_ASSISTANT_ACTIONS.includes(value) ? value : "";
}

function skillToOperation(skillCall) {
    if (!skillCall || typeof skillCall !== "object") return null;
    const skillName = String(skillCall.skill || skillCall.name || "").trim();
    const skill = ADMIN_SKILL_BY_NAME[skillName];
    if (!skill) return null;
    const params = skillCall.params && typeof skillCall.params === "object" && !Array.isArray(skillCall.params)
        ? skillCall.params
        : skillCall;
    const op = { action: skill.action };
    for (const key of skill.params) {
        if (params[key] !== undefined) op[key] = params[key];
    }
    if (params.target !== undefined) op.target = params.target;
    if (params.mode !== undefined) op.target = params.mode;
    if (params.requirements !== undefined) op.requirements = params.requirements;
    return op;
}

function operationToContext(op, extra = {}) {
    const action = normalizeAdminAction(op?.action);
    return {
        lastAction: action || "",
        lastSkill: String(op?.skill || ADMIN_ACTION_TO_SKILL[action] || ""),
        ...extra
    };
}

function isExplicitHelpQuestion(message) {
    const text = normalizeText(message);
    return /(你能干嘛|你会干嘛|能力清单|后台功能|能操作什么|会操作什么|使用帮助|help)/iu.test(text)
        || (/^(这个)?(助手|后台助手|ai|AI)?怎么用[？?]?$/u.test(text));
}

function isKnowledgeOnlyQuestion(message) {
    const text = normalizeText(message);
    if (!/(怎么用|如何用|是什么|介绍|说明|解释|为啥|为什么|原因|怎么填|怎么配置)/u.test(text)) return false;
    return /(命名模板|命名规则|作业要求|允许后缀|后缀|预检|适用班级|查重|免交|学生库|评分|公告|AI规则|模型配置|管理员账号|审计日志|提交历史|在线预览|部署|截止时间)/u.test(text);
}

function extractQuotedValue(message) {
    const text = normalizeText(message);
    const quoted = text.match(/[“"']([^“”"']{1,5000})[”"']/u);
    return quoted ? normalizeText(quoted[1]) : "";
}

function extractAfterKeyword(message, keywords) {
    const text = normalizeText(message);
    for (const keyword of keywords) {
        const idx = text.indexOf(keyword);
        if (idx >= 0) {
            const value = text.slice(idx + keyword.length).replace(/^[：:\s]+/u, "").trim();
            if (value) return value;
        }
    }
    return "";
}

function pickSubjectName(message, stats = [], explicit = "") {
    const value = normalizeText(explicit);
    if (/^(全部|所有|全体|整体|总览|全部作业|所有作业|all)$/iu.test(value)) return "";
    if (value) return value;
    const text = normalizeText(message);
    if (/(全部|所有|全体|整体|总览|每个|各个).*(作业|科目|课程)?(提交情况|提交进度|提交率|未交|缺交)/u.test(text)
        || /(查询|查看|列出).*(全部|所有|全体|整体|每个|各个).*(作业|科目|课程).*(提交情况|提交进度|提交率|未交|缺交)?/u.test(text)) {
        return "";
    }
    const hit = pickSubjectFromMessage(message, stats);
    if (hit?.name) return hit.name;
    const patterns = [
        /(?:科目|作业|课程|subject)\s*[：: ]\s*([^，,。；;\s]{1,100})/iu,
        /(?:把|给|为|删除|新增|创建|查询|查看|设置|修改)\s*([^，,。；;\s]{1,100})\s*(?:这个)?(?:科目|作业|课程)/u
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return normalizeText(match[1]);
    }
    return "";
}

function parseListValue(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
    return String(value || "")
        .split(/[，,、\s]+/u)
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseDeadlineFromMessage(message) {
    const text = normalizeText(message);
    if (/(清除|取消|移除|不设置).*(截止|deadline)/iu.test(text)) return "";
    const match = text.match(/\d{4}-\d{1,2}-\d{1,2}(?:[ T]\d{1,2}:\d{1,2})?/u)
        || text.match(/\d{4}\/\d{1,2}\/\d{1,2}(?:[ T]\d{1,2}:\d{1,2})?/u);
    if (!match) return "";
    return match[0].replace(/\//g, "-").replace(" ", "T");
}

function normalizePlagiarismMode(value) {
    const text = String(value || "").trim().toLowerCase();
    if (["strict", "严格"].includes(text)) return "strict";
    if (["off", "关闭", "不查", "none"].includes(text)) return "off";
    if (["manual", "手动"].includes(text)) return "manual";
    return "normal";
}

async function findFileKey(env, subject, hint) {
    const prefix = `${subject}/`;
    const files = (await listAllByPrefix(env.R2_BUCKET, prefix)).filter((obj) => !obj.key.endsWith("/.keep"));
    const query = normalizeText(hint);
    if (!query) return files[0]?.key || "";
    if (isSafeObjectKey(query)) return query;
    const lower = query.toLowerCase();
    return files.find((obj) => String(obj.key || "").toLowerCase().includes(lower))?.key || "";
}

async function parseAdminCommandWithAi(env, message, stats) {
    if (isKnowledgeOnlyQuestion(message)) return null;
    if (/(学生|同学|人员|名单|班级|删除|新增|重置|密码|评分|截止|命名|后缀|文件|查重|公告|模型|管理员|科目|作业)/u.test(message) === false) {
        return null;
    }
    const settings = await getModelSettings(env);
    const model = String(settings.lightModel || settings.heavyModel || env.AI_LIGHT_MODEL || env.AI_MODEL || "gpt-4o-mini").trim();
    const subjectNames = stats.map((item) => item.name).slice(0, 80);
    const skillCatalog = ADMIN_SKILLS.map((item) => `${item.skill}: ${item.description}; params=${item.params.join(",") || "none"}`).join("\n");
    const prompt = `你要把管理员中文指令解析成后台 skill 调用 JSON。只输出 JSON，不要解释。
输出格式：{"skill":"student.list","params":{"className":"02"}}
如果不是后台操作，或信息不足到无法判断技能，输出 {}。
只允许使用以下 skill：
${skillCatalog}
当前科目：${subjectNames.join("、") || "暂无"}
用户指令：${message}`;
    const raw = await callOpenAI(env, {
        model,
        modelSettings: settings,
        temperature: 0,
        maxTokens: 700,
        systemPrompt: "你是后台 skill 路由器。必须输出严格 JSON。不得直接执行操作，不得输出自然语言。普通聊天输出 {}。",
        userPrompt: prompt
    }).catch(() => "");
    const parsed = parseJsonObject(raw);
    if (!parsed) return null;
    const op = skillToOperation(parsed);
    if (!op) return null;
    if (op.action === "help" && !isExplicitHelpQuestion(message)) return null;
    return op;
}

async function parseAdminAssistantOperation(env, message, stats, assistantContext = {}) {
    const text = normalizeText(message);
    if (assistantContext?.pendingAction) {
        const pendingAction = normalizeAdminAction(assistantContext.pendingAction);
        const pendingSkill = String(assistantContext.pendingSkill || ADMIN_ACTION_TO_SKILL[pendingAction] || "").trim();
        if (pendingAction === "delete_students_by_class") {
            const className = await findClassNameInMessage(env, text);
            if (className) {
                return {
                    action: "delete_students_by_class",
                    className,
                    skill: pendingSkill
                };
            }
        }
        if (pendingAction === "delete_student" || pendingAction === "reset_student_password") {
            const payload = parseStudentPayload(text);
            const name = payload.name || parseBareStudentName(text);
            if (name) {
                return {
                    action: pendingAction,
                    name,
                    className: payload.className || assistantContext.className || "",
                    target: assistantContext.target || "",
                    skill: pendingSkill
                };
            }
        }
        if (pendingAction === "set_exemption") {
            const payload = parseStudentPayload(text);
            const name = payload.name || parseBareStudentName(text);
            if (name) {
                return {
                    action: "set_exemption",
                    subject: assistantContext.subject || "",
                    name,
                    enabled: assistantContext.enabled !== false,
                    skill: pendingSkill
                };
            }
        }
    }
    if (assistantContext?.lastAction === "query_students" && looksLikeClassFollowUp(text)) {
        return { action: "query_students", className: await findClassNameInMessage(env, text), skill: "student.list" };
    }
    if (assistantContext?.lastAction === "query_students"
        && /(删除|移除|删掉|减少).*(这个|该|同学|学生)?/u.test(text)) {
        const payload = parseStudentPayload(text);
        return {
            action: "delete_student",
            skill: "student.delete",
            name: payload.name,
            className: payload.className || assistantContext.lastClassName || ""
        };
    }
    const entry = findAdminEntry(text);
    if (entry) return { action: "navigate", skill: "page.open", target: entry.view };
    if (isKnowledgeOnlyQuestion(text)) return null;
    if (isExplicitHelpQuestion(text)) return { action: "help", skill: "help.show" };
    if (/(学生库|学生|同学|人员|名单|花名册|班级)/u.test(text)
        && /(查询|查看|列出|名单|有哪些|所有|人员|学生|同学)/u.test(text)
        && !/(新增|添加|加入|删除|移除|减少|重置|密码|字段|列)/u.test(text)) {
        return { action: "query_students", skill: "student.list", className: await findClassNameInMessage(env, text) };
    }
    if (/(删除|移除|清空|删掉).*(班).*(所有|全部|全体).*(学生|同学|人员)/u.test(text)
        || /(删除|移除|清空|删掉).*(所有|全部|全体).*(学生|同学|人员).*(班)/u.test(text)) {
        return { action: "delete_students_by_class", skill: "student.delete_by_class", className: await findClassNameInMessage(env, text) };
    }
    if (/(提交情况|提交进度|交了|未交|缺交|查询.*作业|作业.*查询|提交率)/u.test(text)) {
        return { action: "query_submission", skill: "submission.query", subject: pickSubjectName(text, stats) };
    }
    if (/(新增|创建|添加).*(科目|作业|课程)/u.test(text)) {
        return { action: "create_subject", subject: pickSubjectName(text, stats) || extractAfterKeyword(text, ["新增科目", "创建科目", "新增作业", "创建作业"]) };
    }
    if (/(删除|移除).*(科目|作业|课程)/u.test(text)) {
        return { action: "delete_subject", subject: pickSubjectName(text, stats) };
    }
    if (/(截止|deadline)/iu.test(text) && /(设置|修改|清除|取消|移除|不设置)/u.test(text)) {
        return { action: "set_deadline", subject: pickSubjectName(text, stats), deadline: parseDeadlineFromMessage(text) };
    }
    if (/(命名模板|命名规则)/u.test(text) && /(设置|修改|改成|换成|清除|取消)/u.test(text)) {
        return { action: "set_naming_rule", subject: pickSubjectName(text, stats), template: extractQuotedValue(text) || extractAfterKeyword(text, ["改成", "换成", "设置为", "模板为", "规则为"]) };
    }
    if (/(允许后缀|文件后缀|文件类型|查重模式|适用班级|指定班级|开放.*后缀)/u.test(text)) {
        const subject = pickSubjectName(text, stats);
        const extMatch = text.match(/(?:后缀|文件类型)\s*[：: ]\s*([A-Za-z0-9.,，、\s]+)$/u);
        const classMatch = text.match(/(?:班级|适用班级|指定班级)\s*[：: ]\s*([\u4e00-\u9fffA-Za-z0-9,，、\s_-]+)$/u);
        const modeMatch = text.match(/(?:查重模式)\s*[：: ]\s*([\u4e00-\u9fffA-Za-z0-9_-]+)/u);
        return {
            action: "set_subject_settings",
            subject,
            allowedExtensions: extMatch ? parseListValue(extMatch[1]) : undefined,
            classNames: classMatch ? parseListValue(classMatch[1]) : undefined,
            plagiarismMode: modeMatch ? normalizePlagiarismMode(modeMatch[1]) : undefined
        };
    }
    if (/(新增|添加|加入).*(学生|同学)|^(新增|添加|加入)\s*[\u4e00-\u9fffA-Za-z0-9_-]+/u.test(text)) {
        return { action: "add_student", ...parseStudentPayload(text) };
    }
    if (/(删除|移除|减少|删掉)/u.test(text) && /(学生|同学|这个|该|名单|班)/u.test(text)
        || /^(删除|移除|减少|删掉)\s*[\u4e00-\u9fffA-Za-z0-9_-]+/u.test(text)) {
        return { action: "delete_student", ...parseStudentPayload(text) };
    }
    if (/(重置).*(学生|同学).*(密码)|学生.*密码.*重置/u.test(text)) {
        const payload = parseStudentPayload(text);
        return { action: "reset_student_password", name: payload.name, target: /默认|123456/u.test(text) ? "default" : "random" };
    }
    if (/(免交|放行|豁免)/u.test(text)) {
        const payload = parseStudentPayload(text);
        return { action: "set_exemption", subject: pickSubjectName(text, stats), name: payload.name, enabled: !/(取消|移除|删除)/u.test(text) };
    }
    if (/(评分|打分|分数|评语)/u.test(text) && /(设置|保存|给|改)/u.test(text)) {
        const payload = parseStudentPayload(text);
        const scoreMatch = text.match(/(?:分数|得分|评分)\s*[：: ]?\s*([0-9.]+)/u) || text.match(/([0-9.]+)\s*分/u);
        const commentMatch = text.match(/(?:评语|意见)\s*[：: ]\s*(.+)$/u);
        return { action: "save_grade", subject: pickSubjectName(text, stats), name: payload.name, score: scoreMatch?.[1] || "", comment: commentMatch?.[1] || "" };
    }
    if (/(作业要求|提交要求|要求)/u.test(text) && /(设置|修改|改成|清除|保存)/u.test(text)) {
        return { action: "set_assignment_requirement", subject: pickSubjectName(text, stats), requirement: extractQuotedValue(text) || extractAfterKeyword(text, ["要求为", "改成", "设置为"]) };
    }
    if (/(公告)/u.test(text) && /(设置|修改|发布|更新)/u.test(text)) {
        return { action: "update_notice", title: extractAfterKeyword(text, ["标题为", "标题：", "标题:"]), content: extractQuotedValue(text) || extractAfterKeyword(text, ["内容为", "内容：", "内容:"]) };
    }
    if (/(ai规则|AI规则|全局规则|faq|示例)/u.test(text) && /(设置|修改|保存|更新)/u.test(text)) {
        return { action: "set_ai_rules", subject: pickSubjectName(text, stats), requirement: extractQuotedValue(text) || extractAfterKeyword(text, ["规则为", "要求为", "设置为"]) };
    }
    if (/(模型|api key|key|base url|timeout|超时)/iu.test(text) && /(设置|修改|保存|更新|改成)/u.test(text)) {
        return { action: "set_model_settings" };
    }
    if (/(新增|添加|创建).*(管理员|后台账号)/u.test(text)) {
        const userMatch = text.match(/(?:账号|用户名|管理员)\s*[：: ]\s*([A-Za-z0-9_-]{2,40})/u);
        const pwdMatch = text.match(/(?:密码|默认密码)\s*[：: ]\s*(\S{6,80})/u);
        return { action: "create_admin", username: userMatch?.[1] || "", password: pwdMatch?.[1] || "" };
    }
    if (/(重置).*(管理员|后台账号).*(密码)/u.test(text)) {
        const userMatch = text.match(/(?:账号|用户名|管理员)\s*[：: ]\s*([A-Za-z0-9_-]{2,40})/u);
        const pwdMatch = text.match(/(?:密码|新密码|临时密码)\s*[：: ]\s*(\S{6,80})/u);
        return { action: "reset_admin_password", username: userMatch?.[1] || "", password: pwdMatch?.[1] || "" };
    }
    if (/(修改|更改|设置).*(我的|当前)?.*(管理员)?密码/u.test(text)) {
        return {
            action: "change_admin_password",
            oldPassword: extractAfterKeyword(text, ["旧密码", "当前密码", "原密码"]),
            newPassword: extractAfterKeyword(text, ["新密码", "改成", "设置为"])
        };
    }
    if (/(学生库|学生).*(字段|列)/u.test(text) && /(设置|修改|改成|应用)/u.test(text)) {
        return { action: "set_student_columns", columns: parseListValue(extractAfterKeyword(text, ["字段为", "列为", "改成", "设置为"])) };
    }
    if (/(查重)/u.test(text) && /(运行|检查|检测)/u.test(text)) {
        return { action: "run_plagiarism", subject: pickSubjectName(text, stats), key: extractAfterKeyword(text, ["文件", "key", "路径"]) };
    }
    if (/(列出|查看).*(文件|提交文件|提交列表)/u.test(text)) return { action: "list_files", subject: pickSubjectName(text, stats) };
    if (/(删除|移除).*(文件|提交文件)/u.test(text)) return { action: "delete_file", subject: pickSubjectName(text, stats), key: extractAfterKeyword(text, ["文件", "key", "路径"]) };

    return await parseAdminCommandWithAi(env, message, stats);
}

function assertSubject(subject) {
    const value = normalizeText(subject);
    if (!value || !isSafeTopLevelName(value) || isSystemSubject(value)) throw new Error("请提供有效的科目/作业名称。");
    return value;
}

function subjectStatsReply(item) {
    const pct = item.expected > 0 ? Math.round((item.submitted / item.expected) * 100) : 0;
    const classes = Array.isArray(item.classNames) && item.classNames.length ? `，适用班级：${item.classNames.join("、")}` : "";
    const missing = item.missing > 0 ? `，未交 ${item.missing} 人：${item.missingNames.slice(0, 20).join("、")}${item.missingNames.length > 20 ? " 等" : ""}` : "，没有未交";
    return `「${item.name}」已交 ${item.submitted} / 应交 ${item.expected}，提交率 ${pct}%${classes}${missing}。`;
}

async function executeAdminAssistantOperation(env, auth, op, stats) {
    const action = normalizeAdminAction(op?.action);
    if (!action || action === "help") {
        const helpText = [
            "查提交、查未交、列出或删除提交文件、打包下载、运行查重",
            "新增/删除科目，设置截止时间、命名模板、作业要求、允许后缀、适用班级、免交学生",
            "查询学生库、按班级列名单、新增/删除学生、批量删除班级学生、重置学生密码、调整学生字段",
            "保存评分和评语，维护公告、全局 AI 规则、模型配置、管理员账号，查看审计日志",
            "也可以问入口位置，我会直接跳到对应后台页面"
        ].join("；");
        return {
            success: true,
            reply: `我现在可以操作这些后台功能：${helpText}。涉及删除、改密码、改配置这类操作，会直接走后台权限校验并写入审计日志。`
        };
    }

    if (action === "navigate") {
        const entry = ADMIN_ENTRY_MAP.find((item) => item.view === op.target) || ADMIN_ENTRY_MAP.find((item) => item.view === op.view);
        return {
            success: true,
            reply: entry ? `入口在左侧菜单的「${entry.label}」。我已经帮你打开。` : "我已经帮你切到对应入口。",
            navigate: entry?.view || op.target || op.view || "dashboard"
        };
    }

    if (action === "query_submission") {
        const subject = pickSubjectName("", stats, op.subject);
        if (!subject) {
            const totalExpected = stats.reduce((sum, item) => sum + Number(item.expected || 0), 0);
            const totalSubmitted = stats.reduce((sum, item) => sum + Number(item.submitted || 0), 0);
            const pct = totalExpected > 0 ? Math.round((totalSubmitted / totalExpected) * 100) : 0;
            const lines = stats.slice(0, 8).map(subjectStatsReply);
            return { success: true, reply: `全部作业总提交率 ${pct}%：已交 ${totalSubmitted} / 应交 ${totalExpected}。\n${lines.join("\n") || "暂无作业。"}`, navigate: "dashboard", context: operationToContext(op) };
        }
        const item = stats.find((it) => it.name === subject);
        if (!item) return { success: true, reply: `没找到「${subject}」这个作业。`, navigate: "dashboard", context: operationToContext(op, { lastSubject: subject }) };
        return { success: true, reply: subjectStatsReply(item), navigate: "dashboard", context: operationToContext(op, { lastSubject: subject }) };
    }

    if (action === "query_students") {
        const rows = await listStudents(env);
        const requestedClass = normalizeText(op.className);
        const className = await resolveClassName(env, requestedClass);
        const filtered = className
            ? rows.filter((row) => normalizeClassAlias(studentClassOf(row)) === normalizeClassAlias(className))
            : rows;
        const names = filtered.map((row) => normalizeText(row.name)).filter(Boolean);
        const title = className ? `${className} 班` : "学生库";
        if (names.length === 0) {
            const classes = await listStudentClasses(env);
            return {
                success: true,
                reply: `没有查到「${title}」的学生。当前学生库班级：${classes.join("、") || "暂无班级"}。`,
                navigate: "students",
                context: operationToContext(op, { lastClassName: className || "" })
            };
        }
        const lines = filtered.slice(0, 80).map((row, index) => {
            const studentId = normalizeText(row.studentId || row.id || row.ID || row.学号);
            const classText = studentClassOf(row);
            return `${index + 1}. ${row.name}${studentId ? `（${studentId}）` : ""}${!className && classText ? ` - ${classText}` : ""}`;
        });
        return {
            success: true,
            reply: `${title}共 ${names.length} 人：\n${lines.join("\n")}${filtered.length > 80 ? "\n..." : ""}`,
            navigate: "students",
            context: operationToContext(op, { lastClassName: className || "" })
        };
    }

    if (action === "create_subject") {
        const subject = assertSubject(op.subject);
        await env.R2_BUCKET.put(`${subject}/.keep`, "");
        await setSubjectCreatedBy(env.R2_BUCKET, subject, auth.username);
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "assistant_create_subject", target: subject });
        return { success: true, reply: `已创建科目「${subject}」。`, navigate: "dashboard", refresh: ["dashboard"] };
    }

    if (action === "delete_subject") {
        const subject = assertSubject(op.subject);
        const objects = await listAllByPrefix(env.R2_BUCKET, `${subject}/`);
        await Promise.all(objects.map((obj) => env.R2_BUCKET.delete(obj.key)));
        const deadlines = await readDeadlines(env.R2_BUCKET);
        if (deadlines[subject]) {
            delete deadlines[subject];
            await writeDeadlines(env.R2_BUCKET, deadlines);
        }
        await deleteAssignmentRequirement(env.R2_BUCKET, subject);
        await deleteSubjectMeta(env.R2_BUCKET, subject);
        await deleteSubjectSettings(env.R2_BUCKET, subject);
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "delete_subject", target: subject, count: objects.length });
        return { success: true, reply: `已删除科目「${subject}」以及 ${objects.length} 个文件对象。`, navigate: "dashboard", refresh: ["dashboard"] };
    }

    if (action === "set_deadline") {
        const subject = assertSubject(op.subject);
        const deadline = normalizeText(op.deadline);
        if (deadline && Number.isNaN(Date.parse(deadline))) throw new Error("截止时间格式不正确，请使用 2026-05-02T23:59 这样的格式。");
        const deadlines = await readDeadlines(env.R2_BUCKET);
        if (!deadline) delete deadlines[subject];
        else deadlines[subject] = deadline;
        await writeDeadlines(env.R2_BUCKET, deadlines);
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "set_deadline", target: `${subject}:${deadline || "clear"}` });
        return { success: true, reply: deadline ? `已把「${subject}」截止时间设置为 ${deadline}。` : `已清除「${subject}」截止时间。`, navigate: "dashboard", refresh: ["dashboard"] };
    }

    if (action === "update_notice") {
        const currentObj = await env.R2_BUCKET.get("notice.json");
        const current = currentObj ? parseJsonObject(await currentObj.text()) || {} : {};
        const title = normalizeText(op.title || current.title);
        const content = normalizeText(op.content || current.content);
        const publishAt = normalizeText(op.publishAt || current.publishAt);
        const expireAt = normalizeText(op.expireAt || current.expireAt);
        if (!title || !content) throw new Error("公告标题和内容不能为空。");
        if (title.length > 120 || content.length > 5000) throw new Error("公告内容过长。");
        if (!isValidOptionalDateTime(publishAt) || !isValidOptionalDateTime(expireAt)) throw new Error("公告时间格式不正确。");
        await env.R2_BUCKET.put("notice.json", JSON.stringify({ title, content, publishAt, expireAt }), { httpMetadata: { contentType: "application/json" } });
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "update_notice", target: title });
        return { success: true, reply: `公告已更新：「${title}」。`, navigate: "notice" };
    }

    if (action === "set_ai_rules") {
        const subject = normalizeText(op.subject);
        if (subject && (!isSafeTopLevelName(subject) || isSystemSubject(subject))) throw new Error("科目名称不合法。");
        const current = await getMergedAiRule(env.R2_BUCKET, subject);
        const requirements = normalizeText(op.requirements || op.requirement || op.instruction || current.requirements);
        const faq = normalizeText(op.faq || current.faq);
        const examples = normalizeText(op.examples || current.examples);
        const store = await setAiRule(env.R2_BUCKET, subject, { requirements, faq, examples });
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "set_ai_rules", target: subject || "_global" });
        return { success: true, reply: subject ? `已更新「${subject}」的 AI 规则。` : "已更新全局 AI 规则。", navigate: "ai-rules", store };
    }

    if (action === "set_model_settings") {
        if (!isOwnerAdmin(auth.username)) throw new Error("只有 admin 主账号可以配置模型。");
        const current = await getModelSettings(env);
        const settings = await setModelSettings(env.R2_BUCKET, {
            aiBaseUrl: op.aiBaseUrl ?? current.aiBaseUrl,
            apiKey: op.apiKey ?? current.apiKey,
            lightModel: op.lightModel ?? current.lightModel,
            heavyModel: op.heavyModel ?? current.heavyModel,
            embeddingModel: op.embeddingModel ?? current.embeddingModel,
            timeoutMs: op.timeoutMs ?? current.timeoutMs
        });
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "set_model_settings", target: settings.lightModel || settings.heavyModel || "model-settings" });
        return { success: true, reply: "模型配置已更新。API Key 不会在回复中显示。", navigate: "model-settings" };
    }

    if (action === "create_admin") {
        if (!isOwnerAdmin(auth.username)) throw new Error("只有 admin 主账号可以新增管理员。");
        const username = normalizeText(op.username);
        const password = normalizeText(op.password);
        const user = await createAdminUser(env, username, password, auth.username);
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "create_admin_user", target: user.username });
        return { success: true, reply: `已新增管理员「${user.username}」。请线下通知默认密码。`, navigate: "admin-accounts" };
    }

    if (action === "change_admin_password") {
        const oldPassword = normalizeText(op.oldPassword);
        const newPassword = normalizeText(op.newPassword || op.password);
        const user = await changeAdminPassword(env, auth.username, oldPassword, newPassword);
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "change_admin_password", target: auth.username });
        return { success: true, reply: `已修改当前管理员「${user.username || auth.username}」的密码。`, navigate: "admin-accounts" };
    }

    if (action === "reset_admin_password") {
        if (!isOwnerAdmin(auth.username)) throw new Error("只有 admin 主账号可以重置管理员密码。");
        const username = normalizeText(op.username || op.name);
        const password = normalizeText(op.password || op.newPassword);
        const user = await resetAdminPassword(env, username, password, auth.username);
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "reset_admin_password", target: user.username });
        return { success: true, reply: `已重置管理员「${user.username}」的密码。请线下通知临时密码。`, navigate: "admin-accounts" };
    }

    if (action === "add_student" || action === "delete_student" || action === "delete_students_by_class" || action === "set_student_columns") {
        if (!isD1Ready(env)) throw new Error("D1 未配置，无法修改学生库。");
        const columns = action === "set_student_columns" ? parseListValue(op.columns || op.target) : await listStudentColumns(env);
        const rows = await listStudents(env);
        if (action === "set_student_columns") {
            const saved = await replaceStudentsBulk(env, rows, columns);
            await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "save_students_bulk", target: "students", count: saved.students.length });
            return { success: true, reply: `学生库字段已更新为：${saved.columns.join(", ")}。`, navigate: "students", refresh: ["students", "dashboard"] };
        }
        if (action === "delete_students_by_class") {
            const className = await resolveClassName(env, op.className);
            if (!className) {
                return {
                    success: true,
                    reply: "请提供要清空的班级，例如：删除 03 班所有学生。",
                    navigate: "students",
                    context: pendingContext("delete_students_by_class", "className")
                };
            }
            const targetAlias = normalizeClassAlias(className);
            const removedRows = rows.filter((row) => normalizeClassAlias(studentClassOf(row)) === targetAlias);
            if (removedRows.length === 0) {
                const classes = await listStudentClasses(env);
                return {
                    success: true,
                    reply: `没有查到「${className} 班」的学生。当前学生库班级：${classes.join("、") || "暂无班级"}。`,
                    navigate: "students",
                    context: operationToContext(op, { lastClassName: className })
                };
            }
            const nextRows = rows.filter((row) => normalizeClassAlias(studentClassOf(row)) !== targetAlias);
            const saved = await replaceStudentsBulk(env, nextRows, columns);
            await appendAuditLog(env.R2_BUCKET, {
                actorType: "admin",
                actor: auth.username,
                action: "assistant_remove_class_students",
                target: className,
                count: removedRows.length
            });
            return {
                success: true,
                reply: `已删除 ${className} 班 ${removedRows.length} 名学生：${removedRows.map((row) => row.name).filter(Boolean).join("、")}。`,
                navigate: "students",
                refresh: ["students", "dashboard"],
                context: operationToContext(op, { lastClassName: className })
            };
        }
        const name = normalizeText(op.name);
        if (!name) {
            return {
                success: true,
                reply: action === "add_student" ? "请提供要新增的学生姓名。" : "请提供要删除的学生姓名。",
                navigate: "students",
                context: pendingContext(action, "name", { className: op.className || "" })
            };
        }
        if (action === "add_student") {
            if (rows.some((row) => String(row.name || "").trim() === name)) return { success: true, reply: `学生「${name}」已经存在。`, navigate: "students" };
            const next = {};
            columns.forEach((col) => { next[col] = ""; });
            next.name = name;
            if (columns.includes("studentId")) next.studentId = normalizeText(op.studentId);
            else if (columns.includes("id")) next.id = normalizeText(op.studentId);
            if (columns.includes("className")) next.className = normalizeText(op.className);
            else if (columns.includes("classname")) next.classname = normalizeText(op.className);
            else if (columns.includes("class")) next.class = normalizeText(op.className);
            const saved = await replaceStudentsBulk(env, [...rows, next], columns);
            await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "assistant_add_student", target: name, count: saved.students.length });
            return { success: true, reply: `已添加学生「${name}」。`, navigate: "students", refresh: ["students", "dashboard"], context: { lastAction: "add_student", lastStudentName: name } };
        }
        const nextRows = rows.filter((row) => String(row.name || "").trim() !== name);
        if (nextRows.length === rows.length) return { success: true, reply: `学生库里没有找到「${name}」。`, navigate: "students" };
        const saved = await replaceStudentsBulk(env, nextRows, columns);
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "assistant_remove_student", target: name, count: saved.students.length });
        return { success: true, reply: `已删除学生「${name}」。`, navigate: "students", refresh: ["students", "dashboard"], context: { lastAction: "delete_student", lastStudentName: name } };
    }

    if (action === "reset_student_password") {
        if (!isD1Ready(env)) throw new Error("D1 未配置，无法重置密码。");
        const name = normalizeText(op.name);
        if (!name) {
            return {
                success: true,
                reply: "请提供要重置密码的学生姓名。",
                navigate: "students",
                context: pendingContext("reset_student_password", "name", { target: op.target || op.mode || "random" })
            };
        }
        const student = await getStudentByName(env, name);
        if (!student?.name) throw new Error("学生不存在或未启用。");
        const mode = String(op.target || op.mode || "random").toLowerCase() === "default" ? "default" : "random";
        const nextPassword = mode === "default" ? DEFAULT_RESET_PASSWORD : generateTempPassword(10);
        const nextHash = await hashStudentPassword(nextPassword);
        await env.DB.prepare(`
INSERT INTO student_auth (name, password_hash, must_change_password, updated_at)
VALUES (?1, ?2, 1, CURRENT_TIMESTAMP)
ON CONFLICT(name) DO UPDATE SET
  password_hash = excluded.password_hash,
  must_change_password = excluded.must_change_password,
  updated_at = CURRENT_TIMESTAMP
`).bind(student.name, nextHash).run();
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "reset_student_password", target: student.name, mode });
        return { success: true, reply: `已重置学生「${student.name}」密码，临时密码：${nextPassword}`, navigate: "students" };
    }

    if (action === "set_naming_rule") {
        const subject = assertSubject(op.subject);
        const result = await setNamingRule(env, subject, normalizeText(op.template));
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "set_naming_rule", target: `${subject}:${result.template ? "set" : "clear"}` });
        return { success: true, reply: result.template ? `已把「${subject}」命名模板设为：${result.template}` : `已清除「${subject}」命名模板。`, navigate: "dashboard" };
    }

    if (action === "set_assignment_requirement") {
        const subject = assertSubject(op.subject);
        const content = normalizeText(op.content || op.requirement);
        if (content.length > 20000) throw new Error("作业要求过长。");
        await setAssignmentRequirement(env.R2_BUCKET, subject, content);
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "set_assignment_requirement", target: `${subject}:${content ? "set" : "clear"}` });
        return { success: true, reply: content ? `已更新「${subject}」作业要求。` : `已清空「${subject}」作业要求。`, navigate: "dashboard" };
    }

    if (action === "set_subject_settings") {
        const subject = assertSubject(op.subject);
        const current = await getSubjectSettings(env.R2_BUCKET, subject, env);
        const settings = await setSubjectSettings(env.R2_BUCKET, subject, {
            allowedExtensions: op.allowedExtensions === undefined ? current.allowedExtensions : op.allowedExtensions,
            plagiarismMode: op.plagiarismMode === undefined ? current.plagiarismMode : op.plagiarismMode,
            classNames: op.classNames === undefined ? current.classNames : op.classNames
        });
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "set_subject_settings", target: subject });
        return { success: true, reply: `已更新「${subject}」作业设置：后缀 ${settings.allowedExtensions.join("、") || "默认"}，查重 ${settings.plagiarismMode}，班级 ${settings.classNames.join("、") || "全部"}。`, navigate: "dashboard", refresh: ["dashboard"] };
    }

    if (action === "set_exemption") {
        const subject = assertSubject(op.subject);
        const name = normalizeText(op.name);
        if (!name) throw new Error("请提供学生姓名。");
        const enabled = op.enabled !== false;
        const exemptions = await setExemption(env.R2_BUCKET, subject, name, enabled);
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: enabled ? "set_exemption" : "remove_exemption", target: `${subject}/${name}` });
        return { success: true, reply: enabled ? `已将「${name}」加入「${subject}」免交名单。` : `已从「${subject}」免交名单移除「${name}」。`, navigate: "dashboard", exemptions };
    }

    if (action === "save_grade") {
        const subject = assertSubject(op.subject);
        const name = normalizeText(op.name);
        if (!name) throw new Error("请提供学生姓名。");
        const item = { name, score: normalizeText(op.score), comment: normalizeText(op.comment) };
        const grades = await upsertGradesBySubject(env.R2_BUCKET, subject, [item], auth.username);
        await applyGradeToHistoryBySubject(env.R2_BUCKET, subject, name, grades[name]);
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "save_grades", target: subject, count: 1 });
        return { success: true, reply: `已保存「${subject} / ${name}」的评分。`, navigate: "dashboard" };
    }

    if (action === "list_files") {
        const subject = assertSubject(op.subject);
        const files = (await listAllByPrefix(env.R2_BUCKET, `${subject}/`)).filter((obj) => !obj.key.endsWith("/.keep"));
        const lines = files.slice(0, 20).map((obj) => obj.key).join("\n");
        return { success: true, reply: files.length ? `「${subject}」共有 ${files.length} 个提交文件：\n${lines}${files.length > 20 ? "\n..." : ""}` : `「${subject}」暂无提交文件。`, navigate: "dashboard" };
    }

    if (action === "run_plagiarism" || action === "delete_file") {
        const subject = assertSubject(op.subject);
        const key = await findFileKey(env, subject, op.key || op.target);
        if (!key) throw new Error("没有找到匹配的文件，请提供更完整的文件路径。");
        if (action === "delete_file") {
            if (!isSafeObjectKey(key) || key.startsWith("_system/")) throw new Error("文件路径不合法。");
            await env.R2_BUCKET.delete(key);
            await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "delete_file", target: key });
            return { success: true, reply: `已删除文件：${key}`, navigate: "dashboard", refresh: ["dashboard"] };
        }
        const settings = await getSubjectSettings(env.R2_BUCKET, subject, env);
        const modelSettings = await getModelSettings(env);
        const result = await runPlagiarismCheck(env.R2_BUCKET, subject, key, { mode: op.mode || settings.plagiarismMode || "normal", env, modelSettings });
        await appendAuditLog(env.R2_BUCKET, { actorType: "admin", actor: auth.username, action: "run_plagiarism_check", target: key, count: result.matches.length });
        return { success: true, reply: `已完成查重：${key}，发现 ${result.matches.length} 条相似项。`, navigate: "dashboard" };
    }

    return { success: true, reply: "我还没识别出这个操作。你可以说“帮助”查看我能操作的功能。" };
}

async function replyWithAdminAi(env, message, contextText) {
    const settings = await getModelSettings(env);
    const model = String(settings.lightModel || settings.heavyModel || env.AI_LIGHT_MODEL || env.AI_MODEL || "gpt-4o-mini").trim();
    const knowledgeItems = searchAdminKnowledge(message, 6);
    const knowledgeText = formatKnowledgeForPrompt(knowledgeItems);
    const answer = await callOpenAI(env, {
        model,
        modelSettings: settings,
        temperature: 0.2,
        maxTokens: 700,
        systemPrompt: [
            "你是后台右侧 AI 助手。",
            "回答后台功能问题时，优先依据给定知识库和当前后台数据，不要编造不存在的入口、字段或规则。",
            "如果用户要执行增删改查，尽量给出可直接输入的自然语言指令；如果系统已能直接执行，前置规则会先处理。",
            "用户问普通知识或闲聊时正常回答；中文简洁回答。"
        ].join(""),
        userPrompt: `后台能力：${ADMIN_CAPABILITIES.join("；")}\n\n相关后台知识库：\n${knowledgeText || "未检索到强相关条目。"}\n\n当前后台数据：\n${contextText}\n\n用户问题：${message}`
    }).catch(() => "");
    if (answer) return answer;
    if (knowledgeItems.length) return summarizeAdminKnowledge(knowledgeItems.slice(0, 3));
    return "这个问题需要模型生成回答，但当前模型没有返回结果。后台数据查询类问题可以直接问我，比如“1班人员名单”“查询 test 提交情况”。";
}

export async function onRequest(context) {
    const { request, env } = context;
    const method = request.method;
    const url = new URL(request.url);

    const auth = await verifyAdminRequest(request, env);
    if (!auth.ok) return json({ error: "Unauthorized" }, 401);

    if (method === "GET") {
        const action = String(url.searchParams.get("action") || "");

        if (action === "files") {
            const folder = String(url.searchParams.get("folder") || "");
            if (!isSafeTopLevelName(folder) || isSystemSubject(folder)) return json({ error: "Invalid folder" }, 400);

            const files = await listAllByPrefix(env.R2_BUCKET, `${folder}/`);
            const visible = files
                .filter((obj) => !obj.key.endsWith(".keep"))
                .map((obj) => ({ key: obj.key, size: obj.size, time: obj.uploaded }));
            const plagiarismResults = await readPlagiarismResults(env.R2_BUCKET);
            return json({
                files: visible.map((file) => ({
                    ...file,
                    plagiarism: plagiarismResults[file.key] || null
                }))
            });
        }

        if (action === "download") {
            const key = String(url.searchParams.get("key") || "");
            if (!isSafeObjectKey(key) || key.startsWith("_system/")) return json({ error: "Invalid key" }, 400);

            const object = await env.R2_BUCKET.get(key);
            if (!object) return new Response("Not Found", { status: 404 });

            const headers = new Headers();
            object.writeHttpMetadata(headers);
            headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(key.split("/").pop())}"`);
            headers.set("Cache-Control", "no-store");
            return new Response(object.body, { headers });
        }

        if (action === "preview") {
            const key = String(url.searchParams.get("key") || "");
            if (!isSafeObjectKey(key) || key.startsWith("_system/")) return json({ error: "Invalid key" }, 400);

            const object = await env.R2_BUCKET.get(key);
            if (!object) return new Response("Not Found", { status: 404 });

            const headers = new Headers();
            object.writeHttpMetadata(headers);
            headers.set("Content-Disposition", `inline; filename="${encodeURIComponent(key.split("/").pop())}"`);
            headers.set("Cache-Control", "no-store");
            return new Response(object.body, { headers });
        }

        if (action === "deadlines") {
            const deadlines = await readDeadlines(env.R2_BUCKET);
            return json({ deadlines });
        }

        if (action === "noticeRaw") {
            const obj = await env.R2_BUCKET.get("notice.json");
            if (!obj) return json({ title: "", content: "", publishAt: "", expireAt: "" });
            try {
                const data = JSON.parse(await obj.text());
                return json({
                    title: String(data.title || ""),
                    content: String(data.content || ""),
                    publishAt: String(data.publishAt || ""),
                    expireAt: String(data.expireAt || "")
                });
            } catch {
                return json({ title: "", content: "", publishAt: "", expireAt: "" });
            }
        }

        if (action === "exemptions") {
            const subject = String(url.searchParams.get("subject") || "").trim();
            if (!isSafeTopLevelName(subject) || isSystemSubject(subject)) return json({ error: "Invalid subject" }, 400);
            const all = await readExemptions(env.R2_BUCKET);
            return json({ subject, exemptions: all[subject] || [] });
        }

        if (action === "grades") {
            const subject = String(url.searchParams.get("subject") || "").trim();
            if (!isSafeTopLevelName(subject) || isSystemSubject(subject)) return json({ error: "Invalid subject" }, 400);
            const grades = await readGradesBySubject(env.R2_BUCKET, subject);
            return json({ subject, grades });
        }

        if (action === "historyByName") {
            const name = String(url.searchParams.get("name") || "").trim();
            if (!name) return json({ error: "Name required" }, 400);
            const history = await readHistory(env.R2_BUCKET, name);
            return json({ name, history });
        }

        if (action === "auditLogs") {
            const limit = Number(url.searchParams.get("limit") || 200);
            const logs = await readAuditLogs(env.R2_BUCKET, limit);
            return json({ logs });
        }

        if (action === "adminUsers") {
            if (!isOwnerAdmin(auth.username)) return json({ error: "只有 admin 主账号可以查看管理员列表" }, 403);
            const canManageAdmins = isOwnerAdmin(auth.username);
            return json({
                users: decorateAdminUsersForClient(await listAdminUsers(env)),
                canManageAdmins,
                canManageModelSettings: canManageAdmins
            });
        }

        if (action === "aiRules") {
            const subject = String(url.searchParams.get("subject") || "").trim();
            if (subject && (!isSafeTopLevelName(subject) || isSystemSubject(subject))) {
                return json({ error: "Invalid subject" }, 400);
            }
            const merged = await getMergedAiRule(env.R2_BUCKET, subject);
            return json({ subject, ...merged });
        }

        if (action === "roster") {
            const className = String(url.searchParams.get("className") || "").trim();
            const names = await getActiveRosterNames(env, className);
            const classes = await listStudentClasses(env);
            return json({ names, classes, className, d1: isD1Ready(env) });
        }

        if (action === "students") {
            const students = await listStudents(env);
            const columns = await listStudentColumns(env);
            const classes = await listStudentClasses(env);
            return json({ students, columns, classes, d1: isD1Ready(env) });
        }

        if (action === "namingRule") {
            const subject = String(url.searchParams.get("subject") || "").trim();
            if (!subject || !isSafeTopLevelName(subject) || isSystemSubject(subject)) {
                return json({ error: "Invalid subject" }, 400);
            }
            const rule = await getNamingRule(env, subject);
            return json({ subject, template: String(rule.template || "") });
        }

        if (action === "assignmentRequirement") {
            const subject = String(url.searchParams.get("subject") || "").trim();
            if (!subject || !isSafeTopLevelName(subject) || isSystemSubject(subject)) {
                return json({ error: "Invalid subject" }, 400);
            }
            const requirement = await getAssignmentRequirement(env.R2_BUCKET, subject);
            return json({ subject, requirement });
        }

        if (action === "subjectSettings") {
            const subject = String(url.searchParams.get("subject") || "").trim();
            if (!subject || !isSafeTopLevelName(subject) || isSystemSubject(subject)) {
                return json({ error: "Invalid subject" }, 400);
            }
            const settings = await getSubjectSettings(env.R2_BUCKET, subject, env);
            return json({ subject, settings });
        }

        if (action === "modelSettings") {
            if (!isOwnerAdmin(auth.username)) return json({ error: "只有 admin 主账号可以配置模型" }, 403);
            const settings = await getModelSettings(env);
            const safeSettings = { ...settings, apiKey: "" };
            return json({
                settings: safeSettings,
                hasApiKey: Boolean(String(settings.apiKey || "").trim()),
                apiKeySource: settings.apiKeySource || ""
            });
        }

        if (action === "plagiarismResult") {
            const key = String(url.searchParams.get("key") || "").trim();
            if (!isSafeObjectKey(key) || key.startsWith("_system/")) return json({ error: "Invalid key" }, 400);
            return json({ key, result: await getPlagiarismResult(env.R2_BUCKET, key) });
        }
    }

    if (method === "POST") {
        let body;
        try {
            body = await request.json();
        } catch {
            return json({ error: "Invalid JSON body" }, 400);
        }

        if (body.action === "adminUsers") {
            if (!isOwnerAdmin(auth.username)) return json({ error: "只有 admin 主账号可以查看管理员列表" }, 403);
            const canManageAdmins = isOwnerAdmin(auth.username);
            return json({
                users: decorateAdminUsersForClient(await listAdminUsers(env)),
                canManageAdmins,
                canManageModelSettings: canManageAdmins
            });
        }

        if (body.action === "adminAssistant") {
            const message = normalizeText(body.message);
            if (!message) return json({ error: "Message required" }, 400);
            const assistantContext = body.context && typeof body.context === "object" ? body.context : {};
            const stats = await listSubjectStats(env).catch(() => []);
            try {
                const operation = await parseAdminAssistantOperation(env, message, stats, assistantContext);
                if (operation) {
                    const highRiskAdminAction = ["create_admin", "reset_admin_password", "change_admin_password"].includes(operation.action);
                    if (highRiskAdminAction && !/(管理员|后台账号|密码|admin)/iu.test(message)) {
                        return json({ success: true, reply: "我没有执行这个高风险账号操作。请明确说明管理员账号和操作内容。", navigate: "admin-accounts" });
                    }
                    return json(await executeAdminAssistantOperation(env, auth, operation, stats));
                }
            } catch (error) {
                return json({ success: true, reply: error.message || "执行失败，请检查指令参数。", navigate: "dashboard" });
            }

            const contextText = `当前作业：${stats.map((item) => `${item.name}(${item.submitted}/${item.expected})`).slice(0, 12).join("、") || "暂无"}\n后台可操作能力：${ADMIN_CAPABILITIES.join("；")}`;
            return json({ success: true, reply: await replyWithAdminAi(env, message, contextText) });
        }

        if (body.action === "updateNotice") {
            const title = String(body.title || "").trim();
            const content = String(body.content || "").trim();
            const publishAt = String(body.publishAt || "").trim();
            const expireAt = String(body.expireAt || "").trim();

            if (!title || !content) return json({ error: "Title/content required" }, 400);
            if (title.length > 120 || content.length > 5000) return json({ error: "Notice too long" }, 400);
            if (!isValidOptionalDateTime(publishAt) || !isValidOptionalDateTime(expireAt)) return json({ error: "Invalid notice datetime" }, 400);
            if (publishAt && expireAt && new Date(expireAt).getTime() <= new Date(publishAt).getTime()) {
                return json({ error: "Expire time must be later than publish time" }, 400);
            }

            await env.R2_BUCKET.put("notice.json", JSON.stringify({ title, content, publishAt, expireAt }), {
                httpMetadata: { contentType: "application/json" }
            });
            return json({ success: true });
        }

        if (body.action === "addSubject") {
            const subject = String(body.subject || "").trim();
            if (!isSafeTopLevelName(subject) || isSystemSubject(subject)) return json({ error: "Invalid subject" }, 400);
            await env.R2_BUCKET.put(`${subject}/.keep`, "");
            await setSubjectCreatedBy(env.R2_BUCKET, subject, auth.username);
            return json({ success: true });
        }

        if (body.action === "setDeadline") {
            const subject = String(body.subject || "").trim();
            const deadline = String(body.deadline || "").trim();
            if (!isSafeTopLevelName(subject) || isSystemSubject(subject)) return json({ error: "Invalid subject" }, 400);
            if (deadline && Number.isNaN(Date.parse(deadline))) return json({ error: "Invalid deadline format" }, 400);

            const deadlines = await readDeadlines(env.R2_BUCKET);
            if (!deadline) delete deadlines[subject];
            else deadlines[subject] = deadline;
            await writeDeadlines(env.R2_BUCKET, deadlines);
            return json({ success: true, deadlines });
        }

        if (body.action === "setExemption") {
            const subject = String(body.subject || "").trim();
            const name = String(body.name || "").trim();
            const enabled = Boolean(body.enabled);
            if (!isSafeTopLevelName(subject) || isSystemSubject(subject)) return json({ error: "Invalid subject" }, 400);
            if (!name) return json({ error: "Name required" }, 400);

            const exemptions = await setExemption(env.R2_BUCKET, subject, name, enabled);
            await appendAuditLog(env.R2_BUCKET, {
                actorType: "admin",
                actor: auth.username,
                action: enabled ? "set_exemption" : "remove_exemption",
                target: `${subject}/${name}`
            });
            return json({ success: true, subject, exemptions });
        }

        if (body.action === "changeAdminPassword") {
            try {
                const user = await changeAdminPassword(env, auth.username, body.oldPassword, body.newPassword);
                await appendAuditLog(env.R2_BUCKET, {
                    actorType: "admin",
                    actor: auth.username,
                    action: "change_admin_password",
                    target: auth.username
                });
                return json({ success: true, user });
            } catch (error) {
                return json({ error: error.message || "修改密码失败" }, 400);
            }
        }

        if (body.action === "createAdminUser") {
            if (!isOwnerAdmin(auth.username)) return json({ error: "只有 admin 主账号可以新增管理员" }, 403);
            try {
                const user = await createAdminUser(env, body.username, body.password, auth.username);
                await appendAuditLog(env.R2_BUCKET, {
                    actorType: "admin",
                    actor: auth.username,
                    action: "create_admin_user",
                    target: user.username
                });
                return json({ success: true, user });
            } catch (error) {
                return json({ error: error.message || "新增管理员失败" }, 400);
            }
        }

        if (body.action === "resetAdminPassword") {
            if (!isOwnerAdmin(auth.username)) return json({ error: "只有 admin 主账号可以重置管理员密码" }, 403);
            try {
                const user = await resetAdminPassword(env, body.username, body.password, auth.username);
                await appendAuditLog(env.R2_BUCKET, {
                    actorType: "admin",
                    actor: auth.username,
                    action: "reset_admin_password",
                    target: user.username
                });
                return json({ success: true, user });
            } catch (error) {
                return json({ error: error.message || "重置管理员密码失败" }, 400);
            }
        }

        if (body.action === "saveGrades") {
            const subject = String(body.subject || "").trim();
            const items = Array.isArray(body.items) ? body.items : [];
            if (!isSafeTopLevelName(subject) || isSystemSubject(subject)) return json({ error: "Invalid subject" }, 400);
            if (items.length === 0) return json({ error: "No grading items" }, 400);

            const grades = await upsertGradesBySubject(env.R2_BUCKET, subject, items, auth.username);
            for (const [name, grade] of Object.entries(grades)) {
                await applyGradeToHistoryBySubject(env.R2_BUCKET, subject, name, grade);
            }
            await appendAuditLog(env.R2_BUCKET, {
                actorType: "admin",
                actor: auth.username,
                action: "save_grades",
                target: subject,
                count: items.length
            });
            return json({ success: true, subject, grades });
        }

        if (body.action === "aiReminder") {
            const subject = String(body.subject || "").trim();
            if (!isSafeTopLevelName(subject) || isSystemSubject(subject)) return json({ error: "Invalid subject" }, 400);
            const result = await runAdminReminderAi(context, body, auth.username);
            return json({ success: true, ...result });
        }

        if (body.action === "aiGradeDraft") {
            const subject = String(body.subject || "").trim();
            if (!isSafeTopLevelName(subject) || isSystemSubject(subject)) return json({ error: "Invalid subject" }, 400);
            const result = await runAdminGradeDraftAi(context, body, auth.username);
            return json({ success: true, ...result });
        }

        if (body.action === "setAiRules") {
            const subject = String(body.subject || "").trim();
            const requirements = String(body.requirements || body.instruction || "").trim();
            const faq = String(body.faq || "").trim();
            const examples = String(body.examples || "").trim();
            if (subject && (!isSafeTopLevelName(subject) || isSystemSubject(subject))) return json({ error: "Invalid subject" }, 400);
            const store = await setAiRule(env.R2_BUCKET, subject, { requirements, faq, examples });
            await appendAuditLog(env.R2_BUCKET, {
                actorType: "admin",
                actor: auth.username,
                action: "set_ai_rules",
                target: subject || "_global"
            });
            return json({ success: true, store });
        }

        if (body.action === "saveStudentsBulk") {
            const rows = Array.isArray(body.rows) ? body.rows : [];
            const columns = Array.isArray(body.columns) ? body.columns : [];
            let students;
            let savedColumns = columns;
            try {
                const saved = await replaceStudentsBulk(env, rows, columns);
                students = saved.students;
                savedColumns = saved.columns || savedColumns;
            } catch (error) {
                return json({ error: error.message || "保存学生库失败" }, 400);
            }
            await appendAuditLog(env.R2_BUCKET, {
                actorType: "admin",
                actor: auth.username,
                action: "save_students_bulk",
                target: "students",
                count: students.length
            });
            return json({ success: true, students, columns: savedColumns });
        }

        if (body.action === "resetStudentPassword") {
            const name = String(body.name || "").trim();
            const mode = String(body.mode || "random").trim().toLowerCase();
            if (!name) return json({ error: "Name required" }, 400);
            if (!isD1Ready(env)) return json({ error: "D1 未配置，无法重置密码" }, 400);

            const student = await getStudentByName(env, name);
            if (!student?.name) return json({ error: "学生不存在或未启用" }, 404);

            const nextPassword = mode === "default" ? DEFAULT_RESET_PASSWORD : generateTempPassword(10);
            const nextHash = await hashStudentPassword(nextPassword);
            await env.DB.prepare(`
INSERT INTO student_auth (name, password_hash, must_change_password, updated_at)
VALUES (?1, ?2, 1, CURRENT_TIMESTAMP)
ON CONFLICT(name) DO UPDATE SET
  password_hash = excluded.password_hash,
  must_change_password = excluded.must_change_password,
  updated_at = CURRENT_TIMESTAMP
`).bind(student.name, nextHash).run();

            await appendAuditLog(env.R2_BUCKET, {
                actorType: "admin",
                actor: auth.username,
                action: "reset_student_password",
                target: student.name,
                mode: mode === "default" ? "default" : "random"
            });
            return json({
                success: true,
                name: student.name,
                mode: mode === "default" ? "default" : "random",
                tempPassword: nextPassword
            });
        }

        if (body.action === "setNamingRule") {
            const subject = String(body.subject || "").trim();
            if (!subject || !isSafeTopLevelName(subject) || isSystemSubject(subject)) {
                return json({ error: "Invalid subject" }, 400);
            }
            const template = String(body.template || "").trim();
            let result;
            try {
                result = await setNamingRule(env, subject, template);
            } catch (error) {
                return json({ error: error.message || "保存命名规则失败" }, 400);
            }
            await appendAuditLog(env.R2_BUCKET, {
                actorType: "admin",
                actor: auth.username,
                action: "set_naming_rule",
                target: `${subject}:${template ? "set" : "clear"}`
            });
            return json({ success: true, ...result });
        }

        if (body.action === "setAssignmentRequirement") {
            const subject = String(body.subject || "").trim();
            if (!subject || !isSafeTopLevelName(subject) || isSystemSubject(subject)) {
                return json({ error: "Invalid subject" }, 400);
            }
            const content = String(body.content || "").trim();
            if (content.length > 20000) return json({ error: "Requirement too long" }, 400);
            const requirement = await setAssignmentRequirement(env.R2_BUCKET, subject, content);
            await appendAuditLog(env.R2_BUCKET, {
                actorType: "admin",
                actor: auth.username,
                action: "set_assignment_requirement",
                target: `${subject}:${content ? "set" : "clear"}`
            });
            return json({ success: true, subject, requirement });
        }

        if (body.action === "setSubjectSettings") {
            const subject = String(body.subject || "").trim();
            if (!subject || !isSafeTopLevelName(subject) || isSystemSubject(subject)) {
                return json({ error: "Invalid subject" }, 400);
            }
            let settings;
            try {
                settings = await setSubjectSettings(env.R2_BUCKET, subject, {
                    allowedExtensions: body.allowedExtensions,
                    plagiarismMode: body.plagiarismMode,
                    classNames: body.classNames
                });
            } catch (error) {
                return json({ error: error.message || "保存作业设置失败" }, 400);
            }
            await appendAuditLog(env.R2_BUCKET, {
                actorType: "admin",
                actor: auth.username,
                action: "set_subject_settings",
                target: subject
            });
            return json({ success: true, subject, settings });
        }

        if (body.action === "setModelSettings") {
            if (!isOwnerAdmin(auth.username)) return json({ error: "只有 admin 主账号可以配置模型" }, 403);
            let settings;
            try {
                const current = await getModelSettings(env);
                const incomingApiKey = String(body.apiKey || "").trim();
                const clearApiKey = Boolean(body.clearApiKey);
                settings = await setModelSettings(env.R2_BUCKET, {
                    aiBaseUrl: body.aiBaseUrl,
                    apiKey: clearApiKey ? "" : (incomingApiKey || current.apiKey || ""),
                    lightModel: body.lightModel,
                    heavyModel: body.heavyModel,
                    embeddingModel: body.embeddingModel,
                    timeoutMs: body.timeoutMs
                });
            } catch (error) {
                return json({ error: error.message || "保存模型配置失败" }, 400);
            }
            await appendAuditLog(env.R2_BUCKET, {
                actorType: "admin",
                actor: auth.username,
                action: "set_model_settings",
                target: settings.lightModel || settings.heavyModel || "model-settings"
            });
            return json({
                success: true,
                settings: { ...settings, apiKey: "" },
                hasApiKey: Boolean(String(settings.apiKey || "").trim()),
                apiKeySource: settings.apiKeySource || (settings.apiKey ? "store" : "")
            });
        }

        if (body.action === "testModelSettings") {
            if (!isOwnerAdmin(auth.username)) return json({ error: "只有 admin 主账号可以测试模型配置" }, 403);
            const current = await getModelSettings(env);
            const settings = {
                ...current,
                aiBaseUrl: String(body.aiBaseUrl || current.aiBaseUrl || "").trim(),
                apiKey: String(body.apiKey || current.apiKey || "").trim(),
                lightModel: String(body.lightModel || current.lightModel || "").trim(),
                heavyModel: String(body.heavyModel || current.heavyModel || "").trim(),
                embeddingModel: String(body.embeddingModel || current.embeddingModel || "").trim(),
                timeoutMs: Number(body.timeoutMs || current.timeoutMs || 25000)
            };
            const model = settings.lightModel || settings.heavyModel;
            if (!settings.apiKey) return json({ error: "API Key 未配置" }, 400);
            if (!settings.aiBaseUrl) return json({ error: "AI Base URL 未配置" }, 400);
            if (!model) return json({ error: "轻量模型或重模型至少填写一个" }, 400);
            const startedAt = Date.now();
            const baseUrl = settings.aiBaseUrl.replace(/\/+$/, "");
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort("Model test timeout"), Math.max(5000, settings.timeoutMs || 25000));
            try {
                const upstream = await fetch(`${baseUrl}/chat/completions`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${settings.apiKey}`,
                        "HTTP-Referer": "https://ai-xuewei.local",
                        "X-Title": "AI学委"
                    },
                    body: JSON.stringify({
                        model,
                        temperature: 0,
                        max_tokens: 30,
                        messages: [
                            { role: "system", content: "你是模型连通性测试器。只回复 OK。" },
                            { role: "user", content: "请只回复 OK" }
                        ]
                    }),
                    signal: controller.signal
                });
                const rawText = await upstream.text();
                let payload = {};
                try {
                    payload = JSON.parse(rawText);
                } catch {}
                if (!upstream.ok) {
                    const upstreamMessage = payload?.error?.message || payload?.message || rawText || upstream.statusText;
                    return json({
                        error: `上游返回 ${upstream.status}：${String(upstreamMessage).slice(0, 500)}`,
                        model,
                        latencyMs: Date.now() - startedAt
                    }, 400);
                }
                const text = payload?.choices?.[0]?.message?.content || rawText;
                return json({
                    success: true,
                    model,
                    latencyMs: Date.now() - startedAt,
                    sample: String(text || "").trim().slice(0, 120)
                });
            } catch (error) {
                return json({
                    error: String(error?.name || "").toLowerCase().includes("abort")
                        ? "请求超时，请增大超时时间或更换模型"
                        : (error.message || "模型测试失败"),
                    model,
                    latencyMs: Date.now() - startedAt
                }, 400);
            } finally {
                clearTimeout(timer);
            }
        }

        if (body.action === "runPlagiarismCheck") {
            const subject = String(body.subject || "").trim();
            const key = String(body.key || "").trim();
            if (!subject || !isSafeTopLevelName(subject) || isSystemSubject(subject)) {
                return json({ error: "Invalid subject" }, 400);
            }
            if (!isSafeObjectKey(key) || key.startsWith("_system/")) return json({ error: "Invalid key" }, 400);
            const settings = await getSubjectSettings(env.R2_BUCKET, subject, env);
            const modelSettings = await getModelSettings(env);
            const result = await runPlagiarismCheck(env.R2_BUCKET, subject, key, {
                mode: body.mode || settings.plagiarismMode || "normal",
                env,
                modelSettings
            });
            await appendAuditLog(env.R2_BUCKET, {
                actorType: "admin",
                actor: auth.username,
                action: "run_plagiarism_check",
                target: key,
                count: result.matches.length
            });
            return json({ success: true, result });
        }

        if (body.action === "delete") {
            const key = String(body.key || "").trim();
            const isFolder = Boolean(body.isFolder);

            if (isFolder) {
                if (!isSafeTopLevelName(key) || isSystemSubject(key)) return json({ error: "Invalid subject" }, 400);
                const objects = await listAllByPrefix(env.R2_BUCKET, `${key}/`);
                await Promise.all(objects.map((obj) => env.R2_BUCKET.delete(obj.key)));
                const deadlines = await readDeadlines(env.R2_BUCKET);
                if (deadlines[key]) {
                    delete deadlines[key];
                    await writeDeadlines(env.R2_BUCKET, deadlines);
                }
                await deleteAssignmentRequirement(env.R2_BUCKET, key);
                await deleteSubjectMeta(env.R2_BUCKET, key);
                await deleteSubjectSettings(env.R2_BUCKET, key);
                await appendAuditLog(env.R2_BUCKET, {
                    actorType: "admin",
                    actor: auth.username,
                    action: "delete_subject",
                    target: key,
                    count: objects.length
                });
                return json({ success: true });
            }

            if (!isSafeObjectKey(key) || key.startsWith("_system/")) return json({ error: "Invalid key" }, 400);
            await env.R2_BUCKET.delete(key);
            await appendAuditLog(env.R2_BUCKET, {
                actorType: "admin",
                actor: auth.username,
                action: "delete_file",
                target: key
            });
            return json({ success: true });
        }
    }

    return json({ error: "Bad Request" }, 400);
}
