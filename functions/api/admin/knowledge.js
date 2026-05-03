export const ADMIN_KNOWLEDGE = [
    {
        id: "overview.dashboard",
        title: "总览与作业池",
        area: "总览",
        keywords: ["总览", "首页", "作业池", "dashboard", "提交率", "当前科目数", "学生库人数"],
        content: "总览页展示当前科目数、所有作业总提交率、学生库人数和全部科目卡片。科目卡片可以打开作业详情，也可以设置规则、截止时间、打包下载或删除科目。"
    },
    {
        id: "subject.manage",
        title: "科目和作业管理",
        area: "科目/作业",
        keywords: ["新增科目", "创建科目", "删除科目", "新增作业", "删除作业", "科目"],
        content: "管理员可以新增或删除科目。删除科目会清理该科目下的提交文件、截止时间、作业要求、科目元信息和作业设置，并写入审计日志。"
    },
    {
        id: "submission.query",
        title: "提交情况查询",
        area: "提交记录",
        keywords: ["提交情况", "提交进度", "提交率", "未交", "缺交", "已交", "名单统计"],
        content: "可以按作业查询已交人数、应交人数、提交率、未交人数和未交名单。应交人数会按作业适用班级计算；未设置适用班级时按全部学生库计算。"
    },
    {
        id: "submission.files",
        title: "提交文件管理",
        area: "提交记录",
        keywords: ["提交文件", "文件列表", "删除文件", "预览", "下载", "打包下载", "zip"],
        content: "作业详情里可以查看提交文件，支持在线预览图片、PDF、文本、Markdown 等文件；Office 文档可尝试在线预览或下载。管理员可以删除指定提交文件，也可以将某个作业下的全部文件打包下载。"
    },
    {
        id: "deadline",
        title: "截止时间",
        area: "科目/作业",
        keywords: ["截止", "截止时间", "deadline", "逾期", "清除截止"],
        content: "每个科目可以设置或清除截止时间。学生端会根据截止时间提示是否允许提交；管理员可以通过科目卡片或 AI 助手设置。"
    },
    {
        id: "subject.naming",
        title: "命名模板",
        area: "作业设置",
        keywords: ["命名模板", "命名规则", "文件命名", "模板", "originalBase", "className", "subject"],
        content: "命名模板用于上传时自动重命名文件。支持占位符 {className}、{name}、{id}、{studentId}、{subject}、{originalBase}。例如 {className}-{name}-{id}-{subject}。模板为空表示清除该科目命名规则。"
    },
    {
        id: "subject.requirements",
        title: "作业要求",
        area: "作业设置",
        keywords: ["作业要求", "提交要求", "要求", "说明", "规则"],
        content: "每个科目可以维护作业要求文本，学生端 AI 和提交前检查会参考这些要求。建议写清格式、命名、内容范围和禁止事项。"
    },
    {
        id: "subject.extensions",
        title: "允许后缀和预检",
        area: "作业设置",
        keywords: ["允许后缀", "文件后缀", "文件类型", "预检", "pdf", "docx", "md", "jpg"],
        content: "作业设置里的允许后缀控制学生上传文件类型。可设置如 pdf,docx,md,jpg。留空时使用系统默认允许类型。预检提示后缀不允许时，应检查该科目的 allowedExtensions 是否包含对应扩展名。"
    },
    {
        id: "subject.classes",
        title: "适用班级",
        area: "作业设置",
        keywords: ["适用班级", "指定班级", "班级提交", "只让", "多个班", "className"],
        content: "作业可以选择一个或多个适用班级。提交统计只计算这些班级的学生，不会统计全部学生库。学生库里的班级字段通常是 className，也兼容 classname、class、班级。"
    },
    {
        id: "plagiarism",
        title: "查重",
        area: "作业设置",
        keywords: ["查重", "相似", "重复", "plagiarism", "normal", "strict", "manual", "off"],
        content: "查重可对指定提交文件运行，结果会记录相似项。查重模式包括 normal、strict、manual、off。语义查重依赖 Embedding 模型；如果使用 OpenRouter 免费聊天模型且未配置可用 embedding，建议暂时留空 Embedding 模型。"
    },
    {
        id: "exemption",
        title: "免交学生",
        area: "作业设置",
        keywords: ["免交", "放行", "豁免", "取消免交"],
        content: "管理员可以为某个科目设置免交学生，也可以移除免交。免交名单会影响该科目的提交统计和未交名单。"
    },
    {
        id: "student.database",
        title: "学生库",
        area: "学生库",
        keywords: ["学生库", "学生名单", "学生", "名单", "班级", "人员名单", "花名册"],
        content: "学生库维护所有学生记录、字段和密码重置。保存后，作业提交进度会按学生库人数或适用班级人数计算。常用字段有 className、name、id 或 studentId。"
    },
    {
        id: "student.query",
        title: "查询学生和班级名单",
        area: "学生库",
        keywords: ["查询学生", "班级名单", "几班有哪些人", "1班", "2班", "3班", "人员"],
        content: "可以查询全部学生，也可以按班级查询。例如：查询 02 班学生、2班有哪些人。系统会尝试把 2班 匹配到学生库里的 02。"
    },
    {
        id: "student.crud",
        title: "新增、删除和批量删除学生",
        area: "学生库",
        keywords: ["新增学生", "删除学生", "删除班级", "清空班级", "删掉", "添加学生"],
        content: "新增学生需要姓名，可选学号和班级。删除学生需要姓名；按班级批量删除需要班级名，例如：删除 03 班所有学生。删除操作会写入审计日志。"
    },
    {
        id: "student.password",
        title: "学生密码重置",
        area: "学生库",
        keywords: ["学生密码", "重置学生密码", "默认密码", "临时密码"],
        content: "管理员可以重置学生密码。默认临时密码是 123456，也可以生成随机临时密码。重置后学生首次登录应修改密码。"
    },
    {
        id: "student.columns",
        title: "学生库字段",
        area: "学生库",
        keywords: ["字段", "列", "className,name,id", "应用字段"],
        content: "学生库字段可自定义，必须保留 name。字段名只能使用字母、数字和下划线，并以字母或下划线开头。命名模板可引用这些字段。"
    },
    {
        id: "grades",
        title: "评分和评语",
        area: "评分",
        keywords: ["评分", "打分", "分数", "评语", "AI评语", "保存评分"],
        content: "管理员可以为每个作业的学生保存分数和评语，保存后会回写到学生提交历史。AI 可生成评语草稿，通常使用重模型。"
    },
    {
        id: "notice",
        title: "公告",
        area: "公告",
        keywords: ["公告", "通知", "弹幕", "发布时间", "过期时间"],
        content: "公告用于学生端全局展示，支持标题、内容、定时发布时间和过期时间。学生端顶部会以弹幕形式展示公告，点击可查看详情。"
    },
    {
        id: "ai.rules",
        title: "全局和科目 AI 规则",
        area: "AI",
        keywords: ["AI规则", "全局AI规则", "科目规则", "FAQ", "示例", "requirements"],
        content: "全局 AI 规则影响学生端 AI 和后台相关 AI 生成。也可以给具体科目配置独立要求、FAQ 和示例。科目规则会和全局规则合并。"
    },
    {
        id: "model.settings",
        title: "模型配置中心",
        area: "AI",
        keywords: ["模型配置", "OpenRouter", "API Key", "Base URL", "轻量模型", "重模型", "Embedding", "测试连接"],
        content: "模型配置中心维护 AI Base URL、API Key、轻量模型、重模型、Embedding 模型和请求超时。后台助手和学生 AI 多用轻量模型；AI 评语草稿使用重模型；语义查重使用 Embedding。API Key 输入框留空表示保留已保存 Key。"
    },
    {
        id: "admin.accounts",
        title: "管理员账号",
        area: "管理员",
        keywords: ["管理员账号", "新增管理员", "重置管理员密码", "修改我的密码", "admin"],
        content: "首次部署默认管理员账号为 admin，默认密码 123456。登录后台后可以修改自己的密码。只有 admin 主账号可以新增其他管理员或重置其他管理员密码。admin 主账号密码忘记时，需要通过服务器脚本或部署环境手动重置。"
    },
    {
        id: "audit",
        title: "审计日志",
        area: "审计",
        keywords: ["审计", "日志", "操作记录", "同步"],
        content: "审计日志记录管理员和学生端关键操作，例如删除科目、删除文件、保存学生库、重置密码、设置规则、运行查重等。后台审计页会自动同步最近操作。"
    },
    {
        id: "history.preview",
        title: "提交历史和在线预览",
        area: "历史",
        keywords: ["历史", "提交历史", "在线预览", "图片预览", "文档预览", "撤回"],
        content: "学生端历史页记录当前姓名对应的提交历史。卡片可打开在线预览，图片支持缩放、拖动和重置；文本和 PDF 可直接预览，Office 文档可尝试在线预览或下载。"
    },
    {
        id: "deployment",
        title: "部署和本地运行",
        area: "部署",
        keywords: ["部署", "Cloudflare", "cf", "Linux", "本地运行", "npm start", "wrangler"],
        content: "本地 Linux/Windows 适配服务可通过 npm start 或 npm run linux:dev 启动。Cloudflare 部署通常使用 wrangler。Linux 数据保存在 linux-data 目录，管理员密码可用 scripts/reset-admin-password.js 重置。"
    }
];

function tokenizeKnowledgeText(value) {
    return String(value || "")
        .toLowerCase()
        .match(/[a-z0-9_./:-]{2,}|[\u4e00-\u9fff]{1,}/g) || [];
}

export function searchAdminKnowledge(query, limit = 5) {
    const text = String(query || "").trim();
    if (!text) return [];
    const terms = Array.from(new Set(tokenizeKnowledgeText(text))).slice(0, 30);
    return ADMIN_KNOWLEDGE.map((item) => {
        const haystack = `${item.id} ${item.title} ${item.area} ${(item.keywords || []).join(" ")} ${item.content}`.toLowerCase();
        let score = 0;
        for (const term of terms) {
            if (term && haystack.includes(term)) score += term.length > 1 ? 2 : 1;
        }
        for (const keyword of item.keywords || []) {
            if (text.includes(keyword)) score += 6;
        }
        if (text.includes(item.title)) score += 8;
        return { item, score };
    })
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
        .slice(0, limit)
        .map((row) => row.item);
}

export function formatKnowledgeForPrompt(items) {
    return (Array.isArray(items) ? items : [])
        .map((item) => `#${item.id} [${item.area}] ${item.title}\n${item.content}`)
        .join("\n\n");
}

export function summarizeAdminKnowledge(items) {
    return (Array.isArray(items) ? items : [])
        .map((item) => `${item.title}：${item.content}`)
        .join("\n");
}
