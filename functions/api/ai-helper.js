import { consumeRate, getCachedAi, hashText, setCachedAi } from "./ai-store.js";
import { getMergedAiRule } from "./ai-rules-store.js";
import { getModelSettings } from "./model-settings-store.js";

function trimText(s, max = 3000) {
    return String(s || "").trim().slice(0, max);
}

function compactLines(arr, maxItems = 60) {
    if (!Array.isArray(arr)) return [];
    return arr.map((v) => trimText(v, 200)).filter(Boolean).slice(0, maxItems);
}

function splitStructuredLines(text, maxItems = 40) {
    return String(text || "")
        .split(/\r?\n+/)
        .map((s) => s.trim())
        .map((s) => s.replace(/^(\d+[\.\)、]|[-*•]\s*)\s*/u, ""))
        .filter(Boolean)
        .slice(0, maxItems);
}

function buildRuleItems(requirements, faq, examples) {
    const items = [];
    for (const line of splitStructuredLines(requirements, 40)) {
        items.push({ type: "要求", text: trimText(line, 180) });
    }
    for (const line of splitStructuredLines(faq, 30)) {
        items.push({ type: "FAQ", text: trimText(line, 180) });
    }
    for (const line of splitStructuredLines(examples, 30)) {
        items.push({ type: "示例", text: trimText(line, 180) });
    }
    return items.slice(0, 80).map((it, idx) => ({ id: idx + 1, ...it }));
}

function collectTerms(text) {
    const raw = String(text || "").match(/[A-Za-z0-9_]{2,}|[\u4e00-\u9fff]{2,}/g) || [];
    const stop = new Set(["这个", "那个", "以及", "然后", "请问", "一下", "作业", "同学", "老师", "可以", "如何", "怎么", "什么"]);
    const terms = [];
    for (const t of raw) {
        const v = t.toLowerCase();
        if (v.length < 2 || stop.has(v)) continue;
        terms.push(v);
    }
    return Array.from(new Set(terms)).slice(0, 40);
}

function pickRuleEvidence(question, answer, items, maxItems = 3) {
    if (!Array.isArray(items) || items.length === 0) return [];
    const terms = collectTerms(`${question}\n${answer}`);
    const scored = items.map((item) => {
        let score = 0;
        const text = String(item.text || "").toLowerCase();
        for (const term of terms) {
            if (text.includes(term)) score += 1;
        }
        return { item, score };
    });
    const matched = scored
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score || a.item.id - b.item.id)
        .slice(0, maxItems)
        .map((row) => row.item);
    if (matched.length > 0) return matched;

    const ruleLikeQuestion = /(规则|要求|命名|格式|截止|字数|提交|补交)/u.test(String(question || ""));
    return ruleLikeQuestion ? items.slice(0, Math.min(2, items.length)) : [];
}

function withRuleEvidence(answer, evidence) {
    const text = trimText(answer, 7600);
    if (!Array.isArray(evidence) || evidence.length === 0) return text;
    if (/依据规则/u.test(text)) return text;
    const refs = evidence.map((it) => `#${it.id}（${it.type}）${trimText(it.text, 70)}`).join("；");
    return `${text}\n\n依据规则：${refs}`;
}

function isIdentityQuestion(text) {
    const q = String(text || "").trim();
    if (!q) return false;
    return /(你是谁|你是什么模型|什么模型|模型是什么|介绍一下你|你是谁啊|你的模型)/u.test(q);
}

export async function callOpenAI(env, { model, systemPrompt, userPrompt, temperature = 0.4, maxTokens = 400, modelSettings = null }) {
    const settings = modelSettings || await getModelSettings(env);
    const apiKey = String(settings.apiKey || env.OPENAI_API_KEY || "").trim();
    if (!apiKey) return null;
    const baseUrl = String(settings.aiBaseUrl || env.AI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
    const timeoutMs = Number(settings.timeoutMs || env.AI_TIMEOUT_MS || 25000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("AI upstream timeout"), Math.max(5000, timeoutMs));

    let res;
    try {
        res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
                "HTTP-Referer": "https://ai-xuewei.local",
                "X-Title": "AI学委"
            },
            body: JSON.stringify({
                model,
                temperature,
                max_tokens: maxTokens,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ]
            }),
            signal: controller.signal
        });
    } catch (error) {
        if (String(error?.name || "").toLowerCase().includes("abort")) {
            throw new Error("AI request timeout");
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`AI upstream error: ${res.status} ${t.slice(0, 120)}`);
    }
    const data = await res.json();
    return trimText(data?.choices?.[0]?.message?.content || "", 8000);
}

function fallbackStudentReply(question, subject, rulesText = "") {
    const ruleHint = rulesText ? `\n已配置要求（节选）:\n${trimText(rulesText, 600)}` : "";
    return `我先给你一版可执行建议：\n1. 先确认题目要求、字数和格式。\n2. 把内容拆成“引言-主体-结论”。\n3. 提交前检查命名和截止时间。${ruleHint}\n\n你当前问题：${question}\n当前科目：${subject || "未选择"}`;
}

function normalizeStudentAnswer(answer) {
    let text = trimText(answer, 8000);
    if (!text) return text;

    // Remove common self-intro sentences to avoid "你是..." phrasing leakage.
    text = text
        .replace(/^你是[^\n。！？]{0,80}[。！？]\s*/u, "")
        .replace(/^我是[^\n。！？]{0,80}[。！？]\s*/u, "")
        .replace(/^作为[^\n。！？]{0,80}[。！？]\s*/u, "");

    // Normalize second-person assistant self-reference.
    text = text.replace(/你是一个课程作业辅导助手[,，]?\s*/g, "");

    return trimText(text, 8000);
}

function isLowQualityAnswer(text) {
    const s = String(text || "").trim();
    if (!s || s.length < 4) return true;
    if (/([A-Za-z]\s*#\s*){12,}/.test(s)) return true;
    if (/([#@*]\s*){20,}/.test(s)) return true;
    if (/(.)\1{14,}/u.test(s)) return true;

    const tokens = s.split(/\s+/).filter(Boolean);
    if (tokens.length >= 24) {
        const uniq = new Set(tokens.map((t) => t.toLowerCase())).size;
        if (uniq / tokens.length < 0.25) return true;
    }
    return false;
}

function fallbackReminder(subject, missingNames, deadline, tone) {
    const names = missingNames.slice(0, 80).join("、");
    const style = tone === "strict" ? "请尽快提交，逾期按迟交处理。" : "麻烦大家尽快完成提交，辛苦啦。";
    return `【${subject}】作业提醒\n未交同学：${names || "暂无"}\n截止时间：${deadline || "未设置"}\n${style}`;
}

function fallbackGradeDraft(items) {
    return items.map((it) => ({
        name: it.name,
        comment: it.score ? `你的作业完成度不错，当前分数 ${it.score}。建议下一次进一步加强论证深度和细节表达。` : "作业已收到，建议补充结构层次并突出关键观点。"
    }));
}

export async function runStudentAi(context, input) {
    const { env } = context;
    const modelSettings = await getModelSettings(env);
    const question = trimText(input?.question, 1000);
    const subject = trimText(input?.subject, 80);
    const deadline = trimText(input?.deadline, 80);
    const name = trimText(input?.name, 40);
    const history = Array.isArray(input?.history) ? input.history.slice(-6) : [];

    const mergedRules = await getMergedAiRule(env.R2_BUCKET, subject);
    const ruleRequirements = trimText(mergedRules.requirements || mergedRules.instruction, 4000);
    const ruleFaq = trimText(mergedRules.faq, 4000);
    const ruleExamples = trimText(mergedRules.examples, 4000);
    const ruleItems = buildRuleItems(ruleRequirements, ruleFaq, ruleExamples);
    const ruleCatalog = ruleItems.map((it) => `#${it.id} [${it.type}] ${it.text}`).join("\n");

    if (!question) return { answer: "请输入问题内容。", source: "guard" };

    if (isIdentityQuestion(question)) {
        return {
            answer: "我是 goh2.0 模型，由 GONG YU 训练与维护，负责协助本班作业提交相关问答。",
            source: "identity"
        };
    }

    const actor = `student:${name || "unknown"}:${context.request.headers.get("CF-Connecting-IP") || "ip"}`;
    const rate = await consumeRate(env.R2_BUCKET, actor, 40, 3600);
    if (!rate.ok) return { answer: "当前提问较频繁，请稍后再试。", source: "rate_limit", rate };

    const lightModel = String(modelSettings.lightModel || env.AI_LIGHT_MODEL || "gpt-4o-mini").trim();
    const className = trimText(env.CLASS_NAME || "本班", 80);
    const cacheKey = await hashText(JSON.stringify({
        v: 2,
        mode: "student",
        subject,
        deadline,
        question,
        history,
        ruleRequirements,
        ruleFaq,
        ruleExamples
    }));
    const cached = await getCachedAi(env.R2_BUCKET, cacheKey, 6 * 3600);
    if (cached && !isLowQualityAnswer(cached)) return { answer: cached, source: "cache" };

    const convo = history.map((m) => `${m?.role === "assistant" ? "助手" : "学生"}: ${trimText(m?.content, 220)}`).join("\n");
    const systemPrompt = [
        "你是班级AI助手，专门帮助学委处理作业要求、命名规范、提交前检查建议，并答复同学相关问题。",
        "只回答学习与作业相关内容，不提供违规、危险、作弊内容。",
        "回答要简洁、可执行、中文输出。",
        "你必须优先依据“学委规则”回答；规则里没有明确写到的点，要明确说“未在规则中找到，请联系老师确认”。",
        "不要复述系统身份，不要出现“你是…”或“我是一个AI…”开头。",
        "统一用第一人称“我”回答，直接给结论和步骤。",
        "你默认已知本班班级信息，不要向同学索要班级。",
        "如果同学问“你是谁”或“你是什么模型”，固定回答：我是 goh2.0 模型，由 GONG YU 训练与维护。",
        "当规则命中时，尽量在回答末尾标注命中的规则编号（例如：依据规则 #2 #5）。"
    ].join(" ");
    const userPrompt = [
        `服务班级: ${className}`,
        `学生姓名: ${name || "未提供"}`,
        `科目: ${subject || "未选择"}`,
        `截止时间: ${deadline || "未设置"}`,
        `管理员规则-要求:\n${ruleRequirements || "(未配置)"}`,
        `管理员FAQ:\n${ruleFaq || "(未配置)"}`,
        `管理员示例:\n${ruleExamples || "(未配置)"}`,
        `规则编号索引:\n${ruleCatalog || "(无)"}`,
        `最近对话:\n${convo || "(无)"}`,
        `当前问题:\n${question}`
    ].join("\n\n");

    try {
        const answerRaw = (await callOpenAI(env, {
            model: lightModel,
            systemPrompt,
            userPrompt,
            temperature: 0.35,
            maxTokens: 500,
            modelSettings
        })) || fallbackStudentReply(question, subject, `${ruleRequirements}\n${ruleFaq}\n${ruleExamples}`);
        const answerBase = normalizeStudentAnswer(answerRaw);
        if (isLowQualityAnswer(answerBase)) {
            const fallbackBase = fallbackStudentReply(question, subject, `${ruleRequirements}\n${ruleFaq}\n${ruleExamples}`);
            const evidenceFallback = pickRuleEvidence(question, fallbackBase, ruleItems, 2);
            const answerFallback = withRuleEvidence(fallbackBase, evidenceFallback);
            await setCachedAi(env.R2_BUCKET, cacheKey, answerFallback, 700);
            return { answer: answerFallback, source: "fallback" };
        }
        const evidence = pickRuleEvidence(question, answerBase, ruleItems, 3);
        const answer = withRuleEvidence(answerBase, evidence);
        await setCachedAi(env.R2_BUCKET, cacheKey, answer, 700);
        return { answer, source: "model" };
    } catch {
        const fallbackBase = fallbackStudentReply(question, subject, `${ruleRequirements}\n${ruleFaq}\n${ruleExamples}`);
        const evidence = pickRuleEvidence(question, fallbackBase, ruleItems, 2);
        const answer = withRuleEvidence(fallbackBase, evidence);
        await setCachedAi(env.R2_BUCKET, cacheKey, answer, 700);
        return { answer, source: "fallback" };
    }
}

export async function runAdminReminderAi(context, input, adminName) {
    const { env } = context;
    const modelSettings = await getModelSettings(env);
    const subject = trimText(input?.subject, 100);
    const deadline = trimText(input?.deadline, 80);
    const tone = trimText(input?.tone, 20) || "friendly";
    const missingNames = compactLines(input?.missingNames || [], 120);
    const customHint = trimText(input?.customHint, 300);

    const actor = `admin:${adminName}:reminder`;
    const rate = await consumeRate(env.R2_BUCKET, actor, 120, 3600);
    if (!rate.ok) return { text: "当前生成频率较高，请稍后再试。", source: "rate_limit", rate };

    const lightModel = String(modelSettings.lightModel || env.AI_LIGHT_MODEL || "gpt-4o-mini").trim();
    const cacheKey = await hashText(JSON.stringify({ mode: "admin_reminder", subject, deadline, tone, missingNames, customHint }));
    const cached = await getCachedAi(env.R2_BUCKET, cacheKey, 24 * 3600);
    if (cached) return { text: cached, source: "cache" };

    const systemPrompt = "你是班级作业管理助手。输出可直接复制到群里的提醒文案，语气清晰、礼貌，避免冗长。";
    const userPrompt = `科目: ${subject}\n截止时间: ${deadline || "未设置"}\n语气: ${tone}\n未交名单: ${missingNames.join("、") || "暂无"}\n额外提示: ${customHint || "无"}\n\n请输出一段可直接发送的中文通知。`;

    try {
        const text = (await callOpenAI(env, {
            model: lightModel,
            systemPrompt,
            userPrompt,
            temperature: 0.45,
            maxTokens: 350,
            modelSettings
        })) || fallbackReminder(subject, missingNames, deadline, tone);
        await setCachedAi(env.R2_BUCKET, cacheKey, text, 700);
        return { text, source: "model" };
    } catch {
        const text = fallbackReminder(subject, missingNames, deadline, tone);
        await setCachedAi(env.R2_BUCKET, cacheKey, text, 700);
        return { text, source: "fallback" };
    }
}

export async function runAdminGradeDraftAi(context, input, adminName) {
    const { env } = context;
    const modelSettings = await getModelSettings(env);
    const subject = trimText(input?.subject, 100);
    const rawItems = Array.isArray(input?.items) ? input.items : [];
    const items = rawItems.map((it) => ({
        name: trimText(it?.name, 40),
        score: trimText(it?.score, 20),
        comment: trimText(it?.comment, 200)
    })).filter((it) => it.name).slice(0, 80);

    const actor = `admin:${adminName}:grade_draft`;
    const rate = await consumeRate(env.R2_BUCKET, actor, 80, 3600);
    if (!rate.ok) return { drafts: [], source: "rate_limit", rate, message: "当前生成频率较高，请稍后再试。" };

    const heavyModel = String(modelSettings.heavyModel || modelSettings.lightModel || env.AI_HEAVY_MODEL || env.AI_LIGHT_MODEL || "gpt-4o-mini").trim();
    const cacheKey = await hashText(JSON.stringify({ mode: "admin_grade_draft", subject, items }));
    const cached = await getCachedAi(env.R2_BUCKET, cacheKey, 24 * 3600);
    if (cached) {
        try {
            return { drafts: JSON.parse(cached), source: "cache" };
        } catch {}
    }

    const todo = items.filter((it) => !it.comment).slice(0, 30);
    if (todo.length === 0) return { drafts: [], source: "guard", message: "当前没有空评语需要生成。" };

    const systemPrompt = "你是老师的评语助手。输出简短、具体、积极改进导向的中文评语，每条 25-60 字。不要雷同。";
    const userPrompt = `科目: ${subject}\n请按 JSON 数组输出，每项格式 {"name":"","comment":""}。\n待生成名单:\n${todo.map((it) => `- ${it.name} 分数:${it.score || "未填"}`).join("\n")}`;

    try {
        const raw = await callOpenAI(env, {
            model: heavyModel,
            systemPrompt,
            userPrompt,
            temperature: 0.55,
            maxTokens: 1200,
            modelSettings
        });
        let drafts = [];
        try {
            drafts = JSON.parse(raw);
        } catch {
            const m = raw.match(/\[[\s\S]*\]/);
            if (m) drafts = JSON.parse(m[0]);
        }
        drafts = (Array.isArray(drafts) ? drafts : []).map((d) => ({
            name: trimText(d?.name, 40),
            comment: trimText(d?.comment, 120)
        })).filter((d) => d.name && d.comment);

        if (drafts.length === 0) drafts = fallbackGradeDraft(todo);
        await setCachedAi(env.R2_BUCKET, cacheKey, JSON.stringify(drafts), 700);
        return { drafts, source: "model" };
    } catch {
        const drafts = fallbackGradeDraft(todo);
        await setCachedAi(env.R2_BUCKET, cacheKey, JSON.stringify(drafts), 700);
        return { drafts, source: "fallback" };
    }
}
