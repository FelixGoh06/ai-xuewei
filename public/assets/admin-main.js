let CLASS_ROSTER = [];
    let currentExplorerSubject = "";
    let currentExplorerFiles = [];
    let currentSubmittedNames = [];
    let currentMissingNames = [];
    let currentEligibleRoster = [];
    let currentGrades = {};
    let currentExemptions = [];
    let currentReceiptMap = {};
    let currentSubmitMetaMap = {};
    let currentSubjectSettings = { allowedExtensions: [], plagiarismMode: 'normal', classNames: [] };
    let currentExplorerViewMode = 'folder';
    let currentExpandedUploader = new Set();
    let studentsDraftRows = [];
    const DEFAULT_STUDENT_COLUMNS = ['classname', 'name', 'id'];
    let studentsDraftColumns = [...DEFAULT_STUDENT_COLUMNS];
    let selectedStudentRowIndexes = new Set();
    let studentsClassFilter = '';
    let studentsClassOptions = [];
    let previewImageScale = 1;
    let previewImageOffsetX = 0;
    let previewImageOffsetY = 0;
    let previewDragging = false;
    let previewDragStartX = 0;
    let previewDragStartY = 0;
    let currentPreviewFileKey = '';
    let currentPreviewUploader = '';
    let auditRefreshTimer = null;
    let auditLastSignature = '';
    let adminAssistantContext = {};

    const rawFetch = window.fetch.bind(window);
    function getAdminToken() { return localStorage.getItem('adminToken') || ''; }
    function appendAdminToken(url) {
      const token = getAdminToken();
      if (!token) return url;
      const d = url.includes('?') ? '&' : '?';
      return `${url}${d}token=${encodeURIComponent(token)}`;
    }

    async function loadRoster() {
      try {
        const res = await fetch('/api/admin/core?action=roster');
        if (!res.ok) return;
        const data = await res.json();
        CLASS_ROSTER = Array.isArray(data.names) ? data.names : [];
        studentsClassOptions = Array.isArray(data.classes) ? data.classes : studentsClassOptions;
      } catch (_) { }
    }

    function formatDeadlineText(deadline) {
      if (!deadline) return "未设置";
      const d = new Date(deadline);
      if (Number.isNaN(d.getTime())) return "鏍煎紡寮傚父";
      return d.toLocaleString('zh-CN', { hour12: false });
    }

    function toDateTimeLocalValue(value) {
      if (!value) return '';
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function escapeHtml(text) {
      return String(text ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    function escapeJsSingleQuote(text) {
      return String(text ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    window.fetch = async function (input, init = {}) {
      const requestUrl = typeof input === 'string' ? input : input.url;
      const isAdminApi = requestUrl.startsWith('/api/admin/');
      const isLoginApi = requestUrl.startsWith('/api/admin/login');
      if (!isAdminApi) return rawFetch(input, init);

      const headers = new Headers(init.headers || {});
      const token = getAdminToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

      const res = await rawFetch(input, { ...init, headers });
      if (!isLoginApi && res.status === 401) {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminName');
        window.location.href = '/login?role=admin';
      }
      return res;
    };

    function checkAuth() {
      if (!localStorage.getItem('adminToken')) {
        window.location.href = '/login?role=admin';
        return;
      }
      const isOwner = localStorage.getItem('adminName') === 'admin';
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('admin-sidebar').classList.remove('hidden');
      document.getElementById('admin-dashboard').classList.remove('hidden');
      ensureAdminViews();
      applyAdminPermissionVisibility();
      if (isOwner) {
        ensureModelSettingsNav();
        ensureAdminAccountsNav();
      }
      const savedView = localStorage.getItem('adminActiveView') || 'dashboard';
      const allowedView = (!isOwner && ['model-settings', 'admin-accounts'].includes(savedView)) ? 'dashboard' : savedView;
      switchAdminView(allowedView);
      document.getElementById('welcome-msg').innerText = `你好，${localStorage.getItem('adminName') || ''}`;
      loadRoster().finally(() => {
        loadDashboardData();
        const sc = document.getElementById('stat-student-count');
        if (sc) sc.innerText = CLASS_ROSTER.length;
      });
    }

    async function login() {
      const u = document.getElementById('admin-user').value.trim();
      const p = document.getElementById('admin-pwd').value.trim();
      if (!u || !p) return alert('请输入账号密码');
      document.getElementById('login-btn').innerText = '验证中...';
      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: p })
        });
        if (res.ok) {
          const d = await res.json();
          localStorage.setItem('adminToken', d.token);
          localStorage.setItem('adminName', d.user);
          checkAuth();
        } else {
          document.getElementById('login-err').classList.remove('hidden');
        }
      } catch (_) { } finally {
        document.getElementById('login-btn').innerText = '安全登录';
      }
    }

    function logout() {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminName');
      window.location.href = '/login?role=admin';
    }

    function ensureAdminAccountsNav() {
      if (localStorage.getItem('adminName') !== 'admin') return;
      if (document.querySelector('[data-admin-nav="admin-accounts"]')) return;
      const auditBtn = document.querySelector('[data-admin-nav="audit"]');
      const menu = document.getElementById('sidebar-menu');
      const anchor = auditBtn || menu?.querySelector('[data-admin-nav="model-settings"]') || menu?.querySelector('[data-admin-nav="ai-rules"]');
      if (!anchor) return;
      anchor.insertAdjacentHTML('afterend', `
        <button onclick="openAdminAccountsView()" data-admin-nav="admin-accounts"
          class="text-left px-3 py-2.5 rounded-lg text-[#5e6059] hover:bg-[#e4e1d5]/50 text-xs font-bold transition-colors flex items-center gap-3">
          <svg class="w-4 h-4 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M22 11h-6"></path>
            <path d="M19 8v6"></path>
          </svg>
          管理员账号
        </button>
      `);
    }

    function ensureModelSettingsNav() {
      if (localStorage.getItem('adminName') !== 'admin') return;
      if (document.querySelector('[data-admin-nav="model-settings"]')) return;
      const aiRulesBtn = document.querySelector('[data-admin-nav="ai-rules"]');
      const auditBtn = document.querySelector('[data-admin-nav="audit"]');
      const menu = document.getElementById('sidebar-menu');
      const anchor = aiRulesBtn || auditBtn || menu?.querySelector('[data-admin-nav="students"]');
      if (!anchor) return;
      anchor.insertAdjacentHTML(aiRulesBtn ? 'afterend' : 'beforebegin', `
        <button onclick="openModelSettingsModal()" data-admin-nav="model-settings"
          class="text-left px-3 py-2.5 rounded-lg text-[#5e6059] hover:bg-[#e4e1d5]/50 text-xs font-bold transition-colors flex items-center gap-3">
          <svg class="w-4 h-4 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"></path>
            <path d="M4 4h16v12H4z"></path>
            <path d="M8 20h4"></path>
          </svg>
          模型配置
        </button>
      `);
    }

    function applyAdminPermissionVisibility() {
      const isOwner = localStorage.getItem('adminName') === 'admin';
      ['model-settings', 'admin-accounts'].forEach((view) => {
        document.querySelectorAll(`[data-admin-nav="${view}"]`).forEach((el) => {
          el.style.display = isOwner ? '' : 'none';
          el.setAttribute('aria-hidden', isOwner ? 'false' : 'true');
        });
      });
    }

    function ensureAdminViews() {
      if (document.getElementById('admin-view-dashboard')) return;
      const shell = document.querySelector('#admin-dashboard > div');
      if (!shell) return;
      const assistantPanel = shell.querySelector('.admin-assistant-panel');

      const dashboardView = document.createElement('section');
      dashboardView.id = 'admin-view-dashboard';
      dashboardView.setAttribute('data-admin-view', 'dashboard');
      Array.from(shell.childNodes)
        .filter((node) => node !== assistantPanel)
        .forEach((node) => dashboardView.appendChild(node));
      shell.appendChild(dashboardView);
      if (assistantPanel) shell.appendChild(assistantPanel);

      shell.insertAdjacentHTML('beforeend', `
        <section id="admin-view-notice" data-admin-view="notice" class="hidden">
          <div class="mb-8 flex flex-col xl:flex-row xl:items-end justify-between gap-4">
            <div>
              <p class="text-[11px] font-bold tracking-widest text-[#8a8a8a] uppercase">Announcement</p>
              <h1 class="text-4xl lg:text-5xl font-serif text-[#2c2c2c] mt-2 mb-3">修改公告</h1>
              <p class="text-sm text-[#7a7a7a] font-medium">维护面向学生端的全局公告，支持发布时间和过期时间。</p>
            </div>
            <button onclick="switchAdminView('dashboard')" class="px-4 py-2 rounded-lg bg-white text-[#5e6059] border border-[#e5e4e0] text-xs font-bold hover:bg-[#efece1] transition">返回总览</button>
          </div>
          <div class="settings-workbench">
            <div class="settings-workbench-head">
              <div>
                <p class="settings-kicker">公告设置</p>
                <h2>发布时间</h2>
              </div>
              <div class="settings-inline-grid">
                <label>
                  <span>定时发布</span>
                  <input type="datetime-local" id="edit-notice-publish">
                </label>
                <label>
                  <span>过期时间</span>
                  <input type="datetime-local" id="edit-notice-expire">
                </label>
                <button onclick="saveNotice()" id="btn-save-notice">保存公告</button>
              </div>
            </div>
            <div class="settings-main-panel">
              <label class="settings-field">
                <span>公告标题</span>
                <input type="text" id="edit-notice-title" placeholder="例如：本周作业提交提醒">
              </label>
              <label class="settings-field">
                <span>公告内容</span>
                <textarea id="edit-notice-content" rows="16" placeholder="写给学生看的公告内容..."></textarea>
              </label>
              <p id="notice-save-status" class="settings-status"></p>
            </div>
          </div>
        </section>

        <section id="admin-view-students" data-admin-view="students" class="hidden">
          <div class="mb-8 flex flex-col xl:flex-row xl:items-end justify-between gap-4">
            <div>
              <p class="text-[11px] font-bold tracking-widest text-[#8a8a8a] uppercase">Student Database</p>
              <h1 class="text-4xl lg:text-5xl font-serif text-[#2c2c2c] mt-2 mb-3">学生库</h1>
              <p class="text-sm text-[#7a7a7a] font-medium">维护学生名单、字段和密码重置。保存后提交进度会按这里的人数计算。</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button onclick="addStudentRow()" class="px-4 py-2 rounded-lg bg-[#2c2c2c] text-white text-xs font-bold hover:bg-[#4a4b46] transition">新增一行</button>
              <button onclick="saveStudentsBulk()" id="btn-save-students" class="px-4 py-2 rounded-lg bg-[#5c614e] text-white text-xs font-bold hover:bg-[#4f5443] transition">保存学生库</button>
            </div>
          </div>
          <div class="student-workbench bg-white border border-[#e5e4e0] rounded-2xl shadow-sm overflow-hidden">
            <div class="student-workbench-tools">
              <section class="student-tool-block student-tool-fields">
                <div>
                  <p class="students-toolbar-kicker">Fields</p>
                  <h2>字段设置</h2>
                </div>
                <div class="student-field-row">
                  <input id="students-columns-input" class="student-tool-input font-mono" placeholder="classname,name,id">
                  <button onclick="applyStudentColumns()" class="student-tool-button">应用字段</button>
                </div>
                <p id="students-columns-tip" class="student-tool-tip"></p>
              </section>
              <section class="student-tool-block student-tool-actions">
                <div>
                  <p class="students-toolbar-kicker">Bulk Actions</p>
                  <h2>批量操作</h2>
                </div>
                <div class="student-action-grid">
                  <button onclick="invertStudentRowSelection()">反选</button>
                  <button onclick="removeSelectedStudentRows()" class="student-danger-action">删除选中</button>
                  <button onclick="removeEmptyStudentRows()" class="student-warn-action">清空空行</button>
                </div>
                <div class="student-batch-row">
                  <input id="students-batch-count" type="number" min="1" max="2000" value="50" class="student-tool-input">
                  <button onclick="addStudentRowsBatch()">批量增行</button>
                  <button onclick="importStudentsFromText()">从文本导入</button>
                </div>
              </section>
              <section class="student-tool-block student-tool-summary">
                <div>
                  <p class="students-toolbar-kicker">Roster Records</p>
                  <h2>学生清单</h2>
                </div>
                <select id="students-class-filter" onchange="setStudentsClassFilter(this.value)" class="student-tool-select">
                  <option value="">全部班级</option>
                </select>
                <div class="students-summary-strip">
                  <span><b id="students-stat-count">0</b> 人</span>
                  <span><b id="students-stat-selected">0</b> 已选</span>
                  <span><b id="students-stat-columns">0</b> 字段</span>
                </div>
              </section>
            </div>
            <div class="students-table-shell">
              <div class="students-table-scroll">
                <div id="students-header" class="px-4 py-3 bg-[#efece1]/60 text-xs font-bold text-[#5e6059] border-b border-[#e5e4e0]"></div>
                <div id="students-rows" class="max-h-[66vh] overflow-y-auto p-4 space-y-2"></div>
              </div>
            </div>
          </div>
        </section>

        <section id="admin-view-ai-rules" data-admin-view="ai-rules" class="hidden">
          <div class="mb-8 flex flex-col xl:flex-row xl:items-end justify-between gap-4">
            <div>
              <p class="text-[11px] font-bold tracking-widest text-[#8a8a8a] uppercase">AI Rules</p>
              <h1 class="text-4xl lg:text-5xl font-serif text-[#2c2c2c] mt-2 mb-3">AI 规则</h1>
              <p class="text-sm text-[#7a7a7a] font-medium">配置全局或指定科目的 AI 规则、FAQ 和示例。</p>
            </div>
            <button onclick="saveAiRules()" id="btn-save-ai-rules" class="px-5 py-2.5 rounded-lg bg-[#2c2c2c] text-white text-xs font-bold hover:bg-[#4a4b46] transition">保存规则</button>
          </div>
          <div class="settings-workbench">
            <div class="settings-workbench-head">
              <div>
                <p class="settings-kicker">Rule Scope</p>
                <h2>规则范围</h2>
              </div>
              <div class="settings-inline-grid settings-inline-compact">
                <label>
                  <span>科目名称</span>
                  <input type="text" id="ai-rules-subject" placeholder="留空为全局规则，例如：高数作业">
                </label>
                <button onclick="loadAiRules()">读取规则</button>
              </div>
              <p id="ai-rules-status" class="settings-status"></p>
            </div>
            <div class="settings-main-panel">
              <label class="settings-field">
                <span>作业要求</span>
                <textarea id="ai-rules-instruction" rows="8" placeholder="每条一行：字数、格式、命名、截止规则..."></textarea>
              </label>
              <div class="settings-two-col">
                <label class="settings-field">
                  <span>FAQ</span>
                  <textarea id="ai-rules-faq" rows="8" placeholder="Q: 可以补交吗？ A: ..."></textarea>
                </label>
                <label class="settings-field">
                  <span>示例</span>
                  <textarea id="ai-rules-examples" rows="8" placeholder="示例命名、示例提问、示例回答..."></textarea>
                </label>
              </div>
            </div>
          </div>
        </section>

        <section id="admin-view-model-settings" data-admin-view="model-settings" class="hidden">
          <div class="mb-8 flex flex-col xl:flex-row xl:items-end justify-between gap-4">
            <div>
              <p class="text-[11px] font-bold tracking-widest text-[#8a8a8a] uppercase">Model Center</p>
              <h1 class="text-4xl lg:text-5xl font-serif text-[#2c2c2c] mt-2 mb-3">模型配置中心</h1>
              <p class="text-sm text-[#7a7a7a] font-medium">统一维护 API Key、Base URL、模型名称和请求超时。</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button onclick="testModelSettings()" id="btn-test-model-settings" class="px-5 py-2.5 rounded-lg bg-white text-[#5e6059] border border-[#e5e4e0] text-xs font-bold hover:bg-[#efece1] transition">测试连接</button>
              <button onclick="saveModelSettings()" id="btn-save-model-settings" class="px-5 py-2.5 rounded-lg bg-[#2c2c2c] text-white text-xs font-bold hover:bg-[#4a4b46] transition">保存模型配置</button>
            </div>
          </div>
          <div class="bg-white border border-[#e5e4e0] rounded-2xl p-6 shadow-sm">
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <label class="block">
                <span class="block text-[11px] font-bold text-[#8a8a8a] uppercase tracking-widest mb-2">AI Base URL</span>
                <input id="model-ai-base-url" class="w-full rounded-lg px-4 py-3 text-sm outline-none bg-[#fbf9f4] border border-[#e5e4e0] focus:border-[#5c614e]" placeholder="https://api.openai.com/v1">
              </label>
              <label class="block">
                <span class="block text-[11px] font-bold text-[#8a8a8a] uppercase tracking-widest mb-2">API Key</span>
                <input id="model-api-key" type="password" class="w-full rounded-lg px-4 py-3 text-sm outline-none bg-[#fbf9f4] border border-[#e5e4e0] focus:border-[#5c614e]" placeholder="已配置时留空表示保留；输入新 Key 可替换">
              </label>
              <label class="block">
                <span class="block text-[11px] font-bold text-[#8a8a8a] uppercase tracking-widest mb-2">轻量模型</span>
                <input id="model-light-model" class="w-full rounded-lg px-4 py-3 text-sm outline-none bg-[#fbf9f4] border border-[#e5e4e0] focus:border-[#5c614e]" placeholder="gpt-4o-mini">
              </label>
              <label class="block">
                <span class="block text-[11px] font-bold text-[#8a8a8a] uppercase tracking-widest mb-2">重模型</span>
                <input id="model-heavy-model" class="w-full rounded-lg px-4 py-3 text-sm outline-none bg-[#fbf9f4] border border-[#e5e4e0] focus:border-[#5c614e]" placeholder="gpt-4o">
              </label>
              <label class="block">
                <span class="block text-[11px] font-bold text-[#8a8a8a] uppercase tracking-widest mb-2">Embedding 模型</span>
                <input id="model-embedding-model" class="w-full rounded-lg px-4 py-3 text-sm outline-none bg-[#fbf9f4] border border-[#e5e4e0] focus:border-[#5c614e]" placeholder="text-embedding-3-small">
              </label>
              <label class="block">
                <span class="block text-[11px] font-bold text-[#8a8a8a] uppercase tracking-widest mb-2">请求超时（毫秒）</span>
                <input id="model-timeout-ms" type="number" min="5000" max="120000" class="w-full rounded-lg px-4 py-3 text-sm outline-none bg-[#fbf9f4] border border-[#e5e4e0] focus:border-[#5c614e]" placeholder="25000">
              </label>
            </div>
            <p id="model-settings-status" class="mt-5 text-[12px] text-[#7a7a7a] min-h-5"></p>
          </div>
        </section>

        <section id="admin-view-audit" data-admin-view="audit" class="hidden">
          <div class="mb-8 flex flex-col xl:flex-row xl:items-end justify-between gap-4">
            <div>
              <p class="text-[11px] font-bold tracking-widest text-[#8a8a8a] uppercase">Audit Trail</p>
              <h1 class="text-4xl lg:text-5xl font-serif text-[#2c2c2c] mt-2 mb-3">审计日志</h1>
              <p class="text-sm text-[#7a7a7a] font-medium">查看管理员和学生端的关键操作记录。</p>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <span id="audit-live-status" class="audit-live-status">实时同步准备中</span>
              <button onclick="loadAuditLogs({ silent: false })" class="px-4 py-2 rounded-lg bg-[#2c2c2c] text-white text-xs font-bold hover:bg-[#4a4b46] transition">立即同步</button>
            </div>
          </div>
          <div class="audit-panel bg-white border border-[#e5e4e0] rounded-2xl shadow-sm overflow-hidden">
            <div class="audit-panel-head">
              <div>
                <p>最近动态</p>
                <strong>自动追踪最近 300 条操作</strong>
              </div>
              <span id="audit-last-updated">尚未同步</span>
            </div>
            <div id="audit-list" class="audit-list p-4 space-y-2 max-h-[70vh] overflow-y-auto"></div>
          </div>
        </section>

        <section id="admin-view-admin-accounts" data-admin-view="admin-accounts" class="hidden">
          <div class="mb-8 flex flex-col xl:flex-row xl:items-end justify-between gap-4">
            <div>
              <p class="text-[11px] font-bold tracking-widest text-[#8a8a8a] uppercase">Admin Access</p>
              <h1 class="text-4xl lg:text-5xl font-serif text-[#2c2c2c] mt-2 mb-3">管理员账号</h1>
              <p class="text-sm text-[#7a7a7a] font-medium">修改当前账号密码，或由 admin 主账号维护其他管理员。</p>
            </div>
            <button onclick="loadAdminAccounts()" class="px-4 py-2 rounded-lg bg-[#2c2c2c] text-white text-xs font-bold hover:bg-[#4a4b46] transition">刷新列表</button>
          </div>
          <div class="settings-workbench">
            <div class="settings-workbench-head settings-account-head">
              <section class="settings-account-section">
                <p class="settings-kicker">My Password</p>
                <h2>修改我的密码</h2>
                <div class="settings-inline-grid settings-password-grid">
                  <input id="admin-old-password" type="password" placeholder="当前密码">
                  <input id="admin-new-password" type="password" placeholder="新密码，至少 6 位">
                  <input id="admin-new-password-confirm" type="password" placeholder="再次输入新密码">
                  <button onclick="changeMyAdminPassword()">保存新密码</button>
                </div>
                <p id="admin-password-status" class="settings-status"></p>
              </section>
              <section id="admin-owner-panel" class="settings-account-section hidden">
                <p class="settings-kicker">New Admin</p>
                <h2>新增管理员</h2>
                <div class="settings-inline-grid settings-admin-create-grid">
                  <input id="new-admin-username" placeholder="账号，例如 teacher01">
                  <input id="new-admin-password" type="password" placeholder="默认密码，至少 6 位">
                  <button onclick="createAdminAccount()">新增</button>
                </div>
                <p class="settings-status">新增账号首次登录后建议立刻修改密码。</p>
              </section>
            </div>
            <div class="settings-main-panel settings-list-panel">
              <div class="settings-list-head">
                <div>
                  <p class="settings-kicker">Admins</p>
                  <h2>管理员列表</h2>
                </div>
                <span id="admin-accounts-status"></span>
              </div>
              <div id="admin-accounts-list" class="settings-list-body"></div>
            </div>
          </div>
        </section>
      `);

      ['notice-modal', 'students-modal', 'ai-rules-modal', 'audit-modal', 'model-settings-modal'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
    }

    function switchAdminView(viewName = 'dashboard') {
      ensureAdminViews();
      applyAdminPermissionVisibility();
      if (localStorage.getItem('adminName') !== 'admin' && ['model-settings', 'admin-accounts'].includes(viewName)) {
        viewName = 'dashboard';
      }
      const targetView = document.getElementById(`admin-view-${viewName}`) ? viewName : 'dashboard';
      document.querySelectorAll('[data-admin-view]').forEach((el) => {
        el.classList.toggle('hidden', el.id !== `admin-view-${targetView}`);
      });
      document.querySelectorAll('[data-admin-nav]').forEach((btn) => {
        const navView = btn.getAttribute('data-admin-nav');
        if (localStorage.getItem('adminName') !== 'admin' && ['model-settings', 'admin-accounts'].includes(navView)) {
          btn.style.display = 'none';
          btn.setAttribute('aria-hidden', 'true');
          return;
        }
        btn.style.display = '';
        btn.setAttribute('aria-hidden', 'false');
        const active = btn.getAttribute('data-admin-nav') === targetView;
        btn.className = active
          ? 'text-left px-3 py-2.5 rounded-lg bg-[#e4e1d5] text-[#2c2c2c] text-xs font-bold flex items-center gap-3 shadow-sm'
          : 'text-left px-3 py-2.5 rounded-lg text-[#5e6059] hover:bg-[#e4e1d5]/50 text-xs font-bold transition-colors flex items-center gap-3';
      });
      localStorage.setItem('adminActiveView', targetView);
      const menu = document.getElementById('sidebar-menu');
      if (menu && window.innerWidth < 1024) menu.classList.add('hidden');
      if (targetView === 'audit') startAuditAutoRefresh();
      else stopAuditAutoRefresh();
      if (targetView === 'admin-accounts') loadAdminAccounts();
    }

    function openAdminAccountsView() {
      switchAdminView('admin-accounts');
    }

    function formatAdminTime(value) {
      if (!value) return '-';
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return '-';
      return d.toLocaleString('zh-CN', { hour12: false });
    }

    function renderAdminAccountItem(user, canManageAdmins) {
      const isOwner = user.username === 'admin';
      const permissionBadges = Array.isArray(user.permissions) && user.permissions.length
        ? user.permissions.map((item) => `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#edf7f1] text-[#2f7a55] border border-[#cfe8dc]">${escapeHtml(item)}</span>`).join('')
        : '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#edf7f1] text-[#2f7a55] border border-[#cfe8dc]">可配置模型</span>';
      const resetControls = canManageAdmins && !isOwner ? `
        <div class="mt-3 flex flex-col sm:flex-row gap-2">
          <input data-reset-admin="${escapeHtml(user.username)}" type="password" class="flex-1 rounded-lg px-3 py-2 text-xs outline-none bg-white border border-[#e5e4e0]" placeholder="新的临时密码">
          <button onclick="resetAdminAccount('${escapeJsSingleQuote(user.username)}')" class="px-3 py-2 rounded-lg bg-[#efece1] text-[#2c2c2c] text-xs font-bold border border-[#e5e4e0] hover:bg-[#e4e1d5]">重置密码</button>
        </div>
      ` : '';
      return `
        <article class="rounded-xl border border-[#e5e4e0] bg-[#fbf9f4] p-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-base font-bold text-[#2c2c2c]">${escapeHtml(user.username)}</h3>
                <span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${isOwner ? 'bg-[#efece1] text-[#5c614e]' : 'bg-white text-[#7a7a7a] border border-[#e5e4e0]'}">${isOwner ? '主账号' : '管理员'}</span>
                ${user.mustChangePassword ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#f4e2e2] text-[#7f2b35]">需改密码</span>' : ''}
                ${permissionBadges}
              </div>
              <p class="text-xs text-[#8a8a8a] mt-1">最近更新：${escapeHtml(formatAdminTime(user.updatedAt))}</p>
            </div>
            ${isOwner ? '<span class="text-xs text-[#7a7a7a]">请妥善保存密码</span>' : ''}
          </div>
          ${resetControls}
        </article>
      `;
    }

    async function loadAdminAccounts() {
      const list = document.getElementById('admin-accounts-list');
      const status = document.getElementById('admin-accounts-status');
      const ownerPanel = document.getElementById('admin-owner-panel');
      if (!list) return;
      list.innerHTML = '<div class="text-sm text-[#7a7a7a] p-3">正在读取管理员列表...</div>';
      try {
        const res = await fetch('/api/admin/core', {
          method: 'POST',
          body: JSON.stringify({ action: 'adminUsers' })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ? `读取失败：${data.error}` : `读取失败：HTTP ${res.status}`);
        if (ownerPanel) ownerPanel.classList.toggle('hidden', !data.canManageAdmins);
        const users = Array.isArray(data.users) ? data.users : [];
        list.innerHTML = users.length
          ? users.map((user) => renderAdminAccountItem(user, data.canManageAdmins)).join('')
          : '<div class="text-sm text-[#7a7a7a] p-3">暂无管理员</div>';
        if (status) status.textContent = `${users.length} 个账号`;
      } catch (error) {
        list.innerHTML = `<div class="text-sm text-[#7f2b35] p-3">${escapeHtml(error.message || '读取失败')}</div>`;
      }
    }

    async function changeMyAdminPassword() {
      const oldPassword = document.getElementById('admin-old-password')?.value || '';
      const newPassword = document.getElementById('admin-new-password')?.value || '';
      const confirmPassword = document.getElementById('admin-new-password-confirm')?.value || '';
      const status = document.getElementById('admin-password-status');
      if (!oldPassword || !newPassword) return alert('请填写当前密码和新密码');
      if (newPassword !== confirmPassword) return alert('两次输入的新密码不一致');
      try {
        const res = await fetch('/api/admin/core', {
          method: 'POST',
          body: JSON.stringify({ action: 'changeAdminPassword', oldPassword, newPassword })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || '淇敼澶辫触');
        ['admin-old-password', 'admin-new-password', 'admin-new-password-confirm'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });
        if (status) status.textContent = '密码已更新，下次登录请使用新密码。';
        loadAdminAccounts();
      } catch (error) {
        if (status) status.textContent = error.message || '淇敼澶辫触';
      }
    }

    async function createAdminAccount() {
      const usernameEl = document.getElementById('new-admin-username');
      const passwordEl = document.getElementById('new-admin-password');
      const username = usernameEl?.value.trim() || '';
      const password = passwordEl?.value || '';
      if (!username || !password) return alert('请填写账号和默认密码');
      try {
        const res = await fetch('/api/admin/core', {
          method: 'POST',
          body: JSON.stringify({ action: 'createAdminUser', username, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || '新增失败');
        if (usernameEl) usernameEl.value = '';
        if (passwordEl) passwordEl.value = '';
        alert('管理员已新增，请线下通知对方默认密码。');
        loadAdminAccounts();
      } catch (error) {
        alert(error.message || '新增失败');
      }
    }

    async function resetAdminAccount(username) {
      const input = document.querySelector(`[data-reset-admin="${CSS.escape(username)}"]`);
      const password = input?.value || '';
      if (!password) return alert('请输入新的临时密码');
      try {
        const res = await fetch('/api/admin/core', {
          method: 'POST',
          body: JSON.stringify({ action: 'resetAdminPassword', username, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || '重置失败');
        if (input) input.value = '';
        alert('密码已重置，请线下通知该管理员。');
        loadAdminAccounts();
      } catch (error) {
        alert(error.message || '重置失败');
      }
    }

    async function loadDashboardData() {
      const list = document.getElementById('subject-list');
      const loading = document.getElementById('subject-loading');
      const empty = document.getElementById('subject-empty');
      list.innerHTML = '';
      loading.classList.remove('hidden');
      empty.classList.add('hidden');
      try {
        const res = await fetch('/api/admin/dashboard');
        const payload = await res.json();
        const data = Array.isArray(payload) ? payload : (Array.isArray(payload.subjects) ? payload.subjects : []);
        const stats = Array.isArray(payload) ? null : (payload.stats || {});
        loading.classList.add('hidden');
        if (data.length === 0) {
          empty.classList.remove('hidden');
          const sf = document.getElementById('stat-active-folders');
          if (sf) sf.innerText = '0';
          updateSubmissionRateCard(stats, data);
          return;
        }
        const sf = document.getElementById('stat-active-folders');
        if (sf) sf.innerText = data.length;
        updateSubmissionRateCard(stats, data);
        list.innerHTML = data.map((sub) => {
          const name = String(sub.name || '');
          const submitted = Number(sub.count || 0);
          const total = Math.max(Number(sub.rosterCount || CLASS_ROSTER.length || 0), 1);
          const pct = Math.max(0, Math.min(100, Math.round((submitted / total) * 100)));
          const classText = Array.isArray(sub.classNames) && sub.classNames.length ? sub.classNames.join('、') : '全部班级';
          const safeName = escapeHtml(name);
          const jsName = escapeJsSingleQuote(name);
          const jsDeadline = escapeJsSingleQuote(String(sub.deadline || ''));
          return `
      <article class="bg-white border border-[#e5e4e0] rounded-2xl p-5 sm:p-6 hover:shadow-lg transition-all duration-300 cursor-pointer flex flex-col group hover:-translate-y-1" onclick="openExplorer('${jsName}')">
        <div class="flex items-start justify-between gap-3 mb-6">
          <h3 class="font-serif font-bold text-xl text-[#2c2c2c] break-all pr-2 line-clamp-2 leading-snug group-hover:text-[#5c614e] transition-colors flex items-start gap-2">
            <svg class="w-5 h-5 text-[#8a8a8a] shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            ${safeName}
          </h3>
          <span class="text-[10px] sm:text-[11px] px-2 py-1 rounded bg-[#efece1] text-[#7a7a7a] font-bold whitespace-nowrap uppercase tracking-wider shrink-0 border border-[#e5e4e0] flex items-center gap-1.5">
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            ${formatDeadlineText(sub.deadline)}
          </span>
        </div>
        <div class="mb-2 flex items-center justify-between text-[11px] font-bold text-[#8a8a8a] uppercase tracking-widest">
          <span>提交进度</span>
          <span class="text-[#2c2c2c]">${submitted}/${total} (${pct}%)</span>
        </div>
        <p class="mb-3 text-[11px] font-bold text-[#8a8a8a]">适用：${escapeHtml(classText)}</p>
        <div class="h-1.5 w-full bg-[#f5f4ed] rounded-full overflow-hidden mb-6"><div class="h-full bg-[#5c614e] transition-all duration-1000 ease-out" style="width:${pct}%"></div></div>
        <div class="mt-auto flex flex-wrap gap-2">
          <button onclick="event.stopPropagation(); openAiRulesModal('${jsName}')" class="px-2.5 py-1.5 bg-white text-[#5e6059] rounded text-[11px] font-bold hover:bg-[#efece1] transition border border-[#e5e4e0] flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"></path><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"></path></svg>
            规则
          </button>
          <button onclick="event.stopPropagation(); setDeadlinePrompt('${jsName}', '${jsDeadline}')" class="px-2.5 py-1.5 bg-white text-[#5e6059] rounded text-[11px] font-bold hover:bg-[#efece1] transition border border-[#e5e4e0] flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            截止
          </button>
          <button onclick="event.stopPropagation(); downloadZip('${jsName}', this)" class="px-3 py-1.5 bg-[#2c2c2c] text-white rounded text-[11px] font-bold hover:bg-[#4a4b46] transition border border-[#2c2c2c] ml-auto shadow-sm flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            打包下载
          </button>
          <button onclick="event.stopPropagation(); deleteAction('${jsName}', true)" class="px-2.5 py-1.5 bg-white text-[#7f2b35] rounded text-[11px] font-bold hover:bg-[#f4e2e2] transition border border-transparent">
            删除
          </button>
        </div>
      </article>`;
        }).join('');
      } catch (_) {
        loading.classList.add('hidden');
        list.innerHTML = `<div class="col-span-full text-center p-8 text-red-500 font-bold bg-red-50 rounded-2xl border border-red-100">获取数据失败</div>`;
      }
    }

    function updateSubmissionRateCard(stats = {}, subjects = []) {
      const rosterCount = Number(stats?.rosterCount ?? CLASS_ROSTER.length ?? 0);
      const totalExpected = Number(stats?.totalExpected ?? (rosterCount * subjects.length));
      const totalSubmitted = Number(stats?.totalSubmitted ?? subjects.reduce((sum, sub) => {
        const count = Number(sub?.count || 0);
        return sum + (rosterCount > 0 ? Math.min(count, rosterCount) : count);
      }, 0));
      const rate = totalExpected > 0
        ? Math.max(0, Math.min(100, Math.round(Number(stats?.submissionRate ?? ((totalSubmitted / totalExpected) * 100)))))
        : 0;
      const rateEl = document.getElementById('stat-submit-rate');
      const countEl = document.getElementById('stat-submit-count');
      const totalEl = document.getElementById('stat-submit-total');
      const pieEl = document.getElementById('stat-submit-pie');
      if (rateEl) rateEl.textContent = `${rate}%`;
      if (countEl) countEl.textContent = String(totalSubmitted);
      if (totalEl) totalEl.textContent = `/ ${totalExpected}`;
      if (pieEl) {
        const deg = Math.round((rate / 100) * 360);
        pieEl.style.background = `conic-gradient(#5c614e 0deg ${deg}deg, #e5e4e0 ${deg}deg 360deg)`;
      }
    }

    async function openNoticeModal() {
      switchAdminView('notice');
      const titleEl = document.getElementById('edit-notice-title');
      const contentEl = document.getElementById('edit-notice-content');
      const publishEl = document.getElementById('edit-notice-publish');
      const expireEl = document.getElementById('edit-notice-expire');
      titleEl.value = '加载中...';
      contentEl.value = '加载中...';
      publishEl.value = '';
      expireEl.value = '';
      try {
        const res = await fetch('/api/admin/core?action=noticeRaw');
        if (res.ok) {
          const data = await res.json();
          titleEl.value = data.title || '';
          contentEl.value = data.content || '';
          publishEl.value = toDateTimeLocalValue(data.publishAt || '');
          expireEl.value = toDateTimeLocalValue(data.expireAt || '');
        } else {
          titleEl.value = '';
          contentEl.value = '';
        }
      } catch (_) {
        titleEl.value = '';
        contentEl.value = '';
      }
    }

    function closeNoticeModal() {
      switchAdminView('dashboard');
    }

    async function openStudentsModal() {
      switchAdminView('students');
      const wrap = document.getElementById('students-rows');
      wrap.innerHTML = '<div class="text-xs text-gray-500 p-2">加载中...</div>';
      try {
        const res = await fetch('/api/admin/core?action=students');
        if (!res.ok) {
          return alert('读取学生库失败');
        }
        const data = await res.json();
        if (!data.d1) {
          return alert('当前未绑定 D1 数据库，请先在 Cloudflare 里绑定 DB');
        }
        studentsDraftColumns = normalizeStudentColumns(data.columns || DEFAULT_STUDENT_COLUMNS);
        document.getElementById('students-columns-input').value = studentsDraftColumns.join(',');
        studentsDraftRows = (Array.isArray(data.students) ? data.students : []).map((r) => {
          const row = {};
          studentsDraftColumns.forEach((col) => { row[col] = String(r?.[col] || '').trim(); });
          row.name = String(row.name || r?.name || '').trim();
          return row;
        });
        if (studentsDraftRows.length === 0) {
          studentsDraftRows = [Object.fromEntries(studentsDraftColumns.map((c) => [c, '']))];
        }
        renderStudentsRows();
      } catch (_) {
        studentsDraftColumns = [...DEFAULT_STUDENT_COLUMNS];
        document.getElementById('students-columns-input').value = studentsDraftColumns.join(',');
        studentsDraftRows = [Object.fromEntries(studentsDraftColumns.map((c) => [c, '']))];
        renderStudentsRows();
        alert('读取学生库失败');
      }
    }

    function closeStudentsModal() {
      switchAdminView('dashboard');
    }

    function normalizeStudentColumns(rawColumns) {
      const source = Array.isArray(rawColumns) ? rawColumns : String(rawColumns || '').split(',');
      const out = [];
      const seen = new Set();
      for (const item of source) {
        const key = String(item || '').trim().replace(/\s+/g, '');
        if (!key) continue;
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key)) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(key);
      }
      if (!seen.has('name')) out.unshift('name');
      return out.slice(0, 30);
    }

    function getStudentRowClass(row) {
      if (!row || typeof row !== 'object') return '';
      const hit = Object.keys(row).find((key) => ['classname', 'class', '班级'].includes(String(key).trim().toLowerCase()));
      return String(hit ? row[hit] : '').trim();
    }

    function renderStudentsClassFilter() {
      const select = document.getElementById('students-class-filter');
      if (!select) return;
      const classes = Array.from(new Set((studentsClassOptions || []).map((c) => String(c || '').trim()).filter(Boolean))).sort();
      select.innerHTML = `<option value="">全部班级</option>${classes.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}`;
      select.value = studentsClassFilter || '';
    }

    function setStudentsClassFilter(value) {
      studentsClassFilter = String(value || '').trim();
      selectedStudentRowIndexes = new Set();
      renderStudentsRows();
    }

    function renderSubjectClassSelect(selected = []) {
      const select = document.getElementById('subject-class-select');
      if (!select) return;
      const selectedSet = new Set((Array.isArray(selected) ? selected : []).map((item) => String(item || '').trim()).filter(Boolean));
      const classes = Array.from(new Set((studentsClassOptions || []).map((c) => String(c || '').trim()).filter(Boolean))).sort();
      select.innerHTML = classes.length
        ? classes.map((c) => `<option value="${escapeHtml(c)}" ${selectedSet.has(c) ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')
        : '<option value="" disabled>学生库里还没有班级</option>';
    }

    function getSelectedSubjectClasses() {
      const select = document.getElementById('subject-class-select');
      if (!select) return [];
      return Array.from(select.selectedOptions || [])
        .map((option) => String(option.value || '').trim())
        .filter(Boolean);
    }

    async function loadRosterForClasses(classNames = []) {
      const classes = Array.isArray(classNames) ? classNames.map((item) => String(item || '').trim()).filter(Boolean) : [];
      if (classes.length === 0) {
        if (!Array.isArray(CLASS_ROSTER) || CLASS_ROSTER.length === 0) await loadRoster();
        return CLASS_ROSTER;
      }
      const set = new Set();
      for (const className of classes) {
        const res = await fetch(`/api/admin/core?action=roster&className=${encodeURIComponent(className)}`);
        if (!res.ok) continue;
        const data = await res.json().catch(() => ({}));
        (Array.isArray(data.names) ? data.names : []).forEach((name) => set.add(name));
        if (Array.isArray(data.classes)) studentsClassOptions = data.classes;
      }
      return Array.from(set);
    }

    function applyStudentColumns() {
      const nextCols = normalizeStudentColumns(document.getElementById('students-columns-input').value);
      if (!nextCols.includes('name')) return alert('必须保留 name 列');
      const nextRows = studentsDraftRows.map((old) => {
        const row = {};
        nextCols.forEach((c) => { row[c] = String(old?.[c] || ''); });
        return row;
      });
      studentsDraftColumns = nextCols;
      selectedStudentRowIndexes = new Set();
      studentsDraftRows = nextRows.length ? nextRows : [Object.fromEntries(nextCols.map((c) => [c, '']))];
      document.getElementById('students-columns-input').value = studentsDraftColumns.join(',');
      renderStudentsRows();
    }

    function renderStudentsRows() {
      const wrap = document.getElementById('students-rows');
      const head = document.getElementById('students-header');
      if (!Array.isArray(studentsDraftColumns) || studentsDraftColumns.length === 0) {
        studentsDraftColumns = [...DEFAULT_STUDENT_COLUMNS];
      }
      if (!Array.isArray(studentsDraftRows) || studentsDraftRows.length === 0) {
        studentsDraftRows = [Object.fromEntries(studentsDraftColumns.map((c) => [c, '']))];
      }
      const validSelected = new Set();
      selectedStudentRowIndexes.forEach((i) => {
        if (i >= 0 && i < studentsDraftRows.length) validSelected.add(i);
      });
      selectedStudentRowIndexes = validSelected;
      const visibleEntries = studentsDraftRows
        .map((row, idx) => ({ row, idx }))
        .filter(({ row }) => !studentsClassFilter || getStudentRowClass(row) === studentsClassFilter);
      studentsClassOptions = Array.from(new Set(studentsDraftRows.map(getStudentRowClass).filter(Boolean))).sort();
      renderStudentsClassFilter();

      const statCount = document.getElementById('students-stat-count');
      const statSelected = document.getElementById('students-stat-selected');
      const statColumns = document.getElementById('students-stat-columns');
      if (statCount) statCount.textContent = visibleEntries.filter(({ row }) => String(row?.name || '').trim()).length;
      if (statSelected) statSelected.textContent = selectedStudentRowIndexes.size;
      if (statColumns) statColumns.textContent = studentsDraftColumns.length;
      const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every(({ idx }) => selectedStudentRowIndexes.has(idx));
      const someVisibleSelected = visibleEntries.some(({ idx }) => selectedStudentRowIndexes.has(idx));

      const gridColumns = `56px repeat(${studentsDraftColumns.length}, minmax(140px, 1fr)) 112px 96px`;
      head.className = 'student-table-header';
      head.style.display = 'grid';
      head.style.gridTemplateColumns = gridColumns;
      head.innerHTML = `<label class="student-select-cell student-select-all" title="全选当前列表"><input id="students-select-visible" type="checkbox" ${allVisibleSelected ? 'checked' : ''}><span>选择</span></label>${studentsDraftColumns.map((c) => `<div class="truncate" title="${escapeHtml(c)}">${escapeHtml(c)}</div>`).join('')}<div class="text-center">密码</div><div class="text-center">操作</div>`;
      const selectVisible = document.getElementById('students-select-visible');
      if (selectVisible) {
        selectVisible.indeterminate = !allVisibleSelected && someVisibleSelected;
        selectVisible.addEventListener('change', (e) => {
          visibleEntries.forEach(({ idx }) => {
            if (e.target.checked) selectedStudentRowIndexes.add(idx);
            else selectedStudentRowIndexes.delete(idx);
          });
          renderStudentsRows();
        });
      }

      document.getElementById('students-columns-tip').textContent = `模板可用占位符：${studentsDraftColumns.map((c) => `{${c}}`).join(' ')} {subject} {originalBase}`;

      wrap.innerHTML = visibleEntries.map(({ row, idx }) => `
    <div class="student-table-row" style="grid-template-columns: ${gridColumns};">
      <label class="student-select-cell"><input type="checkbox" data-stu-select="${idx}" ${selectedStudentRowIndexes.has(idx) ? 'checked' : ''}></label>
      ${studentsDraftColumns.map((col) => `<input data-stu-idx="${idx}" data-stu-field="${col}" value="${escapeHtml(row[col] || '')}" class="student-cell-input" placeholder="${escapeHtml(col)}">`).join('')}
      <button onclick="resetStudentPasswordByRow(${idx})" class="student-action-btn student-action-reset">重置</button>
      <button onclick="removeStudentRow(${idx})" class="student-action-btn student-action-delete">删除</button>
    </div>
  `).join('');
      wrap.querySelectorAll('input[data-stu-idx]').forEach((el) => {
        el.addEventListener('input', (e) => {
          const i = Number(e.target.getAttribute('data-stu-idx'));
          const field = String(e.target.getAttribute('data-stu-field') || '');
          if (!studentsDraftRows[i] || !field) return;
          studentsDraftRows[i][field] = e.target.value;
          if ((['name', 'classname', 'class', '班级'].includes(field.toLowerCase())) && statCount) {
            studentsClassOptions = Array.from(new Set(studentsDraftRows.map(getStudentRowClass).filter(Boolean))).sort();
            renderStudentsClassFilter();
            statCount.textContent = studentsDraftRows
              .filter((row) => !studentsClassFilter || getStudentRowClass(row) === studentsClassFilter)
              .filter((row) => String(row?.name || '').trim()).length;
          }
        });
      });
      wrap.querySelectorAll('input[data-stu-select]').forEach((el) => {
        el.addEventListener('change', (e) => {
          const i = Number(e.target.getAttribute('data-stu-select'));
          if (e.target.checked) selectedStudentRowIndexes.add(i);
          else selectedStudentRowIndexes.delete(i);
          renderStudentsRows();
        });
      });
    }

    function addStudentRow() {
      studentsDraftRows.push(Object.fromEntries(studentsDraftColumns.map((c) => [c, ''])));
      renderStudentsRows();
    }

    function addStudentRowsBatch() {
      const el = document.getElementById('students-batch-count');
      const n = Math.max(1, Math.min(2000, Number(el?.value || 50)));
      for (let i = 0; i < n; i++) {
        studentsDraftRows.push(Object.fromEntries(studentsDraftColumns.map((c) => [c, ''])));
      }
      renderStudentsRows();
    }

    function removeStudentRow(idx) {
      studentsDraftRows = studentsDraftRows.filter((_, i) => i !== idx);
      selectedStudentRowIndexes = new Set(Array.from(selectedStudentRowIndexes).filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i)));
      if (studentsDraftRows.length === 0) studentsDraftRows = [Object.fromEntries(studentsDraftColumns.map((c) => [c, '']))];
      renderStudentsRows();
    }

    async function resetStudentPasswordByRow(idx) {
      const row = studentsDraftRows[idx] || {};
      const name = String(row?.name || '').trim();
      if (!name) return alert('该行没有 name，无法重置');

      const picked = prompt(
        `重置「${name}」密码：\n输入 1 = 随机临时密码\n输入 2 = 重置为 123456\n取消 = 放弃`,
        '1'
      );
      if (picked === null) return;
      const mode = String(picked).trim() === '2' ? 'default' : 'random';
      const modeText = mode === 'default' ? '重置为 123456' : '生成随机临时密码';
      if (!confirm('确认执行：' + modeText + '\n重置后将要求该同学下次登录强制修改密码。')) return;

      try {
        const res = await fetch('/api/admin/core', {
          method: 'POST',
          body: JSON.stringify({ action: 'resetStudentPassword', name, mode })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          alert(data?.error || '重置失败');
          return;
        }
        const tempPassword = String(data.tempPassword || '');
        alert('重置成功\n学生：' + name + '\n临时密码：' + tempPassword + '\n请尽快线下通知该同学。');
      } catch (error) {
        alert(error?.message || '重置失败');
      }
    }

    function selectAllStudentRows() {
      selectedStudentRowIndexes = new Set(studentsDraftRows.map((_, i) => i));
      renderStudentsRows();
    }

    function invertStudentRowSelection() {
      const next = new Set();
      studentsDraftRows.forEach((_, i) => {
        if (!selectedStudentRowIndexes.has(i)) next.add(i);
      });
      selectedStudentRowIndexes = next;
      renderStudentsRows();
    }

    function removeSelectedStudentRows() {
      if (selectedStudentRowIndexes.size === 0) return alert('请先勾选要删除的行');
      studentsDraftRows = studentsDraftRows.filter((_, i) => !selectedStudentRowIndexes.has(i));
      selectedStudentRowIndexes = new Set();
      if (studentsDraftRows.length === 0) studentsDraftRows = [Object.fromEntries(studentsDraftColumns.map((c) => [c, '']))];
      renderStudentsRows();
    }

    function removeEmptyStudentRows() {
      studentsDraftRows = studentsDraftRows.filter((row) => {
        const hasAny = studentsDraftColumns.some((c) => String(row?.[c] || '').trim());
        return hasAny;
      });
      selectedStudentRowIndexes = new Set();
      if (studentsDraftRows.length === 0) studentsDraftRows = [Object.fromEntries(studentsDraftColumns.map((c) => [c, '']))];
      renderStudentsRows();
    }

    function importStudentsFromText() {
      const raw = prompt(`按“${studentsDraftColumns.join(',')}”顺序，一行一个粘贴导入：`, '');
      if (raw === null) return;
      const rows = String(raw || '')
        .split(/\r?\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(',').map((s) => s.trim());
          const row = {};
          studentsDraftColumns.forEach((col, idx) => { row[col] = parts[idx] || ''; });
          return row;
        })
        .filter((r) => String(r.name || '').trim());
      if (rows.length === 0) return alert('未识别到可导入数据');
      studentsDraftRows = rows;
      selectedStudentRowIndexes = new Set();
      renderStudentsRows();
    }

    async function saveStudentsBulk() {
      const btn = document.getElementById('btn-save-students');
      const columns = normalizeStudentColumns(studentsDraftColumns);
      if (!columns.includes('name')) return alert('必须保留 name 列');
      const rows = (Array.isArray(studentsDraftRows) ? studentsDraftRows : [])
        .map((r) => {
          const row = {};
          columns.forEach((c) => { row[c] = String(r?.[c] || '').trim(); });
          row.name = String(row.name || '').trim();
          return row;
        })
        .filter((r) => r.name);

      btn.textContent = '保存中...';
      btn.disabled = true;
      try {
        const res = await fetch('/api/admin/core', {
          method: 'POST',
          body: JSON.stringify({ action: 'saveStudentsBulk', columns, rows })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(err.error || '保存学生库失败');
          return;
        }
        await loadRoster();
        studentsDraftColumns = columns;
        alert('学生库已保存');
        const sc = document.getElementById('stat-student-count');
        if (sc) sc.innerText = CLASS_ROSTER.length;
      } finally {
        btn.textContent = '保存学生库';
        btn.disabled = false;
      }
    }

    function openAiRulesModal(subject = '') {
      switchAdminView('ai-rules');
      document.getElementById('ai-rules-subject').value = subject || '';
      loadAiRules();
    }

    function closeAiRulesModal() {
      switchAdminView('dashboard');
    }

    async function openModelSettingsModal() {
      switchAdminView('model-settings');
      const status = document.getElementById('model-settings-status');
      if (status) status.textContent = '正在读取模型配置...';
      try {
        const res = await fetch('/api/admin/core?action=modelSettings');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'load failed');
        const settings = data.settings || {};
        const setValue = (id, value) => {
          const el = document.getElementById(id);
          if (el) el.value = value || '';
        };
        setValue('model-ai-base-url', settings.aiBaseUrl || '');
        setValue('model-api-key', '');
        setValue('model-light-model', settings.lightModel || '');
        setValue('model-heavy-model', settings.heavyModel || '');
        setValue('model-embedding-model', settings.embeddingModel || '');
        setValue('model-timeout-ms', settings.timeoutMs || 25000);
        if (status) {
          const source = data.apiKeySource === 'store' ? '后端配置' : (data.apiKeySource === 'env' ? '环境变量' : '未配置');
          const keyHint = data.hasApiKey ? '输入框留空会保留当前 Key；填写新 Key 才会替换。' : '请填写 API Key 后保存。';
          status.textContent = `密钥状态：${data.hasApiKey ? '已配置' : '未配置'}；来源：${source}；${keyHint}`;
        }
      } catch (error) {
        if (status) status.textContent = `读取失败：${error.message || error}`;
      }
    }

    function closeModelSettingsModal() {
      switchAdminView('dashboard');
    }

    async function saveModelSettings() {
      const btn = document.getElementById('btn-save-model-settings');
      const status = document.getElementById('model-settings-status');
      const readValue = (id) => String(document.getElementById(id)?.value || '').trim();
      if (btn) {
        btn.textContent = '保存中...';
        btn.disabled = true;
      }
      try {
        const res = await fetch('/api/admin/core', {
          method: 'POST',
          body: JSON.stringify({
            action: 'setModelSettings',
            aiBaseUrl: readValue('model-ai-base-url'),
            apiKey: readValue('model-api-key'),
            clearApiKey: false,
            lightModel: readValue('model-light-model'),
            heavyModel: readValue('model-heavy-model'),
            embeddingModel: readValue('model-embedding-model'),
            timeoutMs: readValue('model-timeout-ms')
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          alert(data.error || '保存模型配置失败');
          return;
        }
        if (status) {
          const source = data.apiKeySource === 'store' ? '后端配置' : (data.apiKeySource === 'env' ? '环境变量' : '未配置');
          status.textContent = `已保存：${new Date().toLocaleString('zh-CN', { hour12: false })}；密钥状态：${data.hasApiKey ? '已配置' : '未配置'}；来源：${source}`;
        }
        alert('模型配置已保存');
      } finally {
        if (btn) {
          btn.textContent = '保存模型配置';
          btn.disabled = false;
        }
      }
    }

    async function testModelSettings() {
      const btn = document.getElementById('btn-test-model-settings');
      const status = document.getElementById('model-settings-status');
      const readValue = (id) => String(document.getElementById(id)?.value || '').trim();
      if (btn) {
        btn.textContent = '测试中...';
        btn.disabled = true;
      }
      if (status) status.textContent = '正在测试当前模型配置...';
      try {
        const res = await fetch('/api/admin/core', {
          method: 'POST',
          body: JSON.stringify({
            action: 'testModelSettings',
            aiBaseUrl: readValue('model-ai-base-url'),
            apiKey: readValue('model-api-key'),
            lightModel: readValue('model-light-model'),
            heavyModel: readValue('model-heavy-model'),
            embeddingModel: readValue('model-embedding-model'),
            timeoutMs: readValue('model-timeout-ms')
          })
        });
        const raw = await res.text();
        let data = {};
        try {
          data = JSON.parse(raw);
        } catch {
          const text = String(raw || res.statusText || '').trim();
          data = {
            error: text === 'Bad Request'
              ? '后端还没加载测试接口，请重启本地服务后再试。'
              : text
          };
        }
        if (!res.ok || !data.success) {
          if (status) status.textContent = `测试失败：${data.error || '模型连接失败'}`;
          return;
        }
        if (status) {
          status.textContent = `测试成功：${data.model}，耗时 ${data.latencyMs}ms，返回：${data.sample || 'OK'}`;
        }
      } catch (error) {
        if (status) status.textContent = `测试失败：${error.message || error}`;
      } finally {
        if (btn) {
          btn.textContent = '测试连接';
          btn.disabled = false;
        }
      }
    }

    async function loadAiRules() {
      const subject = document.getElementById('ai-rules-subject').value.trim();
      const url = `/api/admin/core?action=aiRules&subject=${encodeURIComponent(subject)}`;
      const res = await fetch(url);
      if (!res.ok) {
        alert('读取 AI 规则失败');
        return;
      }
      const data = await res.json();
      const isSubject = Boolean(subject);
      const rule = isSubject ? (data.subjectRule || {}) : (data.globalRule || {});
      document.getElementById('ai-rules-instruction').value = rule.requirements || rule.instruction || '';
      document.getElementById('ai-rules-faq').value = rule.faq || '';
      document.getElementById('ai-rules-examples').value = rule.examples || '';
    }

    async function saveAiRules() {
      const subject = document.getElementById('ai-rules-subject').value.trim();
      const requirements = document.getElementById('ai-rules-instruction').value.trim();
      const faq = document.getElementById('ai-rules-faq').value.trim();
      const examples = document.getElementById('ai-rules-examples').value.trim();
      const btn = document.getElementById('btn-save-ai-rules');
      btn.textContent = '保存中...';
      btn.disabled = true;
      try {
        const res = await fetch('/api/admin/core', {
          method: 'POST',
          body: JSON.stringify({ action: 'setAiRules', subject, requirements, faq, examples })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(err.error || '保存失败');
          return;
        }
        const status = document.getElementById('ai-rules-status');
        if (status) status.textContent = `已保存：${new Date().toLocaleString('zh-CN', { hour12: false })}`;
        alert('AI 规则已保存');
      } finally {
        btn.textContent = '保存规则';
        btn.disabled = false;
      }
    }

    async function saveNotice() {
      const title = document.getElementById('edit-notice-title').value.trim();
      const content = document.getElementById('edit-notice-content').value.trim();
      const publishAt = document.getElementById('edit-notice-publish').value.trim();
      const expireAt = document.getElementById('edit-notice-expire').value.trim();
      if (!title || !content) return alert('标题和内容不能为空');
      const btn = document.getElementById('btn-save-notice');
      btn.innerText = '保存中...';
      try {
        const res = await fetch('/api/admin/core', { method: 'POST', body: JSON.stringify({ action: 'updateNotice', title, content, publishAt, expireAt }) });
        if (res.ok) {
          const status = document.getElementById('notice-save-status');
          if (status) status.textContent = `已保存：${new Date().toLocaleString('zh-CN', { hour12: false })}`;
          alert('公告更新成功，学生端刷新即可看到。');
        } else {
          alert('保存失败，请稍后重试。');
        }
      } catch (_) {
        alert('网络错误');
      } finally {
        btn.innerText = '保存发布';
      }
    }

    function switchExplorerTab(tabId) {
      const tabs = ['files', 'roster', 'grading', 'automation'];
      tabs.forEach(t => {
        const el = document.getElementById('explorer-tab-' + t);
        if (el) el.classList.add('hidden');
        const btn = document.getElementById('tab-btn-' + t);
        if (btn) btn.className = 'text-left px-3 py-2.5 rounded-lg text-[#5e6059] hover:bg-[#e4e1d5]/50 text-xs font-bold transition-colors flex items-center gap-3';
      });
      const targetEl = document.getElementById('explorer-tab-' + tabId);
      if (targetEl) targetEl.classList.remove('hidden');
      const activeBtn = document.getElementById('tab-btn-' + tabId);
      if (activeBtn) activeBtn.className = 'text-left px-3 py-2.5 rounded-lg bg-[#e4e1d5] text-[#2c2c2c] text-xs font-bold flex items-center gap-3 transition-colors shadow-sm';
    }

    async function openExplorer(subject) {
      currentExplorerSubject = subject;
      currentExplorerViewMode = 'folder';
      currentExpandedUploader = new Set();
      switchExplorerTab('files');
      if (!Array.isArray(CLASS_ROSTER) || CLASS_ROSTER.length === 0) {
        await loadRoster();
      }
      document.getElementById('explorer-search').value = '';
      document.getElementById('exempt-name-input').value = '';
      document.getElementById('explorer-title').innerText = `馃摠 ${subject}`;
      document.getElementById('explorer-modal').classList.remove('hidden');
      const fileListEl = document.getElementById('explorer-file-list');
      fileListEl.innerHTML = `<div class="text-center py-10 text-gray-500 font-bold">正在扫描云端文件...</div>`;

      try {
        await loadSubjectSettings();
        currentEligibleRoster = await loadRosterForClasses(currentSubjectSettings.classNames || []);
        const res = await fetch(`/api/admin/core?action=files&folder=${encodeURIComponent(subject)}`);
        const data = await res.json();
        currentExplorerFiles = Array.isArray(data.files) ? data.files : [];

        document.getElementById('file-count').innerText = `共 ${currentExplorerFiles.length} 个`;
        const submittedNames = new Set(currentExplorerFiles.map((f) => f.key.split('/')[1]));
        const eligibleSet = new Set(currentEligibleRoster);
        const submittedEligibleNames = currentEligibleRoster.length
          ? Array.from(submittedNames).filter((name) => eligibleSet.has(name))
          : Array.from(submittedNames);
        const missingNames = currentEligibleRoster.filter((n) => !submittedNames.has(n));
        currentSubmittedNames = submittedEligibleNames;
        currentMissingNames = missingNames;

        document.getElementById('missing-count').innerText = `${missingNames.length} 人`;
        document.getElementById('missing-list').innerHTML = missingNames.map((n) => `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-white text-[#7f2b35] border border-[#f4e2e2] shadow-sm">${n}</span>`).join('');
        document.getElementById('submitted-count').innerText = `${submittedEligibleNames.length} 人`;
        document.getElementById('submitted-list').innerHTML = submittedEligibleNames.map((n) => `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-[#efece1] text-[#5c614e] border border-[#e5e4e0] shadow-sm">${n}</span>`).join('');

        if (currentExplorerFiles.length === 0) {
          fileListEl.innerHTML = `<div class="text-center py-10 text-gray-500 font-bold">该科目下暂无文件</div>`;
          await loadExemptions();
          await loadGrades();
          return;
        }

        await loadExplorerHistoryMeta();
        await loadAssignmentRequirement();
        await loadNamingRule();
        await loadExemptions();
        await loadGrades();
        renderExplorerFiles(currentExplorerFiles);
      } catch (_) {
        fileListEl.innerHTML = `<div class="text-center py-10 text-red-500 font-bold">读取失败</div>`;
      }
    }

    async function loadExplorerHistoryMeta() {
      currentReceiptMap = {};
      currentSubmitMetaMap = {};
      if (!currentExplorerSubject || currentExplorerFiles.length === 0) return;
      const names = Array.from(new Set(currentExplorerFiles.map((f) => String(f.key || '').split('/')[1]).filter(Boolean)));
      const subjectPrefix = `${currentExplorerSubject}/`;
      const tasks = names.map(async (name) => {
        try {
          const res = await fetch(`/api/admin/core?action=historyByName&name=${encodeURIComponent(name)}`);
          if (!res.ok) return;
          const data = await res.json();
          const history = Array.isArray(data.history) ? data.history : [];
          history.forEach((item) => {
            const path = String(item?.fullPath || '');
            if (!path.startsWith(subjectPrefix)) return;
            if (item?.receiptCode && !currentReceiptMap[path]) {
              currentReceiptMap[path] = String(item.receiptCode);
            }
            if (!currentSubmitMetaMap[path]) {
              currentSubmitMetaMap[path] = {
                submitMode: String(item?.submitMode || '').toLowerCase(),
                submitCount: Number(item?.submitCount || 0)
              };
            }
          });
        } catch (_) { }
      });
      await Promise.all(tasks);
    }

    async function loadNamingRule() {
      const input = document.getElementById('naming-template-input');
      input.value = '';
      if (!currentExplorerSubject) return;
      try {
        const res = await fetch(`/api/admin/core?action=namingRule&subject=${encodeURIComponent(currentExplorerSubject)}`);
        if (!res.ok) return;
        const data = await res.json();
        input.value = data.template || '';
      } catch (_) { }
    }

    async function loadSubjectSettings() {
      currentSubjectSettings = { allowedExtensions: [], plagiarismMode: 'normal', classNames: [] };
      const extInput = document.getElementById('subject-extensions-input');
      const modeInput = document.getElementById('subject-plagiarism-mode');
      const status = document.getElementById('subject-settings-status');
      if (extInput) extInput.value = '';
      if (modeInput) modeInput.value = 'normal';
      renderSubjectClassSelect([]);
      if (status) status.textContent = '';
      if (!currentExplorerSubject) return;
      try {
        const res = await fetch(`/api/admin/core?action=subjectSettings&subject=${encodeURIComponent(currentExplorerSubject)}`);
        if (!res.ok) return;
        const data = await res.json();
        currentSubjectSettings = data.settings || currentSubjectSettings;
        if (extInput) extInput.value = (currentSubjectSettings.customAllowedExtensions || currentSubjectSettings.allowedExtensions || []).join(',');
        if (modeInput) modeInput.value = currentSubjectSettings.plagiarismMode || 'normal';
        renderSubjectClassSelect(currentSubjectSettings.classNames || []);
        if (status) {
          status.textContent = currentSubjectSettings.updatedAt
            ? `上次更新：${new Date(currentSubjectSettings.updatedAt).toLocaleString('zh-CN', { hour12: false })}`
            : '使用默认配置';
        }
      } catch (_) {
        if (status) status.textContent = '读取失败';
      }
    }

    async function saveSubjectSettings() {
      if (!currentExplorerSubject) return;
      const extInput = document.getElementById('subject-extensions-input');
      const modeInput = document.getElementById('subject-plagiarism-mode');
      const status = document.getElementById('subject-settings-status');
      const btn = document.getElementById('btn-save-subject-settings');
      const allowedExtensions = String(extInput?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      const plagiarismMode = String(modeInput?.value || 'normal');
      const classNames = getSelectedSubjectClasses();
      if (btn) {
        btn.textContent = '保存中...';
        btn.disabled = true;
      }
      try {
        const res = await fetch('/api/admin/core', {
          method: 'POST',
          body: JSON.stringify({ action: 'setSubjectSettings', subject: currentExplorerSubject, allowedExtensions, plagiarismMode, classNames })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) return alert(data?.error || '保存提交规则失败');
        currentSubjectSettings = data.settings || currentSubjectSettings;
        if (status) status.textContent = `已保存：${new Date().toLocaleString('zh-CN', { hour12: false })}`;
        alert('提交规则已保存');
        loadDashboardData();
      } finally {
        if (btn) {
          btn.textContent = '保存提交规则';
          btn.disabled = false;
        }
      }
    }

    async function loadAssignmentRequirement() {
      const input = document.getElementById('assignment-requirement-input');
      const status = document.getElementById('assignment-requirement-status');
      if (!input) return;
      input.value = '';
      if (status) status.textContent = '';
      if (!currentExplorerSubject) return;
      try {
        const res = await fetch(`/api/admin/core?action=assignmentRequirement&subject=${encodeURIComponent(currentExplorerSubject)}`);
        if (!res.ok) {
          if (status) status.textContent = '读取失败';
          return;
        }
        const data = await res.json();
        input.value = data?.requirement?.content || '';
        if (status) {
          status.textContent = data?.requirement?.updatedAt
            ? `上次更新：${new Date(data.requirement.updatedAt).toLocaleString('zh-CN', { hour12: false })}`
            : '尚未填写';
        }
      } catch (_) {
        if (status) status.textContent = '读取失败';
      }
    }

    async function saveAssignmentRequirement() {
      if (!currentExplorerSubject) return;
      const input = document.getElementById('assignment-requirement-input');
      const status = document.getElementById('assignment-requirement-status');
      const btn = document.getElementById('btn-save-assignment-requirement');
      const content = String(input?.value || '').trim();
      if (content.length > 20000) return alert('作业要求不能超过 20000 字');
      if (btn) {
        btn.textContent = '保存中...';
        btn.disabled = true;
      }
      try {
        const res = await fetch('/api/admin/core', {
          method: 'POST',
          body: JSON.stringify({ action: 'setAssignmentRequirement', subject: currentExplorerSubject, content })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return alert(err.error || '保存作业要求失败');
        }
        const data = await res.json().catch(() => ({}));
        if (status) {
          status.textContent = data?.requirement?.updatedAt
            ? `已保存：${new Date(data.requirement.updatedAt).toLocaleString('zh-CN', { hour12: false })}`
            : '已清空';
        }
        alert(content ? '作业要求已保存' : '作业要求已清空');
      } finally {
        if (btn) {
          btn.textContent = '保存作业要求';
          btn.disabled = false;
        }
      }
    }

    async function saveNamingRule() {
      if (!currentExplorerSubject) return;
      const input = document.getElementById('naming-template-input');
      const template = (input.value || '').trim();
      const res = await fetch('/api/admin/core', {
        method: 'POST',
        body: JSON.stringify({ action: 'setNamingRule', subject: currentExplorerSubject, template })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return alert(err.error || '保存命名规则失败');
      }
      alert(template ? '命名规则已保存' : '命名规则已清空');
    }

    function getUploaderFromKey(key) {
      return String(key || '').split('/')[1] || '未识别提交人';
    }

    function renderExplorerFileCard(file) {
      const fileName = file.key.split('/').pop();
      const uploader = getUploaderFromKey(file.key);
      const downloadUrl = appendAdminToken('/api/admin/core?action=download&key=' + encodeURIComponent(file.key));
      const receiptCode = currentReceiptMap[file.key] || '';
      const meta = currentSubmitMetaMap[file.key] || {};
      const mode = String(meta.submitMode || '').toLowerCase();
      const count = Number(meta.submitCount || 0);
      const ext = fileName.split('.').pop().toLowerCase();
      const plagiarism = file.plagiarism || {};
      const plagiarismScore = Number(plagiarism.maxSimilarity || 0);
      const plagiarismText = plagiarism.checkedAt
        ? (plagiarismScore >= 90 ? `High ${plagiarismScore}%` : plagiarismScore >= 70 ? `Similar ${plagiarismScore}%` : `OK ${plagiarismScore}%`)
        : 'Not checked';
      const plagiarismClass = plagiarism.checkedAt
        ? (plagiarismScore >= 90
          ? 'bg-[#fff0f1] text-[#9f1d2a] border-[#f0c7cc]'
          : plagiarismScore >= 70
            ? 'bg-[#fff8ea] text-[#8a5a12] border-[#efd79f]'
            : 'bg-[#eef8f1] text-[#2f5f4a] border-[#d8e5dc]')
        : 'bg-[#fbf9f4] text-[#8a8a8a] border-[#e5e4e0]';

      let docIcon = `<svg class="w-10 h-10 text-[#8a8a8a]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
      if (ext === 'pdf') docIcon = `<svg class="w-10 h-10 text-[#7f2b35]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M9 15v-4"></path><path d="M12 15v-4"></path><path d="M15 15v-4"></path></svg>`;

      let gradeVal = '';
      if (currentGrades && currentGrades[uploader]) {
        gradeVal = currentGrades[uploader].score || '';
      }

      return `
  <div class="bg-white border border-[#e5e4e0] rounded-2xl p-4 flex flex-col hover:shadow-md hover:border-[#5c614e] transition-all relative group shadow-sm h-[140px]">
    <!-- Action buttons overlay -->
    <div class="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 z-10">
      <button onclick="openPreview('${escapeJsSingleQuote(file.key)}')" class="p-1.5 bg-white text-[#5e6059] rounded-lg text-xs hover:bg-[#efece1] transition border border-[#e5e4e0] shadow-sm" title="预览">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
      </button>
      <a href="${downloadUrl}" class="p-1.5 bg-white text-[#5e6059] rounded-lg text-xs hover:bg-[#efece1] transition border border-[#e5e4e0] shadow-sm" title="下载">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      </a>
      <button onclick="deleteAction('${file.key}', false)" class="p-1.5 bg-white text-[#7f2b35] rounded-lg text-xs hover:bg-[#f4e2e2] transition border border-[#e5e4e0] shadow-sm" title="删除">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
      <button onclick="runPlagiarismForFile('${escapeJsSingleQuote(file.key)}')" class="p-1.5 bg-white text-[#5c614e] rounded-lg text-xs hover:bg-[#efece1] transition border border-[#e5e4e0] shadow-sm" title="查重">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
      </button>
    </div>

    <!-- Content Layout -->
    <div class="flex gap-4 items-start w-full h-full">
      <div class="shrink-0 flex items-center justify-center w-[60px] h-[80px] bg-[#fbf9f4] border border-[#e5e4e0] rounded-lg relative mt-1">
        ${docIcon}
        <span class="absolute bottom-1 right-1 bg-[#2c2c2c] text-white text-[8px] font-bold px-1 py-0.5 rounded uppercase leading-none">${ext.substring(0, 4)}</span>
      </div>
      <div class="flex-1 min-w-0 flex flex-col justify-between h-full">
        <div>
          <h4 class="font-bold text-[#2c2c2c] text-[13px] truncate" title="${uploader}">${uploader}</h4>
          <p class="text-[10px] text-[#8a8a8a] mt-0.5 truncate" title="${fileName}">${fileName}</p>
          <button onclick="showPlagiarismDetail('${escapeJsSingleQuote(file.key)}')" class="mt-2 inline-flex w-fit max-w-full px-2 py-0.5 rounded-full border text-[10px] font-bold ${plagiarismClass}" title="点击查看查重详情">${plagiarismText}</button>
        </div>
        
        <div class="mt-auto">
          <p class="text-[9px] font-bold text-[#5e6059] uppercase tracking-wider mb-1">Quick Grade</p>
          <div class="flex items-center gap-1.5">
            <input type="text" 
                   value="${gradeVal}"
                   placeholder="Enter..." 
                   class="w-full text-[11px] font-bold bg-white border border-[#e5e4e0] rounded-md px-2 py-1 outline-none focus:border-[#5c614e] transition-colors"
                   onblur="quickSaveGrade('${escapeJsSingleQuote(uploader)}', this.value)"
                   >
            <span class="text-[10px] text-[#8a8a8a] font-bold shrink-0">/100</span>
          </div>
        </div>
      </div>
    </div>
  </div>`;
    }

    function setExplorerViewMode(mode) {
      currentExplorerViewMode = mode === 'flat' ? 'flat' : 'folder';
      const folderBtn = document.getElementById('view-mode-folder-btn');
      const flatBtn = document.getElementById('view-mode-flat-btn');
      if (folderBtn && flatBtn) {
        const activeClass = 'px-3 py-1.5 rounded-md text-[11px] font-bold bg-[#2c2c2c] text-white border border-[#2c2c2c] flex items-center gap-1.5 transition shadow-sm';
        const inactiveClass = 'px-3 py-1.5 rounded-md text-[11px] font-bold bg-white text-[#5e6059] border border-[#e5e4e0] hover:bg-[#fbf9f4] flex items-center gap-1.5 transition';
        if (currentExplorerViewMode === 'folder') {
          folderBtn.className = activeClass;
          flatBtn.className = inactiveClass;
        } else {
          folderBtn.className = inactiveClass;
          flatBtn.className = activeClass;
        }
      }
      renderExplorerFiles(currentExplorerFiles);
    }

    function toggleUploaderFolder(uploader) {
      if (currentExpandedUploader.has(uploader)) currentExpandedUploader.delete(uploader);
      else currentExpandedUploader.add(uploader);
      renderExplorerFiles(currentExplorerFiles);
    }

    async function runPlagiarismForFile(fileKey) {
      if (!currentExplorerSubject || !fileKey) return;
      if (!confirm('确定要对这个文件执行查重吗？')) return;
      try {
        const res = await fetch('/api/admin/core', {
          method: 'POST',
          body: JSON.stringify({ action: 'runPlagiarismCheck', subject: currentExplorerSubject, key: fileKey })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) return alert(data?.error || '查重失败');
        const idx = currentExplorerFiles.findIndex((f) => f.key === fileKey);
        if (idx >= 0) currentExplorerFiles[idx] = { ...currentExplorerFiles[idx], plagiarism: data.result };
        renderExplorerFiles(currentExplorerFiles);
        showPlagiarismDetail(fileKey);
      } catch (error) {
        alert(error?.message || '查重失败');
      }
    }

    function showPlagiarismDetail(fileKey) {
      const file = currentExplorerFiles.find((f) => f.key === fileKey) || {};
      const result = file.plagiarism || {};
      if (!result.checkedAt) {
        alert('This file has not been checked yet. Click the search icon on the file card to run plagiarism check.');
        return;
      }
      const matches = Array.isArray(result.matches) ? result.matches : [];
      const detail = matches.length
        ? matches.slice(0, 8).map((m, i) => `${i + 1}. ${m.uploader || '-'} / ${m.fileName || '-'} / ${m.similarity || 0}% / ${m.reason || 'similar'}`).join('\n')
        : 'No obvious similar files found.';
      alert([
        `Status: ${result.status || 'ok'}`,
        `Mode: ${result.mode || 'normal'} / ${result.engine || 'normal'}`,
        `Max similarity: ${result.maxSimilarity || 0}%`,
        `Checked at: ${new Date(result.checkedAt).toLocaleString('zh-CN', { hour12: false })}`,
        result.note ? `Note: ${result.note}` : '',
        '',
        detail
      ].filter(Boolean).join('\n'));
    }
    function renderExplorerFiles(files) {
      const fileListEl = document.getElementById('explorer-file-list');
      const keyword = (document.getElementById('explorer-search').value || '').trim().toLowerCase();
      const filtered = !keyword ? files : files.filter((file) => {
        const key = String(file.key || '').toLowerCase();
        const fileName = key.split('/').pop() || '';
        const uploader = key.split('/')[1] || '';
        const receipt = String(currentReceiptMap[file.key] || '').toLowerCase();
        return fileName.includes(keyword) || uploader.includes(keyword) || receipt.includes(keyword);
      });

      const grouped = filtered.reduce((acc, file) => {
        const uploader = getUploaderFromKey(file.key);
        if (!acc[uploader]) acc[uploader] = [];
        acc[uploader].push(file);
        return acc;
      }, {});
      const uploaderCount = Object.keys(grouped).length;
      if (currentExplorerViewMode === 'folder') {
        document.getElementById('file-count').innerText = keyword
          ? `筛选：${uploaderCount} 个文件夹 / ${filtered.length} 个文件`
          : `共 ${uploaderCount} 个文件夹 / ${files.length} 个文件`;
      } else {
        document.getElementById('file-count').innerText = keyword ? `筛选：${filtered.length} / ${files.length}` : `共 ${files.length} 个`;
      }
      if (filtered.length === 0) {
        fileListEl.innerHTML = `<div class="text-center py-10 text-gray-500 font-bold">没有匹配的文件</div>`;
        return;
      }

      if (currentExplorerViewMode === 'flat') {
        fileListEl.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-4">${filtered.map((file) => renderExplorerFileCard(file)).join('')}</div>`;
        return;
      }

      fileListEl.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-4">` + Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0], 'zh-CN')).map(([uploader, items]) => {
        const totalSize = items.reduce((sum, f) => sum + Number(f.size || 0), 0);
        const isOpen = currentExpandedUploader.has(uploader);
        const uploaderJs = escapeJsSingleQuote(uploader);
        return `
    <div class="rounded-xl border border-[#e5e4e0] bg-[#fbf9f4] overflow-hidden shadow-sm self-start flex flex-col transition-all">
      <button onclick="toggleUploaderFolder('${uploaderJs}')" class="w-full p-4 flex items-center justify-between gap-3 hover:bg-[#efece1] transition">
        <div class="text-left min-w-0">
          <p class="font-bold text-[#2c2c2c] text-sm truncate flex items-center gap-2">
            <svg class="w-4 h-4 text-[#8a8a8a] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            <span class="truncate">${escapeHtml(uploader)}</span>
          </p>
          <p class="text-[11px] text-[#8a8a8a] font-bold mt-1.5 ml-6">${items.length} 文件 · ${(totalSize / 1024 / 1024).toFixed(2)} MB</p>
        </div>
        <span class="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-bold ${isOpen ? 'bg-[#e4e1d5] text-[#2c2c2c]' : 'bg-white text-[#5e6059] border border-[#e5e4e0]'} transition-colors">${isOpen ? '收起' : '展开'}</span>
      </button>
      ${isOpen ? `<div class="p-3 bg-[#fbf9f4] border-t border-[#e5e4e0]/50 flex flex-col gap-3">${items.map((file) => renderExplorerFileCard(file)).join('')}</div>` : ''}
    </div>`;
      }).join('') + `</div>`;
    }

    function getFileExtFromKey(key) {
      const name = String(key || '').split('/').pop() || '';
      const idx = name.lastIndexOf('.');
      return idx >= 0 ? name.slice(idx).toLowerCase() : '';
    }

    function closePreviewModal() {
      document.getElementById('preview-modal').classList.add('hidden');
      document.getElementById('preview-title').textContent = '文件预览';
      document.getElementById('preview-body').innerHTML = '';
      const gradePanel = document.getElementById('preview-grade-panel');
      if (gradePanel) gradePanel.classList.add('hidden');
      document.getElementById('image-zoom-tools').classList.add('hidden');
      window.onmousemove = null;
      window.onmouseup = null;
      previewImageScale = 1;
      previewImageOffsetX = 0;
      previewImageOffsetY = 0;
      previewDragging = false;
      currentPreviewFileKey = '';
      currentPreviewUploader = '';
    }

    function applyImageZoom() {
      const img = document.getElementById('preview-image');
      const percent = document.getElementById('image-zoom-percent');
      if (!img || !percent) return;
      img.style.transform = `translate(${previewImageOffsetX}px, ${previewImageOffsetY}px) scale(${previewImageScale})`;
      percent.textContent = `${Math.round(previewImageScale * 100)}%`;
      img.style.cursor = previewImageScale > 1 ? (previewDragging ? 'grabbing' : 'grab') : 'default';
    }

    function zoomImage(step) {
      previewImageScale = Math.max(0.2, Math.min(5, previewImageScale + step));
      if (previewImageScale <= 1) {
        previewImageOffsetX = 0;
        previewImageOffsetY = 0;
      }
      applyImageZoom();
    }

    function resetImageZoom() {
      previewImageScale = 1;
      previewImageOffsetX = 0;
      previewImageOffsetY = 0;
      applyImageZoom();
    }

    function startImageDrag(clientX, clientY) {
      if (previewImageScale <= 1) return;
      previewDragging = true;
      previewDragStartX = clientX;
      previewDragStartY = clientY;
      applyImageZoom();
    }

    function moveImageDrag(clientX, clientY) {
      if (!previewDragging) return;
      const dx = clientX - previewDragStartX;
      const dy = clientY - previewDragStartY;
      previewDragStartX = clientX;
      previewDragStartY = clientY;
      previewImageOffsetX += dx;
      previewImageOffsetY += dy;
      applyImageZoom();
    }

    function endImageDrag() {
      if (!previewDragging) return;
      previewDragging = false;
      applyImageZoom();
    }

    async function openPreview(fileKey) {
      const ext = getFileExtFromKey(fileKey);
      const fileName = String(fileKey || '').split('/').pop() || fileKey;
      currentPreviewFileKey = fileKey;
      currentPreviewUploader = getUploaderFromKey(fileKey);
      const gradePanel = document.getElementById('preview-grade-panel');
      const scoreInput = document.getElementById('preview-grade-score');
      const commentInput = document.getElementById('preview-grade-comment');
      const g = currentGrades[currentPreviewUploader] || {};
      if (gradePanel) gradePanel.classList.remove('hidden');
      if (scoreInput) scoreInput.value = g.score || '';
      if (commentInput) commentInput.value = g.comment || '';
      const relPreviewUrl = appendAdminToken('/api/admin/core?action=preview&key=' + encodeURIComponent(fileKey));
      const absPreviewUrl = `${window.location.origin}${relPreviewUrl}`;
      const body = document.getElementById('preview-body');
      const zoomTools = document.getElementById('image-zoom-tools');
      document.getElementById('preview-title').textContent = `预览：${fileName}`;
      document.getElementById('preview-modal').classList.remove('hidden');
      zoomTools.classList.add('hidden');
      previewImageScale = 1;
      previewImageOffsetX = 0;
      previewImageOffsetY = 0;
      previewDragging = false;

      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
      const textExts = ['.txt', '.md', '.json', '.csv', '.log'];
      const officeExts = ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'];

      if (imageExts.includes(ext)) {
        body.innerHTML = `<div id="preview-image-wrap" class="w-full h-full flex items-center justify-center bg-slate-100 overflow-auto"><img id="preview-image" src="${relPreviewUrl}" alt="preview" class="max-w-full max-h-full object-contain transition-transform duration-100" style="transform-origin:center center; transform:scale(1)"></div>`;
        zoomTools.classList.remove('hidden');
        zoomTools.classList.add('flex');
        applyImageZoom();
        const wrap = document.getElementById('preview-image-wrap');
        wrap.onwheel = (e) => {
          e.preventDefault();
          zoomImage(e.deltaY > 0 ? -0.1 : 0.1);
        };
        wrap.onmousedown = (e) => {
          e.preventDefault();
          startImageDrag(e.clientX, e.clientY);
        };
        window.onmousemove = (e) => moveImageDrag(e.clientX, e.clientY);
        window.onmouseup = () => endImageDrag();
        wrap.ontouchstart = (e) => {
          if (e.touches.length !== 1) return;
          startImageDrag(e.touches[0].clientX, e.touches[0].clientY);
        };
        wrap.ontouchmove = (e) => {
          if (e.touches.length !== 1) return;
          moveImageDrag(e.touches[0].clientX, e.touches[0].clientY);
        };
        wrap.ontouchend = () => endImageDrag();
        return;
      }
      if (ext === '.pdf') {
        body.innerHTML = `<iframe src="${relPreviewUrl}" class="w-full h-full border-0"></iframe>`;
        return;
      }
      if (textExts.includes(ext)) {
        body.innerHTML = `<div class="w-full h-full p-4 text-sm text-gray-500">加载中...</div>`;
        try {
          const res = await fetch(relPreviewUrl);
          const text = await res.text();
          body.innerHTML = `<pre class="w-full h-full m-0 p-4 overflow-auto text-xs sm:text-sm text-gray-800 whitespace-pre-wrap">${escapeHtml(text)}</pre>`;
        } catch (_) {
          body.innerHTML = `<div class="w-full h-full p-4 text-sm text-red-500">文本预览失败，请下载查看。</div>`;
        }
        return;
      }
      if (officeExts.includes(ext)) {
        const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absPreviewUrl)}`;
        body.innerHTML = `
      <div class="w-full h-full flex flex-col items-center justify-center text-center p-6">
        <p class="text-gray-700 font-bold mb-3">此类文件通常不能在浏览器内直接原生渲染。</p>
        <p class="text-xs text-gray-500 mb-5">可尝试 Office 在线预览（部署到公网域名后成功率更高），或直接下载。</p>
        <div class="flex gap-2 flex-wrap justify-center">
          <a href="${officeUrl}" target="_blank" rel="noopener noreferrer" class="px-3 py-2 rounded-lg bg-emerald-500 text-white text-sm font-bold">尝试 Office 预览</a>
          <a href="${appendAdminToken('/api/admin/core?action=download&key=' + encodeURIComponent(fileKey))}" class="px-3 py-2 rounded-lg bg-indigo-500 text-white text-sm font-bold">下载文件</a>
        </div>
      </div>`;
        return;
      }

      body.innerHTML = `
    <div class="w-full h-full flex flex-col items-center justify-center text-center p-6">
      <p class="text-gray-700 font-bold mb-3">该文件类型暂不支持内嵌预览。</p>
      <a href="${appendAdminToken('/api/admin/core?action=download&key=' + encodeURIComponent(fileKey))}" class="px-3 py-2 rounded-lg bg-indigo-500 text-white text-sm font-bold">下载文件</a>
    </div>`;
    }

    async function savePreviewGrade() {
      if (!currentExplorerSubject || !currentPreviewUploader) return;
      const score = String(document.getElementById('preview-grade-score')?.value || '').trim();
      const comment = String(document.getElementById('preview-grade-comment')?.value || '').trim();
      const res = await fetch('/api/admin/core', {
        method: 'POST',
        body: JSON.stringify({ action: 'saveGrades', subject: currentExplorerSubject, items: [{ name: currentPreviewUploader, score, comment }] })
      });
      if (!res.ok) return alert('保存评分失败');
      if (!currentGrades[currentPreviewUploader]) currentGrades[currentPreviewUploader] = {};
      currentGrades[currentPreviewUploader].score = score;
      currentGrades[currentPreviewUploader].comment = comment;
      renderExplorerFiles(currentExplorerFiles);
      renderGradingList();
      alert('评分已保存');
    }

    async function downloadZip(subject, btn) {
      if (!confirm(`确定要自动下载“${subject}”的所有文件并压成 ZIP 吗？`)) return;
      const originalText = btn.innerHTML;
      btn.innerHTML = '馃攳 瀵诲潃...';
      btn.disabled = true;
      try {
        const res = await fetch(`/api/admin/core?action=files&folder=${encodeURIComponent(subject)}`);
        const data = await res.json();
        if (data.files.length === 0) return alert('空科目，无可打包文件');

        const zip = new JSZip();
        let count = 0;
        for (const file of data.files) {
          count++;
          btn.innerHTML = `馃攳 ${count}/${data.files.length}`;
          const fileRes = await fetch(`/api/admin/core?action=download&key=${encodeURIComponent(file.key)}`);
          const blob = await fileRes.blob();
          zip.file(file.key, blob);
        }

        btn.innerHTML = '压缩中...';
        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${subject}_浣滀笟鍚堥泦.zip`;
        a.click();
      } catch (err) {
        alert('打包报错：' + err.message);
      } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    }

    async function addSubject() {
      const sub = document.getElementById('new-subject-name').value.trim();
      if (!sub) return;
      document.getElementById('btn-add').innerText = '创建中...';
      await fetch('/api/admin/core', { method: 'POST', body: JSON.stringify({ action: 'addSubject', subject: sub }) });
      document.getElementById('add-modal').classList.add('hidden');
      document.getElementById('new-subject-name').value = '';
      document.getElementById('btn-add').innerText = '确认创建';
      loadDashboardData();
    }

    async function setDeadlinePrompt(subject, currentDeadline) {
      const tip = currentDeadline ? ('当前：' + formatDeadlineText(currentDeadline)) : '当前未设置';
      const raw = prompt(`为“${subject}”设置截止时间（格式示例：2026-04-30T23:59）
留空表示清除截止时间。
${tip}`, currentDeadline || '');
      if (raw === null) return;
      const deadline = raw.trim();
      const res = await fetch('/api/admin/core', {
        method: 'POST',
        body: JSON.stringify({ action: 'setDeadline', subject, deadline })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '设置截止时间失败');
        return;
      }
      await loadDashboardData();
      alert('截止时间已更新');
    }

    function exportCurrentSubjectCsv() {
      if (!currentExplorerSubject) return alert('请先打开一个科目');
      if (!Array.isArray(currentExplorerFiles) || currentExplorerFiles.length === 0) return alert('当前科目暂无数据可导出');

      const rows = [
        ['subject', 'uploader', 'file_name', 'key', 'submit_mode', 'submit_count', 'size_mb', 'uploaded_at']
      ];
      currentExplorerFiles.forEach((file) => {
        const parts = String(file.key || '').split('/');
        const uploader = parts[1] || '';
        const fileName = parts[parts.length - 1] || '';
        const meta = currentSubmitMetaMap[file.key] || {};
        const submitMode = String(meta.submitMode || 'new');
        const submitCount = Number(meta.submitCount || (submitMode === 'modified' ? 2 : 1));
        const sizeMb = (Number(file.size || 0) / 1024 / 1024).toFixed(2);
        rows.push([currentExplorerSubject, uploader, fileName, file.key || '', submitMode, submitCount, sizeMb, file.time || '']);
      });
      const csv = '\uFEFF' + rows.map((row) => row.map((v) => {
        const s = String(v ?? '');
        if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
        return s;
      }).join(',')).join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentExplorerSubject}_提交明细.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }

    function exportRosterExcel() {
      if (!currentExplorerSubject) return alert('请先打开一个科目');
      const wb = XLSX.utils.book_new();
      const submittedRows = [['姓名'], ...currentSubmittedNames.map((n) => [n])];
      const missingRows = [['姓名'], ...currentMissingNames.map((n) => [n])];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(submittedRows), '已交名单');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(missingRows), '未交名单');
      XLSX.writeFile(wb, `${currentExplorerSubject}_名单统计.xlsx`);
    }

    async function loadExemptions() {
      if (!currentExplorerSubject) return;
      const res = await fetch(`/api/admin/core?action=exemptions&subject=${encodeURIComponent(currentExplorerSubject)}`);
      if (!res.ok) return;
      const data = await res.json();
      currentExemptions = Array.isArray(data.exemptions) ? data.exemptions : [];
      renderExemptions();
    }

    function renderExemptions() {
      const wrap = document.getElementById('exemptions-list');
      if (!currentExemptions.length) {
        wrap.innerHTML = '<span class=\"text-[11px] text-[#8a8a8a]\">暂无放行</span>';
        return;
      }
      wrap.innerHTML = currentExemptions.map((name) => `<button onclick="removeExemption('${name}')" class="px-2 py-0.5 rounded text-[11px] font-bold bg-white text-[#5c614e] border border-[#e5e4e0] hover:bg-[#f4e2e2] hover:text-[#7f2b35] hover:border-[#f4e2e2] transition">${name} 移除</button>`).join('');
    }

    async function addExemption() {
      const input = document.getElementById('exempt-name-input');
      const name = input.value.trim();
      if (!name || !currentExplorerSubject) return;
      const res = await fetch('/api/admin/core', {
        method: 'POST',
        body: JSON.stringify({ action: 'setExemption', subject: currentExplorerSubject, name, enabled: true })
      });
      if (!res.ok) return alert('鏀捐澶辫触');
      const data = await res.json();
      currentExemptions = data.exemptions || [];
      input.value = '';
      renderExemptions();
    }

    async function removeExemption(name) {
      if (!currentExplorerSubject) return;
      const res = await fetch('/api/admin/core', {
        method: 'POST',
        body: JSON.stringify({ action: 'setExemption', subject: currentExplorerSubject, name, enabled: false })
      });
      if (!res.ok) return alert('绉婚櫎澶辫触');
      const data = await res.json();
      currentExemptions = data.exemptions || [];
      renderExemptions();
    }

    async function loadGrades() {
      if (!currentExplorerSubject) return;
      const res = await fetch(`/api/admin/core?action=grades&subject=${encodeURIComponent(currentExplorerSubject)}`);
      if (!res.ok) return;
      const data = await res.json();
      currentGrades = data.grades || {};
      renderGradingList();
    }

    function renderGradingList() {
      const target = document.getElementById('grading-list');
      const names = Array.from(new Set([...currentSubmittedNames, ...Object.keys(currentGrades || {})]));
      if (names.length === 0) {
        target.innerHTML = '<div class=\"text-[11px] text-[#8a8a8a]\">暂无可评分同学</div>';
        return;
      }
      const scored = names.map((name) => {
        const raw = String(currentGrades?.[name]?.score || '').trim();
        const score = Number(raw);
        return { name, score, raw };
      }).filter((item) => item.raw !== '' && Number.isFinite(item.score))
        .sort((a, b) => b.score - a.score);
      const avg = scored.length ? (scored.reduce((sum, item) => sum + item.score, 0) / scored.length).toFixed(1) : '-';
      const topScore = scored.length ? scored[0].score : '-';
      const maxScore = scored.length ? Math.max(100, ...scored.map((item) => item.score)) : 100;
      const statsHtml = `
        <div class="rounded-xl border border-[#e5e4e0] bg-[#fbf9f4] p-3 mb-3">
          <div class="grid grid-cols-3 gap-2 mb-3">
            <div class="rounded-lg bg-white border border-[#e5e4e0] p-2">
              <div class="text-[10px] text-[#777]">已评分</div>
              <div class="text-lg font-bold text-[#2c2c2c]">${scored.length}/${names.length}</div>
            </div>
            <div class="rounded-lg bg-white border border-[#e5e4e0] p-2">
              <div class="text-[10px] text-[#777]">平均分</div>
              <div class="text-lg font-bold text-[#2c2c2c]">${avg}</div>
            </div>
            <div class="rounded-lg bg-white border border-[#e5e4e0] p-2">
              <div class="text-[10px] text-[#777]">鏈€楂樺垎</div>
              <div class="text-lg font-bold text-[#2c2c2c]">${topScore}</div>
            </div>
          </div>
          <div class="space-y-2">
            ${scored.slice(0, 8).map((item, idx) => {
              const percent = Math.max(3, Math.min(100, Math.round((item.score / maxScore) * 100)));
              return `<div>
                <div class="flex items-center justify-between text-[10px] text-[#555] mb-1">
                  <span>${idx + 1}. ${escapeHtml(item.name)}</span>
                  <b>${escapeHtml(String(item.score))}</b>
                </div>
                <div class="h-1.5 rounded-full bg-[#e5e4e0] overflow-hidden">
                  <div class="h-full rounded-full bg-[#5c614e]" style="width:${percent}%"></div>
                </div>
              </div>`;
            }).join('') || '<div class="text-[11px] text-[#8a8a8a]">暂无分数，保存评分后会生成排名。</div>'}
          </div>
        </div>
      `;
      target.innerHTML = statsHtml + names.map((name) => {
        const g = currentGrades[name] || {};
        return `<div class=\"bg-white border border-[#e5e4e0] rounded-lg p-2\"><div class=\"text-[11px] font-bold text-[#2c2c2c] mb-1.5\">${name}</div><div class=\"flex gap-1.5\"><input data-grade-name=\"${name}\" data-grade-field=\"score\" value=\"${(g.score || '').replace(/\"/g, '&quot;')}\" placeholder=\"分数\" class=\"w-16 rounded bg-[#fbf9f4] border border-[#e5e4e0] focus:border-[#5c614e] px-2 py-1 text-[11px] outline-none\"><input data-grade-name=\"${name}\" data-grade-field=\"comment\" value=\"${(g.comment || '').replace(/\"/g, '&quot;')}\" placeholder=\"评语\" class=\"flex-1 rounded bg-[#fbf9f4] border border-[#e5e4e0] focus:border-[#5c614e] px-2 py-1 text-[11px] outline-none\"></div></div>`;
      }).join('');
    }
    async function quickSaveGrade(name, score) {
      if (!currentExplorerSubject) return;
      if (!currentGrades) currentGrades = {};
      const currentComment = currentGrades[name] ? (currentGrades[name].comment || '') : '';
      const items = [{ name, score, comment: currentComment }];

      const res = await fetch('/api/admin/core', {
        method: 'POST',
        body: JSON.stringify({ action: 'saveGrades', subject: currentExplorerSubject, items })
      });
      if (!res.ok) {
        console.error('Failed to quick save grade');
      } else {
        if (!currentGrades[name]) currentGrades[name] = {};
        currentGrades[name].score = score;
      }
    }

    async function saveGrades() {
      if (!currentExplorerSubject) return;
      const rows = {};
      document.querySelectorAll('[data-grade-name]').forEach((el) => {
        const name = el.getAttribute('data-grade-name');
        const field = el.getAttribute('data-grade-field');
        if (!rows[name]) rows[name] = { name, score: '', comment: '' };
        rows[name][field] = el.value.trim();
      });
      const items = Object.values(rows);
      const res = await fetch('/api/admin/core', {
        method: 'POST',
        body: JSON.stringify({ action: 'saveGrades', subject: currentExplorerSubject, items })
      });
      if (!res.ok) return alert('保存评分失败');
      alert('评分已保存并回写到学生历史');
      await loadGrades();
    }

    async function generateAiReminder(tone) {
      if (!currentExplorerSubject) return;
      const box = document.getElementById('ai-reminder-text');
      box.value = 'AI 生成中...';
      const res = await fetch('/api/admin/core', {
        method: 'POST',
        body: JSON.stringify({
          action: 'aiReminder',
          subject: currentExplorerSubject,
          deadline: '',
          tone,
          missingNames: currentMissingNames
        })
      });
      if (!res.ok) {
        box.value = '生成失败，请稍后再试。';
        return;
      }
      const data = await res.json();
      box.value = data.text || '暂无结果';
    }

    async function generateAiGradeDrafts() {
      if (!currentExplorerSubject) return;
      const rows = {};
      document.querySelectorAll('[data-grade-name]').forEach((el) => {
        const name = el.getAttribute('data-grade-name');
        const field = el.getAttribute('data-grade-field');
        if (!rows[name]) rows[name] = { name, score: '', comment: '' };
        rows[name][field] = el.value.trim();
      });
      const items = Object.values(rows);
      const res = await fetch('/api/admin/core', {
        method: 'POST',
        body: JSON.stringify({ action: 'aiGradeDraft', subject: currentExplorerSubject, items })
      });
      if (!res.ok) return alert('AI 评语生成失败');
      const data = await res.json();
      const drafts = Array.isArray(data.drafts) ? data.drafts : [];
      if (drafts.length === 0) return alert(data.message || '没有可填充的空评语');

      const map = {};
      drafts.forEach((d) => { if (d?.name) map[d.name] = d.comment || ''; });
      document.querySelectorAll('[data-grade-name][data-grade-field=\"comment\"]').forEach((el) => {
        const name = el.getAttribute('data-grade-name');
        if (!el.value.trim() && map[name]) el.value = map[name];
      });
    }

    function startAuditAutoRefresh() {
      stopAuditAutoRefresh();
      const status = document.getElementById('audit-live-status');
      if (status) status.textContent = '实时同步中 · 每 5 秒更新';
      loadAuditLogs({ silent: false });
      auditRefreshTimer = window.setInterval(() => loadAuditLogs({ silent: true }), 5000);
    }

    function stopAuditAutoRefresh() {
      if (auditRefreshTimer) window.clearInterval(auditRefreshTimer);
      auditRefreshTimer = null;
      const status = document.getElementById('audit-live-status');
      if (status) status.textContent = '实时同步已暂停';
    }

    function auditVisualForAction(action) {
      const text = String(action || '').toLowerCase();
      if (text.includes('delete') || text.includes('remove')) return { tone: 'danger', label: '删除' };
      if (text.includes('save') || text.includes('set') || text.includes('update')) return { tone: 'success', label: '变更' };
      if (text.includes('reset')) return { tone: 'warn', label: '重置' };
      if (text.includes('upload') || text.includes('submit')) return { tone: 'info', label: '提交' };
      if (text.includes('login')) return { tone: 'neutral', label: '鐧诲綍' };
      return { tone: 'neutral', label: '璁板綍' };
    }

    function formatAuditTime(time) {
      const d = new Date(time);
      if (Number.isNaN(d.getTime())) return '-';
      return d.toLocaleString('zh-CN', { hour12: false });
    }

    function renderAuditLogItem(it) {
      const visual = auditVisualForAction(it?.action);
      const actorType = it?.actorType || '-';
      const actor = it?.actor || '-';
      const target = it?.target || '-';
      const countText = Number(it?.count || 0) > 0 ? `${it.count} 条` : '单项';
      return `
        <article class="audit-item audit-${visual.tone}">
          <div class="audit-item-icon">${escapeHtml(visual.label)}</div>
          <div class="audit-item-main">
            <div class="audit-item-top">
              <h3>${escapeHtml(it?.action || '-')}</h3>
              <time>${escapeHtml(formatAuditTime(it?.time))}</time>
            </div>
            <div class="audit-metrics">
              <span><small>操作人</small><b>${escapeHtml(actorType)}:${escapeHtml(actor)}</b></span>
              <span><small>目标对象</small><b title="${escapeHtml(target)}">${escapeHtml(target)}</b></span>
              <span><small>数量</small><b>${escapeHtml(countText)}</b></span>
            </div>
          </div>
        </article>
      `;
    }
    const auditActionMap = {
      assistant_create_subject: { tone: 'success', label: 'AI 新增科目', badge: '科目', targetLabel: '科目', countLabel: '范围' },
      assistant_add_student: { tone: 'success', label: 'AI 新增学生', badge: '学生', targetLabel: '学生', countLabel: '学生数' },
      assistant_remove_student: { tone: 'danger', label: 'AI 删除学生', badge: '学生', targetLabel: '学生', countLabel: '学生数' },
      update_notice: { tone: 'success', label: '更新公告', badge: '公告', targetLabel: '公告', countLabel: '范围' },
      set_deadline: { tone: 'success', label: '更新截止时间', badge: '截止', targetLabel: '科目', countLabel: '范围' },
      delete_subject: { tone: 'danger', label: '删除科目', badge: '删除', targetLabel: '科目', countLabel: '影响文件' },
      delete_file: { tone: 'danger', label: '删除文件', badge: '删除', targetLabel: '文件', countLabel: '范围' },
      reset_student_password: { tone: 'warn', label: '重置学生密码', badge: '重置', targetLabel: '学生', countLabel: '方式' },
      set_ai_rules: { tone: 'success', label: '更新 AI 规则', badge: '规则', targetLabel: '作用范围', countLabel: '范围' },
      set_subject_settings: { tone: 'success', label: '更新作业设置', badge: '设置', targetLabel: '科目', countLabel: '范围' },
      save_students_bulk: { tone: 'success', label: '保存学生名单', badge: '名单', targetLabel: '数据表', countLabel: '学生数' },
      save_grades: { tone: 'success', label: '保存评分结果', badge: '评分', targetLabel: '科目', countLabel: '数量' },
      set_exemption: { tone: 'success', label: '设置免交学生', badge: '免交', targetLabel: '科目 / 学生', countLabel: '范围' },
      remove_exemption: { tone: 'warn', label: '取消免交学生', badge: '取消', targetLabel: '科目 / 学生', countLabel: '范围' },
      set_naming_rule: { tone: 'success', label: '更新命名规则', badge: '命名', targetLabel: '科目', countLabel: '状态' },
      set_assignment_requirement: { tone: 'success', label: '更新作业要求', badge: '要求', targetLabel: '科目', countLabel: '状态' },
      set_model_settings: { tone: 'success', label: '更新模型配置', badge: '模型', targetLabel: '配置', countLabel: '范围' },
      run_plagiarism_check: { tone: 'info', label: '运行查重检查', badge: '查重', targetLabel: '文件', countLabel: '相似项' },
      create_admin_user: { tone: 'success', label: '新增管理员', badge: '账号', targetLabel: '账号', countLabel: '范围' },
      change_admin_password: { tone: 'warn', label: '修改管理员密码', badge: '密码', targetLabel: '账号', countLabel: '范围' },
      reset_admin_password: { tone: 'warn', label: '重置管理员密码', badge: '重置', targetLabel: '账号', countLabel: '范围' }
    };

    function auditVisualForActionZh(action) {
      const text = String(action || '').toLowerCase();
      if (auditActionMap[text]) return auditActionMap[text];
      if (text.includes('delete') || text.includes('remove')) return { tone: 'danger', label: '删除操作', badge: '删除', targetLabel: '对象', countLabel: '范围' };
      if (text.includes('save') || text.includes('set') || text.includes('update')) return { tone: 'success', label: '更新配置', badge: '变更', targetLabel: '对象', countLabel: '范围' };
      if (text.includes('reset')) return { tone: 'warn', label: '重置操作', badge: '重置', targetLabel: '对象', countLabel: '范围' };
      if (text.includes('upload') || text.includes('submit')) return { tone: 'info', label: '提交文件', badge: '提交', targetLabel: '文件', countLabel: '范围' };
      if (text.includes('login')) return { tone: 'neutral', label: '登录记录', badge: '登录', targetLabel: '账号', countLabel: '范围' };
      return { tone: 'neutral', label: '系统记录', badge: '记录', targetLabel: '对象', countLabel: '范围' };
    }

    function formatAuditActor(type, actor) {
      const roleMap = { admin: '管理员', student: '学生', system: '系统' };
      const role = roleMap[String(type || '').toLowerCase()] || '操作者';
      return `${role}：${actor || '-'}`;
    }

    function formatAuditTarget(action, target) {
      const text = String(target || '').trim();
      if (!text) return '-';
      if (text === '_global') return '全局规则';
      if (text === 'students') return '学生名单';
      if (text === 'model-settings') return '模型配置';

      const normalizedAction = String(action || '').toLowerCase();
      if (['set_naming_rule', 'set_assignment_requirement'].includes(normalizedAction)) {
        const [subject, state] = text.split(':');
        const stateText = state === 'clear' ? '已清空' : state === 'set' ? '已设置' : '';
        return stateText ? `${subject}：${stateText}` : text;
      }

      if (text.includes('/')) {
        const parts = text.split('/');
        if (parts.length >= 3) return `${parts[0]} / ${parts[1]} / ${parts.slice(2).join('/')}`;
      }
      return text;
    }

    function formatAuditCount(it) {
      const action = String(it?.action || '').toLowerCase();
      const count = Number(it?.count || 0);
      if (action === 'reset_student_password') return it?.mode === 'default' ? '默认临时密码' : '随机临时密码';
      if (action === 'set_ai_rules') return it?.target === '_global' ? '全局规则' : '科目规则';
      if (action === 'set_naming_rule' || action === 'set_assignment_requirement') {
        const state = String(it?.target || '').split(':')[1] || '';
        return state === 'clear' ? '已清空' : '已设置';
      }
      if (action === 'save_students_bulk') return count > 0 ? `${count} 名学生` : '学生名单';
      if (action === 'save_grades') return count > 0 ? `${count} 份评分` : '评分结果';
      if (action === 'delete_subject') return count > 0 ? `${count} 个文件对象` : '整科删除';
      if (action === 'run_plagiarism_check') return `${count} 条相似项`;
      return count > 0 ? `${count} 项` : '单项操作';
    }

    function renderAuditLogItemZh(it) {
      const visual = auditVisualForActionZh(it?.action);
      const actorText = formatAuditActor(it?.actorType, it?.actor);
      const targetText = formatAuditTarget(it?.action, it?.target);
      const countText = formatAuditCount(it);
      return `
        <article class="audit-item audit-${visual.tone}">
          <div class="audit-item-icon">${escapeHtml(visual.badge || visual.label)}</div>
          <div class="audit-item-main">
            <div class="audit-item-top">
              <h3>${escapeHtml(visual.label || '绯荤粺璁板綍')}</h3>
              <time>${escapeHtml(formatAuditTime(it?.time))}</time>
            </div>
            <div class="audit-metrics">
              <span><small>操作者</small><b>${escapeHtml(actorText)}</b></span>
              <span><small>${escapeHtml(visual.targetLabel || '瀵硅薄')}</small><b title="${escapeHtml(targetText)}">${escapeHtml(targetText)}</b></span>
              <span><small>${escapeHtml(visual.countLabel || '鑼冨洿')}</small><b>${escapeHtml(countText)}</b></span>
            </div>
          </div>
        </article>
      `;
    }

    async function loadAuditLogs({ silent = false } = {}) {
      const list = document.getElementById('audit-list');
      const last = document.getElementById('audit-last-updated');
      const status = document.getElementById('audit-live-status');
      if (!list) return;
      if (!silent) list.innerHTML = '<div class="audit-empty">正在同步审计日志...</div>';
      try {
        const res = await fetch('/api/admin/core?action=auditLogs&limit=300');
        if (!res.ok) throw new Error('load_failed');
        const data = await res.json();
        const logs = Array.isArray(data.logs) ? data.logs : [];
        const signature = logs.slice(0, 12).map((it) => `${it.time}|${it.action}|${it.actor}|${it.target}|${it.count || 0}`).join('~');
        if (silent && signature === auditLastSignature) {
          if (last) last.textContent = `刚刚检查：${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
          return;
        }
        auditLastSignature = signature;
        list.innerHTML = logs.length ? logs.map(renderAuditLogItemZh).join('') : '<div class="audit-empty">暂无审计日志</div>';
        if (last) last.textContent = `最近同步：${new Date().toLocaleString('zh-CN', { hour12: false })}`;
        if (status) status.textContent = '实时同步中 · 每 5 秒更新';
      } catch (_) {
        if (!silent) list.innerHTML = '<div class="audit-empty audit-error">同步失败，请稍后再试</div>';
        if (status) status.textContent = '同步异常 · 稍后自动重试';
      }
    }



    async function openAuditModal() {
      switchAdminView('audit');
      return;
      const list = document.getElementById('audit-list');
      list.innerHTML = '<div class=\"text-sm text-gray-500\">加载中...</div>';
      const res = await fetch('/api/admin/core?action=auditLogs&limit=300');
      if (!res.ok) {
        list.innerHTML = '<div class=\"text-sm text-red-500\">加载失败</div>';
        return;
      }
      const data = await res.json();
      const logs = Array.isArray(data.logs) ? data.logs : [];
      if (logs.length === 0) {
        list.innerHTML = '<div class=\"text-sm text-gray-500\">暂无日志</div>';
        return;
      }
      list.innerHTML = logs.map((it) => `<div class=\"glass-input rounded-lg p-3 text-xs\"><div class=\"font-bold text-gray-800\">${it.action || '-'} · ${it.actorType || '-'}:${it.actor || '-'}</div><div class=\"text-gray-600 mt-1\">目标：${it.target || '-'}${it.count ? ` · 数量:${it.count}` : ''}</div><div class=\"text-gray-500 mt-1\">${new Date(it.time).toLocaleString('zh-CN', { hour12: false })}</div></div>`).join('');
    }

    function closeAuditModal() {
      switchAdminView('dashboard');
    }

    async function deleteAction(key, isFolder) {
      const msg = isFolder ? ('确定要彻底删除科目“' + key + '”以及里面所有提交文件吗？') : '确定要删除此文件吗？';
      if (!confirm(msg)) return;
      await fetch('/api/admin/core', { method: 'POST', body: JSON.stringify({ action: 'delete', key, isFolder }) });
      if (isFolder) loadDashboardData();
      else openExplorer(currentExplorerSubject);
    }

    function ensureAdminAssistantPanel() {
      const panel = document.querySelector('.admin-assistant-panel');
      if (!panel || panel.dataset.ready === '1') return;
      panel.dataset.ready = '1';
      panel.innerHTML = `
        <div class="admin-assistant-head">
          <div>
            <p>Admin AI</p>
            <h2>后台 AI 助手</h2>
          </div>
          <span>可操作</span>
        </div>
        <div id="admin-ai-chat-list" class="admin-ai-chat-list">
          <div class="admin-ai-msg assistant">你好，我可以操作后台主要功能：查提交、改作业设置、命名模板、学生库、公告、模型配置、评分和管理员账号。</div>
        </div>
        <div class="admin-ai-quick">
          <button onclick="askAdminAssistant('帮助')">能力清单</button>
          <button onclick="askAdminAssistant('查询所有作业提交情况')">查提交</button>
          <button onclick="askAdminAssistant('学生库在哪里')">学生库</button>
          <button onclick="askAdminAssistant('模型配置在哪里')">模型配置</button>
        </div>
        <div class="admin-ai-input-row">
          <input id="admin-ai-chat-input" placeholder="输入后台操作或问题...">
          <button id="admin-ai-chat-send" onclick="sendAdminAssistant()">发送</button>
        </div>
      `;
      const input = document.getElementById('admin-ai-chat-input');
      if (input) {
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') sendAdminAssistant();
        });
      }
    }

    function appendAdminAssistantMessage(role, text) {
      ensureAdminAssistantPanel();
      const list = document.getElementById('admin-ai-chat-list');
      if (!list) return;
      const div = document.createElement('div');
      div.className = `admin-ai-msg ${role === 'user' ? 'user' : 'assistant'}`;
      div.textContent = text;
      list.appendChild(div);
      list.scrollTop = list.scrollHeight;
    }

    function navigateFromAssistant(view) {
      const target = String(view || '').trim();
      if (!target) return;
      if (target === 'students') openStudentsModal();
      else if (target === 'notice') openNoticeModal();
      else if (target === 'ai-rules') openAiRulesModal('');
      else if (target === 'model-settings') openModelSettingsModal();
      else if (target === 'audit') openAuditModal();
      else if (target === 'admin-accounts') openAdminAccountsView();
      else switchAdminView(target);
    }

    async function refreshAfterAssistant(data = {}) {
      const refresh = Array.isArray(data.refresh) ? data.refresh : [];
      if (refresh.includes('students')) {
        await loadRoster();
        if (document.getElementById('admin-view-students') && !document.getElementById('admin-view-students').classList.contains('hidden')) {
          await openStudentsModal();
        }
      }
      if (refresh.includes('dashboard') || data.navigate === 'dashboard') {
        await loadRoster();
        loadDashboardData();
      }
      if (data.navigate === 'audit') startAuditAutoRefresh();
      if (data.navigate === 'admin-accounts') loadAdminAccounts();
    }

    async function askAdminAssistant(text) {
      ensureAdminAssistantPanel();
      const input = document.getElementById('admin-ai-chat-input');
      if (input) input.value = text;
      await sendAdminAssistant();
    }

    async function sendAdminAssistant() {
      ensureAdminAssistantPanel();
      const input = document.getElementById('admin-ai-chat-input');
      const btn = document.getElementById('admin-ai-chat-send');
      const message = String(input?.value || '').trim();
      if (!message) return;
      if (input) input.value = '';
      appendAdminAssistantMessage('user', message);
      if (btn) {
        btn.disabled = true;
        btn.textContent = '处理中';
      }
      try {
        const res = await fetch('/api/admin/core', {
          method: 'POST',
          body: JSON.stringify({ action: 'adminAssistant', message, context: adminAssistantContext })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          appendAdminAssistantMessage('assistant', data.error || '处理失败，请稍后再试。');
          return;
        }
        adminAssistantContext = data.context || adminAssistantContext || {};
        appendAdminAssistantMessage('assistant', data.reply || '已处理。');
        if (data.navigate) navigateFromAssistant(data.navigate);
        await refreshAfterAssistant(data);
      } catch (error) {
        appendAdminAssistantMessage('assistant', error?.message || '网络错误。');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '发送';
        }
      }
    }

    Object.assign(window, {
      switchAdminView,
      openStudentsModal,
      closeStudentsModal,
      addStudentRow,
      addStudentRowsBatch,
      removeStudentRow,
      resetStudentPasswordByRow,
      selectAllStudentRows,
      invertStudentRowSelection,
      removeSelectedStudentRows,
      removeEmptyStudentRows,
      importStudentsFromText,
      saveStudentsBulk,
      applyStudentColumns,
      setStudentsClassFilter,
      openExplorer,
      setExplorerViewMode,
      toggleUploaderFolder,
      openPreview,
      closePreviewModal,
      savePreviewGrade,
      deleteAction,
      downloadZip,
      runPlagiarismForFile,
      showPlagiarismDetail,
      saveSubjectSettings,
      openAiRulesModal,
      openModelSettingsModal,
      closeModelSettingsModal,
      saveModelSettings,
      testModelSettings,
      setDeadlinePrompt,
      openAuditModal,
      closeAuditModal,
      askAdminAssistant,
      sendAdminAssistant
    });

    checkAuth();
    ensureAdminAssistantPanel();
    document.getElementById('explorer-search').addEventListener('input', () => {
      renderExplorerFiles(currentExplorerFiles);
    });
