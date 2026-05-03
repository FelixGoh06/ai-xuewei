function toggleAccountMenu() {
            const menu = document.getElementById('account-settings-menu');
            const chevron = document.getElementById('account-menu-chevron');
            const btn = document.getElementById('account-menu-btn');
            if (menu.classList.contains('hidden')) {
                menu.classList.remove('hidden');
                menu.classList.add('flex');
                if (chevron) chevron.style.transform = 'rotate(180deg)';
                if (btn) btn.classList.add('nav-active');
            } else {
                menu.classList.add('hidden');
                menu.classList.remove('flex');
            }
        }

        function closeAccountMenu() {
            const menu = document.getElementById('account-settings-menu');
            const chevron = document.getElementById('account-menu-chevron');
            const btn = document.getElementById('account-menu-btn');
            if (!menu) return;
            menu.classList.add('hidden');
            menu.classList.remove('flex');
            if (chevron) chevron.style.transform = '';
            if (btn) btn.classList.remove('nav-active');
        }

        document.addEventListener('click', (e) => {
            const menu = document.getElementById('account-settings-menu');
            const accountBtn = document.getElementById('account-menu-btn');
            if (customSelectDropdown && !customSelectDropdown.contains(e.target) && !customSelectTrigger.contains(e.target)) {
                customSelectDropdown.classList.add('hidden');
            }
            if (menu && accountBtn && !menu.contains(e.target) && !accountBtn.contains(e.target)) {
                closeAccountMenu();
            }
        });

        document.addEventListener('pointerdown', (e) => {
            const btn = e.target.closest && e.target.closest('#main-nav .nav-btn');
            if (!btn) return;
            const rect = btn.getBoundingClientRect();
            btn.style.setProperty('--tap-x', `${e.clientX - rect.left}px`);
            btn.style.setProperty('--tap-y', `${e.clientY - rect.top}px`);
        });

        const rawFetch = window.fetch.bind(window);
        function getStudentToken() { return localStorage.getItem('studentToken') || ''; }
        function getStudentProfile() {
            try { return JSON.parse(localStorage.getItem('studentProfile') || '{}'); } catch (_) { return {}; }
        }
        function setStudentProfile(profile) { localStorage.setItem('studentProfile', JSON.stringify(profile || {})); }
        function clearStudentSession() {
            localStorage.removeItem('studentToken');
            localStorage.removeItem('studentProfile');
        }
        function redirectToLogin() {
            window.location.href = '/login';
        }
        window.fetch = async function (input, init = {}) {
            const url = typeof input === 'string' ? input : input.url;
            const isApi = url.startsWith('/api/');
            if (!isApi) return rawFetch(input, init);
            const headers = new Headers(init.headers || {});
            const token = getStudentToken();
            if (token) headers.set('Authorization', `Bearer ${token}`);
            if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
            return rawFetch(input, { ...init, headers });
        };

        function switchTab(tabName) {
            closeAccountMenu();
            const wasHome = document.body.classList.contains('view-home');
            const wasDetailOpen = wasHome && homeDetailEl && !homeDetailEl.classList.contains('hidden');
            document.body.classList.remove('view-home', 'view-history', 'view-about');
            document.body.classList.add(`view-${tabName}`);
            const aboutEl = document.getElementById('page-about');
            if (tabName === 'about') aboutEl.classList.remove('hidden');
            else aboutEl.classList.add('hidden');

            document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('nav-active'));
            const activeBtn = document.getElementById(`nav-${tabName}`);
            if (activeBtn) activeBtn.classList.add('nav-active');

            if (tabName === 'home') {
                if (wasDetailOpen) showHomeOverview();
                else showHomeOverviewStable();
                if (!restoringRoute) setRouteHash('home');
            }
            if (tabName === 'history') {
                renderHistory();
                if (!restoringRoute) setRouteHash('history');
            }
        }

        const customSelectTrigger = document.getElementById('custom-select-trigger');
        const customSelectDropdown = document.getElementById('custom-select-dropdown');
        const customSelectText = document.getElementById('custom-select-text');
        const hiddenSelect = document.getElementById('subject-folder');

        customSelectTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (customSelectDropdown.classList.contains('hidden')) {
                customSelectDropdown.classList.remove('hidden');
                setTimeout(() => {
                    customSelectDropdown.classList.remove('opacity-0', '-translate-y-2');
                    customSelectDropdown.classList.add('opacity-100', 'translate-y-0');
                }, 10);
            } else { closeCustomDropdown(); }
        });

        document.addEventListener('click', () => closeCustomDropdown());

        function closeCustomDropdown() {
            customSelectDropdown.classList.remove('opacity-100', 'translate-y-0');
            customSelectDropdown.classList.add('opacity-0', '-translate-y-2');
            setTimeout(() => customSelectDropdown.classList.add('hidden'), 200);
        }

        let complexSubjectsList = [];
        let deadlinesMap = {};
        let requirementsMap = {};
        let subjectMetaMap = {};
        let submittedCountsMap = {};
        let rosterCount = 0;
        let uploadRules = { maxFileSizeMb: 95, allowedExtensions: [] };
        let uploadRulesRequestId = 0;
        const subTypeContainer = document.getElementById('sub-type-container');
        const subTypeInput = document.getElementById('sub-type');
        const deadlineHint = document.getElementById('deadline-hint');
        const nameInput = document.getElementById('student-name');
        const nameDisplay = document.getElementById('student-name-display');
        const currentUserNameEl = document.getElementById('current-user-name');
        const overviewUserNameEl = document.getElementById('overview-user-name');
        const homeOverviewEl = document.getElementById('home-overview');
        const homeDetailEl = document.getElementById('home-detail');
        const detailTitleEl = document.getElementById('detail-title');
        const detailDescEl = document.getElementById('detail-desc');
        const detailSubjectBadgeEl = document.getElementById('detail-subject-badge');
        const subjectGridEl = document.getElementById('subject-grid');
        const upcomingListEl = document.getElementById('upcoming-list');
        const mobileUpcomingListEl = document.getElementById('mobile-upcoming-list');
        const precheckTip = document.getElementById('precheck-tip');
        const aiChatListEl = document.getElementById('ai-chat-list');
        const mobileAiChatListEl = document.getElementById('mobile-ai-chat-list');
        const authOverlay = document.getElementById('student-auth-overlay');
        const studentLoginErr = document.getElementById('student-login-err');
        const changePwdOverlay = document.getElementById('change-password-overlay');
        const changePwdErr = document.getElementById('first-change-password-err');
        const changePwdModal = document.getElementById('change-password-modal');
        const changePwdModalErr = document.getElementById('change-password-err');
        let aiChatHistory = [];
        let currentSubject = '';
        let globalNotice = null;
        let restoringRoute = false;
        let suppressNextHashRestore = false;

        function setRouteHash(hash) {
            const nextHash = String(hash || '').replace(/^#/, '');
            if (normalizeRouteHash() === nextHash) return;
            suppressNextHashRestore = true;
            location.hash = nextHash;
        }

        function updateGreeting() {
            const now = new Date();
            // 北京时间 = UTC + 8
            const utc = now.getTime() + now.getTimezoneOffset() * 60000;
            const beijing = new Date(utc + 8 * 3600000);
            const h = beijing.getHours();
            const greetEl = document.getElementById('greeting-text');
            const subEl = document.getElementById('greeting-subtitle');
            let greeting, subtitle;
            if (h >= 5 && h < 8) {
                greeting = '早上好';
                subtitle = '新的一天，从知识开始。';
            } else if (h >= 8 && h < 11) {
                greeting = '上午好';
                subtitle = '您的学术追求在等待着您。';
            } else if (h >= 11 && h < 13) {
                greeting = '中午好';
                subtitle = '忙碌的上午辛苦了，继续加油。';
            } else if (h >= 13 && h < 17) {
                greeting = '下午好';
                subtitle = '下午时光，适合沉浸学习。';
            } else if (h >= 17 && h < 19) {
                greeting = '傍晚好';
                subtitle = '日落之前，再完成一点吧。';
            } else if (h >= 19 && h < 22) {
                greeting = '晚上好';
                subtitle = '夜晚宁静，正是思考的好时候。';
            } else {
                greeting = '夜深了';
                subtitle = '注意休息，明天继续。';
            }
            if (greetEl) greetEl.textContent = greeting;
            if (subEl) subEl.textContent = subtitle;
        }
        updateGreeting();

        let lastClickedCard = null;

        function hideMobileAssistForPageTransition() {
            const shell = document.getElementById('mobile-assist-shell');
            const panel = document.getElementById('mobile-assist-panel');
            if (!shell) return;
            shell.classList.add('is-route-hidden');
            if (panel) panel.classList.remove('is-open');
        }

        function restoreMobileAssistAfterPageTransition() {
            const shell = document.getElementById('mobile-assist-shell');
            if (!shell) return;
            window.setTimeout(() => shell.classList.remove('is-route-hidden'), 120);
        }

        function transitionTo(hideEl, showEl, isHero = false, scrollToTop = false) {
            const shouldHideMobileAssist =
                (hideEl === homeOverviewEl && showEl === homeDetailEl) ||
                (hideEl === homeDetailEl && showEl === homeOverviewEl);
            if (shouldHideMobileAssist) hideMobileAssistForPageTransition();
            if (document.startViewTransition) {
                if (isHero && lastClickedCard) {
                    lastClickedCard.style.viewTransitionName = 'hero';
                    homeDetailEl.style.viewTransitionName = 'hero';
                }
                const t = document.startViewTransition(() => {
                    hideEl.classList.add('hidden');
                    showEl.classList.remove('hidden');
                    if (scrollToTop) window.scrollTo(0, 0);
                });
                t.finished.finally(() => {
                    if (lastClickedCard) lastClickedCard.style.viewTransitionName = '';
                    homeDetailEl.style.viewTransitionName = '';
                    if (shouldHideMobileAssist) restoreMobileAssistAfterPageTransition();
                });
            } else {
                hideEl.classList.add('hidden');
                showEl.classList.remove('hidden');
                if (scrollToTop) window.scrollTo(0, 0);
                if (shouldHideMobileAssist) restoreMobileAssistAfterPageTransition();
            }
        }

        function showHomeOverview() {
            transitionTo(homeDetailEl, homeOverviewEl, true, true);
        }

        function showHomeOverviewStable() {
            homeDetailEl.classList.add('hidden');
            homeOverviewEl.classList.remove('hidden');
            window.scrollTo(0, 0);
        }

        function showHomeDetail() {
            transitionTo(homeOverviewEl, homeDetailEl, true, true);
        }

        function setMobileAssistMode(mode = 'ai') {
            const isTasks = mode === 'tasks';
            const title = document.getElementById('mobile-assist-title');
            const kicker = document.getElementById('mobile-assist-kicker');
            const tasksPane = document.getElementById('mobile-assist-tasks');
            const aiPane = document.getElementById('mobile-assist-ai');
            const tasksBtn = document.getElementById('mobile-assist-tasks-btn');
            const aiBtn = document.getElementById('mobile-assist-ai-btn');
            if (title) title.textContent = isTasks ? '即将到期' : 'AI 助手';
            if (kicker) kicker.textContent = isTasks ? 'Upcoming' : 'Assistant';
            if (tasksPane) tasksPane.classList.toggle('hidden', !isTasks);
            if (aiPane) aiPane.classList.toggle('hidden', isTasks);
            if (tasksBtn) tasksBtn.classList.toggle('is-active', isTasks);
            if (aiBtn) aiBtn.classList.toggle('is-active', !isTasks);
        }

        function toggleMobileAssistPanel(mode = 'ai') {
            const panel = document.getElementById('mobile-assist-panel');
            if (!panel) return;
            const nextMode = mode === 'tasks' ? 'tasks' : 'ai';
            const isOpen = panel.classList.contains('is-open');
            const currentMode = panel.getAttribute('data-mode') || '';
            setMobileAssistMode(nextMode);
            panel.setAttribute('data-mode', nextMode);
            if (!isOpen || currentMode !== nextMode) {
                panel.classList.add('is-open');
                return;
            }
            panel.classList.remove('is-open');
        }

        function closeMobileAssistPanel() {
            const panel = document.getElementById('mobile-assist-panel');
            if (panel) panel.classList.remove('is-open');
        }

        window.toggleMobileAssistPanel = toggleMobileAssistPanel;
        window.closeMobileAssistPanel = closeMobileAssistPanel;

        function setSelectedSubject(folder) {
            hiddenSelect.value = folder;
            customSelectText.textContent = folder || '请选择要提交的作业科目';
            customSelectText.classList.remove('text-gray-500');
            customSelectText.classList.add('text-gray-800');
            updateDeadlineHint(folder);
            hiddenSelect.dispatchEvent(new Event('change'));
        }

        function openSubjectDetail(folder, sourceElement = null) {
            currentSubject = folder || '';
            if (!currentSubject) return;
            lastClickedCard = sourceElement;
            if (!document.body.classList.contains('view-home')) {
                document.body.classList.remove('view-history', 'view-about');
                document.body.classList.add('view-home');
                document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('nav-active'));
                const homeBtn = document.getElementById('nav-home');
                if (homeBtn) homeBtn.classList.add('nav-active');
            }
            setSelectedSubject(currentSubject);
            detailSubjectBadgeEl.textContent = currentSubject;
            detailTitleEl.textContent = `${currentSubject} 作业提交`;
            detailDescEl.textContent = window.matchMedia && window.matchMedia('(max-width: 767px)').matches
                ? '请先阅读作业要求，再在下方提交文稿。'
                : '请阅读作业要求后，在右侧提交文稿。';
            renderAssignmentRequirement(currentSubject);
            showHomeDetail();
            if (!restoringRoute) setRouteHash('detail/' + encodeURIComponent(currentSubject));
        }

        function formatDeadline(deadlineStr) {
            if (!deadlineStr) return "";
            const d = new Date(deadlineStr);
            if (Number.isNaN(d.getTime())) return "";
            return d.toLocaleString("zh-CN", { hour12: false });
        }

        function isPastDeadline(deadlineStr) {
            if (!deadlineStr) return false;
            const d = new Date(deadlineStr);
            if (Number.isNaN(d.getTime())) return false;
            return Date.now() > d.getTime();
        }

        function updateDeadlineHint(folder) {
            const deadline = deadlinesMap[folder] || "";
            const inlineEl = document.getElementById('deadline-hint-inline');
            if (!deadline) {
                deadlineHint.classList.add('hidden');
                deadlineHint.textContent = '';
                if (inlineEl) inlineEl.textContent = '';
                return;
            }
            const text = `该科目截止时间：${formatDeadline(deadline)}`;
            if (isPastDeadline(deadline)) {
                deadlineHint.classList.remove('hidden');
                deadlineHint.classList.remove('text-amber-700');
                deadlineHint.classList.add('text-red-600');
                deadlineHint.textContent = `${text}（已截止）`;
                if (inlineEl) inlineEl.textContent = `${formatDeadline(deadline)}（已截止）`;
                return;
            }
            deadlineHint.classList.remove('hidden');
            deadlineHint.classList.remove('text-red-600');
            deadlineHint.classList.add('text-amber-700');
            deadlineHint.textContent = text;
            if (inlineEl) inlineEl.textContent = formatDeadline(deadline);
        }

        function getAssignmentRequirementContent(folder) {
            const item = requirementsMap[folder] || {};
            return String(item.content || item.requirement || "").trim();
        }

        function renderAssignmentRequirement(folder) {
            const titleEl = document.getElementById('notice-title');
            const contentEl = document.getElementById('notice-content');
            if (!titleEl || !contentEl) return;
            const content = getAssignmentRequirementContent(folder);
            titleEl.textContent = '';
            titleEl.classList.add('hidden');
            contentEl.textContent = content || '管理员还没有填写该作业的具体要求。请按课堂说明完成提交，或联系老师确认格式、内容和截止规则。';
        }

        function getNoticeSummary(notice) {
            const title = String(notice?.title || '').trim();
            const content = String(notice?.content || '').replace(/\s+/g, ' ').trim();
            const text = [title, content].filter(Boolean).join('：');
            return text || '有一条新的公告';
        }

        function renderGlobalNoticeBarrage() {
            const shell = document.getElementById('global-notice-barrage');
            const textBtn = document.getElementById('global-notice-text');
            const openBtn = document.getElementById('global-notice-open');
            if (!shell || !textBtn || !openBtn) return;
            if (!globalNotice) {
                shell.classList.add('hidden');
                return;
            }
            textBtn.textContent = getNoticeSummary(globalNotice);
            shell.classList.remove('hidden');
            textBtn.onclick = openGlobalNoticeModal;
            openBtn.onclick = openGlobalNoticeModal;
            shell.onkeydown = (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openGlobalNoticeModal();
                }
            };
        }

        async function loadGlobalNotice() {
            try {
                const res = await fetch('/api/notice');
                if (!res.ok) {
                    globalNotice = null;
                    renderGlobalNoticeBarrage();
                    return;
                }
                const data = await res.json();
                const title = String(data?.title || '').trim();
                const content = String(data?.content || '').trim();
                globalNotice = title || content ? { title, content } : null;
                renderGlobalNoticeBarrage();
            } catch (_) {
                globalNotice = null;
                renderGlobalNoticeBarrage();
            }
        }

        function openGlobalNoticeModal() {
            if (!globalNotice) return;
            const modal = document.getElementById('global-notice-modal');
            const titleEl = document.getElementById('global-notice-modal-title');
            const contentEl = document.getElementById('global-notice-modal-content');
            if (!modal || !titleEl || !contentEl) return;
            titleEl.textContent = globalNotice.title || '公告';
            contentEl.textContent = globalNotice.content || '暂无详细内容。';
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        function closeGlobalNoticeModal() {
            const modal = document.getElementById('global-notice-modal');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }

        window.openGlobalNoticeModal = openGlobalNoticeModal;
        window.closeGlobalNoticeModal = closeGlobalNoticeModal;

        function getHistoryStore() {
            return JSON.parse(localStorage.getItem('homeworkHistoryByName') || '{}');
        }

        function setHistoryStore(store) {
            localStorage.setItem('homeworkHistoryByName', JSON.stringify(store));
        }

        function getHistoryForName(name) {
            if (!name) return [];
            const store = getHistoryStore();
            return Array.isArray(store[name]) ? store[name] : [];
        }

        function setHistoryForName(name, history) {
            if (!name) return;
            const store = getHistoryStore();
            store[name] = history;
            setHistoryStore(store);
        }

        function migrateOldHistoryIfNeeded() {
            const old = localStorage.getItem('homeworkHistory');
            if (!old) return;
            const name = nameInput.value.trim();
            if (!name) return;
            try {
                const arr = JSON.parse(old);
                if (!Array.isArray(arr)) return;
                const merged = [...arr, ...getHistoryForName(name)];
                setHistoryForName(name, merged);
                localStorage.removeItem('homeworkHistory');
            } catch (e) { }
        }

        async function syncCloudHistory(name) {
            if (!name) return;
            try {
                const res = await fetch(`/api/history?name=${encodeURIComponent(name)}`);
                if (!res.ok) return;
                const data = await res.json();
                if (!Array.isArray(data.history)) return;
                setHistoryForName(name, data.history);
                renderHistory();
                const folders = Array.from(hiddenSelect.querySelectorAll('option'))
                    .map((o) => o.value)
                    .filter(Boolean);
                if (folders.length > 0) renderSubjectCards(folders);
            } catch (e) { }
        }

        async function loadFolders() {
            try {
                const res = await fetch('/api/folders');
                if (res.ok) {
                    const data = await res.json();
                    complexSubjectsList = data.complexSubjects || [];
                    deadlinesMap = data.deadlines || {};
                    requirementsMap = data.requirements || {};
                    subjectMetaMap = data.subjectMeta || {};
                    submittedCountsMap = data.submittedCounts || {};
                    rosterCount = Number(data.rosterCount || 0);
                    customSelectDropdown.innerHTML = ''; hiddenSelect.innerHTML = '<option value="" disabled selected></option>';
                    if (data.folders && data.folders.length > 0) {
                        customSelectText.textContent = '请选择要提交的作业科目';
                        customSelectText.classList.remove('text-gray-500'); customSelectText.classList.add('text-gray-800');
                        renderSubjectCards(data.folders);
                        renderUpcomingTasks(data.folders);
                        data.folders.forEach(folder => {
                            const option = document.createElement('option'); option.value = folder; hiddenSelect.appendChild(option);
                            const div = document.createElement('div');
                            div.className = 'px-4 py-3 cursor-pointer hover:bg-white/60 text-gray-800 font-medium transition-colors border-b border-white/20 last:border-0 truncate';
                            div.textContent = folder;
                            div.addEventListener('click', (e) => {
                                e.stopPropagation();
                                openSubjectDetail(folder, e.currentTarget);
                                closeCustomDropdown();
                            });
                            customSelectDropdown.appendChild(div);
                        });
                    } else {
                        customSelectText.textContent = '暂无可用科目，请检查后台';
                        subjectGridEl.innerHTML = '<div class="text-[#6e7068]">暂无科目，请先在管理员端创建。</div>';
                        upcomingListEl.innerHTML = '<div class="text-[#6e7068]">暂无待截止任务。</div>';
                    }
                }
            } catch (err) { customSelectText.textContent = '加载科目失败，检查网络连接'; }
        }

        function escapeCardText(value) {
            return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            }[ch]));
        }

        function renderSubjectCards(folders) {
            subjectGridEl.innerHTML = '';
            folders.forEach((folder, idx) => {
                const submitted = Number(submittedCountsMap[folder] || 0);
                const total = Math.max(Number(rosterCount || 0), submitted, 1);
                const progress = Math.max(0, Math.min(100, Math.round((submitted / total) * 100)));
                const creator = String(subjectMetaMap[folder]?.createdBy || '管理员').trim();
                const creatorText = escapeCardText(`由${creator}创建`);
                const folderTitle = escapeCardText(folder);
                const deadline = deadlinesMap[folder] || '';
                const deadlineText = deadline ? formatDeadline(deadline) : '未设置截止时间';
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'subject-course-card text-left bg-white border-none shadow-[0_4px_20px_rgba(0,0,0,0.03)] rounded-2xl p-8 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] transition-all min-h-[260px] flex flex-col group glow-capture glow-tilt overflow-hidden';
                card.innerHTML = `
                    <div class="pointer-events-none absolute inset-0 z-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl" style="background: radial-gradient(800px circle at var(--glow-x, -1000px) var(--glow-y, -1000px), rgba(96, 165, 250, 0.08), transparent 40%);"></div>
                    <div class="relative z-10 flex flex-col h-full w-full pointer-events-none">
                        <div class="flex items-center justify-between mb-5 pointer-events-auto">
                            <span class="text-xs font-bold px-3 py-1.5 rounded-full ${idx % 2 === 0 ? 'bg-[#f0ece1] text-[#7a7465]' : 'bg-[#efeef5] text-[#787596]'}">${creatorText}</span>
                            <span class="text-[#1f221f] text-xl font-bold group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform">↗</span>
                        </div>
                        <h3 class="text-[40px] xl:text-[48px] font-serif text-[#2c2c2c] mb-5 leading-tight flex-1">${folderTitle}</h3>
                        <div class="mt-auto pt-4 border-t border-[#f0f0f0]">
                            <div class="flex items-center justify-between text-[11px] text-[#7a7a7a] mb-1.5 font-medium pointer-events-auto">
                                <span>提交人数 ${submitted} / ${total}</span>
                                <span class="${idx % 2 === 0 ? 'text-[#7a7465]' : 'text-[#6c689e]'} font-bold">${progress}%</span>
                            </div>
                            <div class="h-1 bg-[#f0f0f0] rounded-full overflow-hidden pointer-events-auto">
                                <div class="h-1 rounded-full ${idx % 2 === 0 ? 'bg-[#656b55]' : 'bg-[#6a688a]'}" style="width:${progress}%"></div>
                            </div>
                        </div>
                    </div>
                `;

                card.addEventListener('mousemove', (e) => {
                    const rect = card.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    card.style.setProperty('--glow-x', `${x}px`);
                    card.style.setProperty('--glow-y', `${y}px`);

                    const centerX = rect.width / 2;
                    const centerY = rect.height / 2;
                    const rotateX = ((y - centerY) / centerY) * -4;
                    const rotateY = ((x - centerX) / centerX) * 4;
                    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.01, 1.01, 1.01)`;
                });

                card.addEventListener('mouseleave', () => {
                    card.style.transform = '';
                    card.style.setProperty('--glow-x', `-1000px`);
                    card.style.setProperty('--glow-y', `-1000px`);
                });

                card.addEventListener('click', (e) => {
                    card.style.transform = '';
                    openSubjectDetail(folder, e.currentTarget);
                });
                subjectGridEl.appendChild(card);
            });
        }

        function renderUpcomingTasks(folders) {
            const upcoming = folders
                .map((folder) => ({ folder, deadline: deadlinesMap[folder] || '' }))
                .filter((x) => x.deadline)
                .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
                .slice(0, 6);
            const bindUpcomingClicks = (root) => {
                if (!root) return;
                root.querySelectorAll('button[data-folder]').forEach((btn) => {
                    btn.addEventListener('click', (e) => {
                        closeMobileAssistPanel();
                        openSubjectDetail(btn.getAttribute('data-folder') || '', e.currentTarget);
                    });
                });
            };
            if (upcoming.length === 0) {
                upcomingListEl.innerHTML = '<div class="text-[#6e7068]">暂无待截止任务。</div>';
                if (mobileUpcomingListEl) mobileUpcomingListEl.innerHTML = '<div class="mobile-assist-empty">暂无待截止任务</div>';
                return;
            }
            const html = upcoming.map((item, idx) => {
                const passed = isPastDeadline(item.deadline);
                const colors = ['bg-[#d46f7b]', 'bg-[#cfd5c2]', 'bg-[#d8d5ca]', 'bg-[#bba874]'];
                const color = passed ? 'bg-[#c45c5c]' : colors[idx % colors.length];
                const safeFolder = escapeCardText(item.folder);
                return `
                    <button type="button" data-folder="${safeFolder}" class="w-full text-left pl-0 pr-1 py-1 group">
                        <div class="flex items-start gap-4 relative">
                            <div class="absolute left-[5px] top-[16px] bottom-[-20px] w-px bg-[#e5e4e0] group-last:hidden"></div>
                            <span class="relative mt-[7px] w-2 h-2 rounded-full ${color} shrink-0 z-10 ring-4 ring-[#f5f4ed]"></span>
                            <div class="flex-1 pb-4">
                                <p class="text-[11px] ${passed ? 'text-[#9a3c49]' : 'text-[#8a8a8a]'} font-bold mb-0.5 tracking-wide">${formatDeadline(item.deadline)}${passed ? '（已截止）' : ''}</p>
                                <p class="text-[15px] font-bold text-[#2c2c2c] mb-1 leading-snug group-hover:text-[#5c614e] transition-colors">${safeFolder}</p>
                            </div>
                        </div>
                    </button>
                `;
            }).join('');
            upcomingListEl.innerHTML = html;
            if (mobileUpcomingListEl) mobileUpcomingListEl.innerHTML = html;
            bindUpcomingClicks(upcomingListEl);
            bindUpcomingClicks(mobileUpcomingListEl);
        }

        function normalizeRuleExtensions(value) {
            if (!Array.isArray(value)) return [];
            const seen = new Set();
            const out = [];
            value.forEach((raw) => {
                let ext = String(raw || '').trim().toLowerCase();
                if (!ext) return;
                if (!ext.startsWith('.')) ext = `.${ext}`;
                if (seen.has(ext)) return;
                seen.add(ext);
                out.push(ext);
            });
            return out;
        }

        function formatAllowedExtensions(exts) {
            if (!Array.isArray(exts) || exts.length === 0) return '不限后缀';
            return exts.map((ext) => ext.toUpperCase()).join(' 或 ');
        }

        function updateUploadRuleText() {
            const maxMb = Number(uploadRules.maxFileSizeMb || 95);
            const typeEl = document.getElementById('upload-allowed-types');
            const maxTextEl = document.getElementById('upload-max-size-text');
            const maxInlineEl = document.getElementById('upload-max-size-inline');
            const fileInputEl = document.getElementById('file-upload');
            const allowedExts = Array.isArray(uploadRules.allowedExtensions) ? uploadRules.allowedExtensions : [];
            if (typeEl) typeEl.textContent = formatAllowedExtensions(allowedExts);
            if (maxTextEl) maxTextEl.textContent = `单文件 ≤ ${maxMb}MB`;
            if (maxInlineEl) maxInlineEl.textContent = String(maxMb);
            if (fileInputEl) fileInputEl.setAttribute('accept', allowedExts.join(','));
        }

        async function loadUploadRules(folder = '') {
            const requestId = ++uploadRulesRequestId;
            try {
                const qs = folder ? `?folder=${encodeURIComponent(folder)}` : '';
                const res = await fetch(`/api/upload-rules${qs}`);
                if (!res.ok) return;
                const data = await res.json();
                if (requestId !== uploadRulesRequestId) return;
                uploadRules = {
                    maxFileSizeMb: Number(data.maxFileSizeMb || 95),
                    allowedExtensions: normalizeRuleExtensions(data.allowedExtensions)
                };
                updateUploadRuleText();
                renderPrecheck();
            } catch (e) { }
        }
        function applyCurrentUser(profile) {
            const name = String(profile?.name || '').trim();
            const studentId = String(profile?.studentId || '').trim();
            const text = name ? `${name}${studentId ? `（${studentId}）` : ''}` : '未登录';
            nameInput.value = name;
            nameDisplay.textContent = text;
            currentUserNameEl.textContent = text;
            overviewUserNameEl.textContent = name || '同学';
        }

        function showAuthOverlay() {
            document.body.classList.add('auth-locked');
            authOverlay.classList.remove('hidden');
            authOverlay.classList.add('flex');
        }

        function hideAuthOverlay() {
            document.body.classList.remove('auth-locked');
            authOverlay.style.pointerEvents = 'none';

            const card = document.querySelector('#student-auth-overlay > div');
            if (card) {
                const children = Array.from(card.children);
                children.forEach((child, i) => {
                    child.style.transition = `opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)`;
                    child.style.transitionDelay = `${i * 0.05}s`;
                    child.style.opacity = '0';
                    child.style.transform = 'translateY(15px)';
                });

                setTimeout(() => {
                    card.style.transition = 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.5s ease';
                    card.style.transform = 'scale(0.95)';
                    card.style.opacity = '0';

                    authOverlay.style.transition = 'opacity 0.6s ease, backdrop-filter 0.6s ease';
                    authOverlay.style.opacity = '0';
                    authOverlay.style.backdropFilter = 'blur(0px)';
                }, 250);

                setTimeout(() => {
                    authOverlay.classList.add('hidden');
                    authOverlay.classList.remove('flex');

                    authOverlay.removeAttribute('style');
                    card.removeAttribute('style');
                    children.forEach(c => c.removeAttribute('style'));
                }, 900);
            } else {
                authOverlay.classList.add('hidden');
                authOverlay.classList.remove('flex');
            }
        }

        async function ensureStudentSession() {
            const token = getStudentToken();
            if (!token) {
                clearStudentSession();
                applyCurrentUser({});
                redirectToLogin();
                return false;
            }
            try {
                const res = await fetch('/api/student/me');
                if (!res.ok) throw new Error('auth');
                const data = await res.json();
                const user = data.user || {};
                setStudentProfile(user);
                applyCurrentUser(user);
                loginSuccess = true;
                hideAuthOverlay();
                if (data.mustChangePassword) {
                    changePwdOverlay.classList.remove('hidden');
                    changePwdOverlay.classList.add('flex');
                } else {
                    changePwdOverlay.classList.add('hidden');
                    changePwdOverlay.classList.remove('flex');
                }
                return true;
            } catch (_) {
                clearStudentSession();
                applyCurrentUser({});
                redirectToLogin();
                return false;
            }
        }

        async function handleStudentLogin() {
            studentLoginErr.classList.add('hidden');
            const login = String(document.getElementById('student-login-id').value || '').trim();
            const password = String(document.getElementById('student-login-pwd').value || '');
            if (!login || !password) {
                studentLoginErr.textContent = '请输入账号和密码';
                studentLoginErr.classList.remove('hidden');
                return;
            }
            const btn = document.getElementById('student-login-btn');
            btn.disabled = true;
            btn.textContent = '登录中...';
            let loginSuccess = false;
            try {
                const res = await fetch('/api/student/login', {
                    method: 'POST',
                    body: JSON.stringify({ login, password })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data?.token) {
                    studentLoginErr.textContent = data?.error || '登录失败';
                    studentLoginErr.classList.remove('hidden');
                    return;
                }
                localStorage.setItem('studentToken', data.token);
                setStudentProfile(data.user || {});
                applyCurrentUser(data.user || {});
                loginSuccess = true;
                hideAuthOverlay();
                document.getElementById('student-login-pwd').value = '';
                if (data.mustChangePassword) {
                    changePwdOverlay.classList.remove('hidden');
                    changePwdOverlay.classList.add('flex');
                }
                migrateOldHistoryIfNeeded();
                await syncCloudHistory(String((data.user || {}).name || ''));
                renderHistory();
            } finally {
                btn.disabled = false;
                btn.textContent = '学生登录';
            }
        }

        async function handleFirstChangePassword() {
            changePwdErr.classList.add('hidden');
            const p1 = String(document.getElementById('first-new-password').value || '');
            const p2 = String(document.getElementById('first-new-password-2').value || '');
            if (p1.length < 6) {
                changePwdErr.textContent = '新密码至少 6 位';
                changePwdErr.classList.remove('hidden');
                return;
            }
            if (p1 !== p2) {
                changePwdErr.textContent = '两次输入的新密码不一致';
                changePwdErr.classList.remove('hidden');
                return;
            }
            const btn = document.getElementById('first-change-password-btn');
            btn.disabled = true;
            btn.textContent = '保存中...';
            try {
                const res = await fetch('/api/student/change-password', {
                    method: 'POST',
                    body: JSON.stringify({ newPassword: p1 })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    changePwdErr.textContent = data?.error || '修改失败';
                    changePwdErr.classList.remove('hidden');
                    return;
                }
                changePwdOverlay.classList.add('hidden');
                changePwdOverlay.classList.remove('flex');
                document.getElementById('first-new-password').value = '';
                document.getElementById('first-new-password-2').value = '';
                showModal('设置成功', '密码已更新，请妥善保管。', 'success');
            } finally {
                btn.disabled = false;
                btn.textContent = '保存新密码';
            }
        }

        function openChangePasswordModal() {
            changePwdModalErr.classList.add('hidden');
            document.getElementById('change-old-password').value = '';
            document.getElementById('change-new-password').value = '';
            document.getElementById('change-new-password-2').value = '';
            changePwdModal.classList.remove('hidden');
            changePwdModal.classList.add('flex');
        }

        function closeChangePasswordModal() {
            changePwdModal.classList.add('hidden');
            changePwdModal.classList.remove('flex');
        }

        async function handleChangePassword() {
            changePwdModalErr.classList.add('hidden');
            const oldPassword = String(document.getElementById('change-old-password').value || '');
            const newPassword = String(document.getElementById('change-new-password').value || '');
            const confirmPassword = String(document.getElementById('change-new-password-2').value || '');
            if (!oldPassword) {
                changePwdModalErr.textContent = '请输入旧密码';
                changePwdModalErr.classList.remove('hidden');
                return;
            }
            if (newPassword.length < 6) {
                changePwdModalErr.textContent = '新密码至少 6 位';
                changePwdModalErr.classList.remove('hidden');
                return;
            }
            if (newPassword !== confirmPassword) {
                changePwdModalErr.textContent = '两次输入的新密码不一致';
                changePwdModalErr.classList.remove('hidden');
                return;
            }
            const btn = document.getElementById('change-password-submit');
            btn.disabled = true;
            btn.textContent = '保存中...';
            try {
                const res = await fetch('/api/student/change-password', {
                    method: 'POST',
                    body: JSON.stringify({ oldPassword, newPassword })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    changePwdModalErr.textContent = data?.error || '修改失败';
                    changePwdModalErr.classList.remove('hidden');
                    return;
                }
                closeChangePasswordModal();
                showModal('修改成功', '密码已更新，请使用新密码登录。', 'success');
            } finally {
                btn.disabled = false;
                btn.textContent = '保存';
            }
        }

        document.getElementById('student-login-btn').addEventListener('click', handleStudentLogin);
        document.getElementById('student-login-pwd').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleStudentLogin();
        });
        document.getElementById('first-change-password-btn').addEventListener('click', handleFirstChangePassword);
        document.getElementById('student-change-password-btn').addEventListener('click', openChangePasswordModal);
        document.getElementById('change-password-cancel').addEventListener('click', closeChangePasswordModal);
        document.getElementById('change-password-submit').addEventListener('click', handleChangePassword);
        document.getElementById('auth-tab-admin').addEventListener('click', () => { window.location.href = '/admin'; });
        document.getElementById('auth-tab-student').addEventListener('click', () => { });
        document.getElementById('student-logout-btn').addEventListener('click', () => {
            clearStudentSession();
            applyCurrentUser({});
            redirectToLogin();
        });
        const noticeBackdrop = document.getElementById('global-notice-backdrop');
        if (noticeBackdrop) noticeBackdrop.addEventListener('click', closeGlobalNoticeModal);
        const historyPreviewBackdrop = document.getElementById('history-preview-backdrop');
        if (historyPreviewBackdrop) historyPreviewBackdrop.addEventListener('click', closeHistoryPreview);

        document.getElementById('back-to-overview').addEventListener('click', () => {
            currentSubject = '';
            showHomeOverview();
            if (!restoringRoute) setRouteHash('home');
        });

        loadUploadRules();
        loadGlobalNotice();

        function normalizeRouteHash() {
            return location.hash.replace(/^#/, '').trim();
        }

        function showHomeRoute() {
            currentSubject = '';
            closeAccountMenu();
            closeMobileAssistPanel();
            document.body.classList.remove('view-history', 'view-about');
            document.body.classList.add('view-home');
            document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('nav-active'));
            const homeBtn = document.getElementById('nav-home');
            if (homeBtn) homeBtn.classList.add('nav-active');
            if (homeDetailEl && !homeDetailEl.classList.contains('hidden')) showHomeOverview();
            else showHomeOverviewStable();
        }

        // 根据 URL hash 恢复页面状态，也响应浏览器返回/前进
        async function restoreFromHash({ reloadFolders = true } = {}) {
            if (restoringRoute) return;
            restoringRoute = true;
            try {
                if (reloadFolders) await loadFolders();
                const hash = normalizeRouteHash();
                if (hash.startsWith('detail/')) {
                    const folder = decodeURIComponent(hash.substring(7));
                    if (folder) {
                        openSubjectDetail(folder);
                        return;
                    }
                }
                if (hash === 'history') {
                    switchTab('history');
                    return;
                }
                showHomeRoute();
                if (!hash || hash === 'home') {
                    history.replaceState(null, '', `${location.pathname}${location.search}#home`);
                }
            } finally {
                restoringRoute = false;
            }
        }

        ensureStudentSession().then(async (ok) => {
            if (ok) {
                migrateOldHistoryIfNeeded();
                if (nameInput.value.trim()) syncCloudHistory(nameInput.value.trim());
                renderHistory();
            }
            await restoreFromHash();
        });
        window.addEventListener('hashchange', () => {
            if (suppressNextHashRestore) {
                suppressNextHashRestore = false;
                return;
            }
            restoreFromHash({ reloadFolders: false });
        });

        ['history-filter-subject', 'history-filter-date-from', 'history-filter-date-to'].forEach((id) => {
            document.getElementById(id).addEventListener('input', () => renderHistory());
            document.getElementById(id).addEventListener('change', () => renderHistory());
        });
        ensureAiWelcome();
        document.getElementById('ai-chat-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendAiChat();
            }
        });
        const mobileAiInput = document.getElementById('mobile-ai-chat-input');
        if (mobileAiInput) {
            mobileAiInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    sendAiChat('mobile');
                }
            });
        }

        hiddenSelect.addEventListener('change', function () {
            updateDeadlineHint(this.value);
            loadUploadRules(this.value);
            if (complexSubjectsList.includes(this.value)) {
                subTypeContainer.classList.remove('hidden', 'scale-95', 'opacity-0'); subTypeInput.required = true;
            } else {
                subTypeContainer.classList.add('hidden', 'scale-95', 'opacity-0'); subTypeInput.required = false; subTypeInput.value = '';
            }
        });

        const dropzone = document.getElementById('dropzone');
        const fileInput = document.getElementById('file-upload');
        const fileList = document.getElementById('file-list');
        const form = document.getElementById('upload-form');
        const submitBtn = document.getElementById('submit-btn');
        let selectedFiles = [];

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => dropzone.addEventListener(e, preventDefaults, false));
        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
        ['dragenter', 'dragover'].forEach(e => dropzone.addEventListener(e, () => dropzone.classList.add('drag-active'), false));
        ['dragleave', 'drop'].forEach(e => dropzone.addEventListener(e, () => dropzone.classList.remove('drag-active'), false));
        dropzone.addEventListener('drop', e => handleFiles(e.dataTransfer.files), false);
        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', function () { handleFiles(this.files); });

        dropzone.addEventListener('mousemove', (e) => {
            const rect = dropzone.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            dropzone.style.setProperty('--glow-x', `${x}px`);
            dropzone.style.setProperty('--glow-y', `${y}px`);

            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const rotateX = ((y - centerY) / centerY) * -2;
            const rotateY = ((x - centerX) / centerX) * 2;
            dropzone.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.01, 1.01, 1.01)`;
        });

        dropzone.addEventListener('mouseleave', () => {
            dropzone.style.transform = '';
            dropzone.style.setProperty('--glow-x', `-1000px`);
            dropzone.style.setProperty('--glow-y', `-1000px`);
        });

        function handleFiles(files) {
            Array.from(files).forEach(newFile => {
                if (!selectedFiles.some(f => f.name === newFile.name && f.size === newFile.size)) selectedFiles.push(newFile);
            });
            fileInput.value = ''; updateFileList(); renderPrecheck();
        }
        function removeFile(index) { selectedFiles.splice(index, 1); updateFileList(); renderPrecheck(); }

        function parseFileExt(fileName) {
            const idx = fileName.lastIndexOf('.');
            return idx >= 0 ? fileName.slice(idx).toLowerCase() : '';
        }

        function collectPrecheckIssues() {
            const issues = [];
            const maxBytes = Number(uploadRules.maxFileSizeMb || 95) * 1024 * 1024;
            const allowedExts = Array.isArray(uploadRules.allowedExtensions) ? uploadRules.allowedExtensions : [];
            const nameSet = new Set();

            selectedFiles.forEach((file) => {
                if (Number(file.size || 0) > maxBytes) issues.push(`文件过大：${file.name}（上限 ${uploadRules.maxFileSizeMb}MB）`);
                if (allowedExts.length > 0) {
                    const ext = parseFileExt(file.name);
                    if (!allowedExts.includes(ext)) issues.push(`后缀不允许：${file.name}`);
                }
                const key = String(file.name || '').toLowerCase();
                if (nameSet.has(key)) issues.push(`本次选择中存在重名：${file.name}`);
                nameSet.add(key);
            });
            return issues;
        }

        function renderPrecheck() {
            if (selectedFiles.length === 0) {
                precheckTip.classList.add('hidden');
                precheckTip.textContent = '';
                return;
            }
            const issues = collectPrecheckIssues();
            if (issues.length === 0) {
                precheckTip.classList.remove('hidden');
                precheckTip.classList.remove('text-red-600');
                precheckTip.classList.add('text-emerald-700');
                precheckTip.textContent = `预检通过：${selectedFiles.length} 个文件可上传`;
                return;
            }
            precheckTip.classList.remove('hidden');
            precheckTip.classList.remove('text-emerald-700');
            precheckTip.classList.add('text-red-600');
            precheckTip.textContent = `预检发现 ${issues.length} 个问题：${issues.slice(0, 2).join('；')}${issues.length > 2 ? '...' : ''}`;
        }

        function updateFileList() {
            fileList.innerHTML = '';
            selectedFiles.forEach((file, index) => {
                const ext = file.name.split('.').pop().toLowerCase();
                const isImage = ['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext);
                const isPdf = ext === 'pdf';
                const isDoc = ['doc','docx','ppt','pptx','xls','xlsx'].includes(ext);
                let iconBg, iconColor, iconSvg;
                if (isImage) {
                    iconBg = '#eef5ee'; iconColor = '#5a7a52';
                    iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
                } else if (isPdf) {
                    iconBg = '#f5eee4'; iconColor = '#9a6a3a';
                    iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
                } else if (isDoc) {
                    iconBg = '#eceef5'; iconColor = '#5a5a9a';
                    iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
                } else {
                    iconBg = '#f0ece1'; iconColor = '#7a7465';
                    iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
                }
                const sizeMB = (file.size / 1024 / 1024);
                const sizeText = sizeMB >= 1 ? sizeMB.toFixed(2) + ' MB' : (file.size / 1024).toFixed(1) + ' KB';
                const li = document.createElement('li');
                li.className = 'file-item-animate glass-item rounded-2xl px-4 py-3 flex items-center gap-3 hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] transition-shadow';
                li.style.animationDelay = (index * 60) + 'ms';
                li.innerHTML = `
                    <div style="width:40px;height:40px;border-radius:12px;background:${iconBg};color:${iconColor};display:flex;align-items:center;justify-content:center;flex-shrink:0">${iconSvg}</div>
                    <div class="flex-1 min-w-0">
                        <p class="text-[13px] font-semibold text-[#2c2c2c] truncate">${file.name}</p>
                        <p class="text-[11px] text-[#8a8a8a] mt-0.5">${sizeText}<span class="mx-1.5 opacity-40">·</span>${ext.toUpperCase()}</p>
                    </div>
                    <button type="button" onclick="removeFile(${index})" class="w-8 h-8 flex items-center justify-center rounded-full text-[#8a8a8a] hover:bg-[#f5e4e4] hover:text-[#c45c5c] transition-all flex-shrink-0" title="移除">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                `;
                fileList.appendChild(li);
            });
        }

        async function fetchExistingFileNames(folder, name, subType) {
            const qs = new URLSearchParams({ folder, name });
            if (subType) qs.set('subType', subType);
            const res = await fetch(`/api/submitted?${qs.toString()}`);
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data.fileNames) ? data.fileNames : [];
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const folder = hiddenSelect.value;
            const subType = subTypeInput.value.trim();
            const name = document.getElementById('student-name').value.trim();
            const MAX_FILE_SIZE = Number(uploadRules.maxFileSizeMb || 95) * 1024 * 1024;
            const receiptBox = document.getElementById('receipt-box');
            receiptBox.classList.add('hidden');
            receiptBox.textContent = '';

            if (!folder) return showModal("提示", "请选择要提交的作业科目！", "error");
            if (!name) return showModal("提示", "请先登录学生账号！", "error");
            if (complexSubjectsList.includes(folder) && !subType) return showModal("提示", "此科目要求填写作业单元或小类型！", "error");
            if (selectedFiles.length === 0) return showModal("提示", "请至少选择或拖入一个作业文件！", "error");
            const precheckIssues = collectPrecheckIssues();
            if (precheckIssues.length > 0) {
                return showModal("预检未通过", precheckIssues.slice(0, 3).join("；"), "error");
            }

            const deadline = deadlinesMap[folder] || "";
            if (deadline && isPastDeadline(deadline)) {
                const ok = confirm(`该科目已过截止时间（${formatDeadline(deadline)}），继续上传将被视为迟交。是否继续？`);
                if (!ok) return;
            }

            try {
                const existing = await fetchExistingFileNames(folder, name, complexSubjectsList.includes(folder) ? subType : "");
                const duplicateNames = selectedFiles.map((f) => f.name).filter((n) => existing.includes(n));
                if (duplicateNames.length > 0) {
                    const ok = confirm(`检测到 ${duplicateNames.length} 个重名文件：\n${duplicateNames.join('\n')}\n继续上传会覆盖原文件，是否继续？`);
                    if (!ok) return;
                }
            } catch (e) { }

            submitBtn.disabled = true; submitBtn.classList.add('hidden');
            document.getElementById('progress-container').classList.remove('hidden');

            let successCount = 0; let errorMsg = "";
            const receiptCodes = [];

            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
                if (file.size > MAX_FILE_SIZE) { errorMsg = `文件【${file.name}】超过${uploadRules.maxFileSizeMb || 95}MB限制！`; break; }

                document.getElementById('progress-text').innerText = `正在上传(${i + 1}/${selectedFiles.length}): ${file.name} `;
                const formData = new FormData();
                formData.append('name', name); formData.append('folder', folder);
                if (complexSubjectsList.includes(folder)) formData.append('subType', subType);
                formData.append('files', file);

                try {
                    await new Promise((resolve, reject) => {
                        const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/upload', true);
                        const token = getStudentToken();
                        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token} `);
                        xhr.upload.onprogress = function (event) {
                            if (event.lengthComputable) {
                                const totalPercent = (((i * 100) + ((event.loaded / event.total) * 100)) / selectedFiles.length);
                                document.getElementById('progress-bar').style.width = totalPercent + '%'; document.getElementById('progress-percent').innerText = Math.round(totalPercent) + '%';
                            }
                        };
                        xhr.onload = function () {
                            if (xhr.status >= 200 && xhr.status < 300) {
                                const isComplex = complexSubjectsList.includes(folder);
                                const fallbackPath = isComplex ? `${folder} /${name}/${subType} /${file.name}` : `${folder}/${name}/${file.name}`;
                                let uploadedItem = null;
                                try {
                                    const data = JSON.parse(xhr.responseText || '{}');
                                    if (Array.isArray(data.uploaded)) uploadedItem = data.uploaded[0] || null;
                                } catch (e) { }
                                const filePath = uploadedItem?.path || fallbackPath;
                                const deleteToken = uploadedItem?.deleteToken || '';
                                if (uploadedItem?.receiptCode) receiptCodes.push(uploadedItem.receiptCode);
                                if (uploadedItem?.historyEntry) {
                                    saveToHistory(name, uploadedItem.historyEntry);
                                } else {
                                    saveToHistory(name, {
                                        id: Date.now().toString(),
                                        receiptCode: '',
                                        fileName: file.name,
                                        fullPath: filePath,
                                        deleteToken,
                                        displayType: isComplex ? `${folder} - ${subType}` : folder,
                                        time: new Date().toLocaleString(),
                                        deleted: false
                                    });
                                }
                                resolve();
                            } else {
                                try { reject(new Error(JSON.parse(xhr.responseText).error || "未知错误")); }
                                catch (e) { reject(new Error(xhr.status === 413 ? "文件体积超限" : "响应异常")); }
                            }
                        };
                        xhr.onerror = () => reject(new Error("网络中断")); xhr.send(formData);
                    });
                    successCount++;
                } catch (error) { errorMsg = error.message; break; }
            }

            document.getElementById('progress-container').classList.add('hidden');
            document.getElementById('progress-bar').style.width = '0%'; document.getElementById('progress-percent').innerText = '0%';
            submitBtn.classList.remove('hidden'); submitBtn.disabled = false;

            if (successCount === selectedFiles.length) {
                showModal("上传成功", `你的作业已成功存入云端。`, "success");
                if (receiptCodes.length > 0) {
                    receiptBox.classList.remove('hidden');
                    receiptBox.innerHTML = `<div class="font-bold mb-1">提交回执码（请截图保存）</div><div class="break-all">${receiptCodes.join('<br>')}</div>`;
                }
                selectedFiles = []; updateFileList();
                subTypeContainer.classList.add('hidden', 'scale-95', 'opacity-0'); subTypeInput.value = ""; subTypeInput.required = false;
                await loadFolders();
                if (currentSubject) {
                    setSelectedSubject(currentSubject);
                    renderAssignmentRequirement(currentSubject);
                } else {
                    hiddenSelect.value = ""; customSelectText.textContent = "请选择要提交的作业科目";
                    updateDeadlineHint("");
                }

                // 🚨 此处强制刷新本地历史列表数据
                await syncCloudHistory(name);
            } else { showModal("上传失败", `成功 ${successCount} 个。失败原因: ${errorMsg}`, "error"); }
        });



        function showModal(t, m, type) {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(44,44,44,0.3);backdrop-filter:blur(4px);z-index:9999;animation:confirm-overlay-in 0.2s ease';
            const box = document.createElement('div');
            box.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(1);background:#f9f8f5;border-radius:20px;padding:32px 36px;z-index:10000;min-width:320px;max-width:400px;box-shadow:0 24px 64px rgba(0,0,0,0.12);animation:confirm-box-in 0.25s cubic-bezier(0.16,1,0.3,1);text-align:center';
            const iconColor = type === 'success' ? '#5a7a52' : '#c45c5c';
            const iconBg = type === 'success' ? '#e8f0e4' : '#f5e4e4';
            const iconSvg = type === 'success'
                ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
                : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            box.innerHTML = `
                <div style="width:52px;height:52px;border-radius:50%;background:${iconBg};color:${iconColor};display:flex;align-items:center;justify-content:center;margin:0 auto 16px">${iconSvg}</div>
                <h3 style="font-family:Newsreader,serif;font-size:20px;color:#2c2c2c;margin-bottom:6px">${t}</h3>
                <p style="font-size:14px;color:#7a7a7a;line-height:1.6;margin-bottom:24px">${m}</p>
                <button style="padding:10px 0;width:100%;border-radius:12px;border:none;background:#2c2c2c;color:#f5f4ed;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.15s">确定</button>
            `;
            document.body.appendChild(overlay);
            document.body.appendChild(box);
            const cleanup = () => {
                box.style.opacity = '0';
                box.style.transform = 'translate(-50%,-50%) scale(0.95)';
                box.style.transition = 'all 0.15s ease';
                overlay.style.opacity = '0';
                overlay.style.transition = 'opacity 0.15s ease';
                setTimeout(() => { overlay.remove(); box.remove(); }, 160);
            };
            box.querySelector('button').onclick = cleanup;
            overlay.onclick = cleanup;
        }

        function saveToHistory(name, entry) {
            if (!name || !entry || typeof entry !== 'object') return;
            const history = getHistoryForName(name);
            const id = entry.id || Date.now().toString();
            const normalized = {
                id,
                receiptCode: entry.receiptCode || '',
                fileName: entry.fileName || '未命名文件',
                fullPath: entry.fullPath || '',
                deleteToken: entry.deleteToken || '',
                displayType: entry.displayType || '',
                size: Number(entry.size || 0),
                time: entry.time || new Date().toLocaleString(),
                deleted: entry.deleted === true,
                submitMode: String(entry.submitMode || ''),
                submitCount: Number(entry.submitCount || 0),
                score: entry.score || '',
                comment: entry.comment || ''
            };
            const next = [normalized, ...history.filter((item) => String(item.id) !== String(id))].slice(0, 500);
            setHistoryForName(name, next);
            renderHistory();
        }

        function getPreviewExt(fileName, fallbackPath = '') {
            const value = String(fileName || fallbackPath || '');
            const idx = value.lastIndexOf('.');
            return idx >= 0 ? value.slice(idx).toLowerCase() : '';
        }

        function buildPreviewUrl(path, download = false) {
            const qs = new URLSearchParams({ path: String(path || '') });
            const token = getStudentToken();
            if (token) qs.set('token', token);
            if (download) qs.set('download', '1');
            return `/api/preview?${qs.toString()}`;
        }

        function closeHistoryPreview() {
            const modal = document.getElementById('history-preview-modal');
            const body = document.getElementById('history-preview-body');
            if (modal) {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
            if (body) body.innerHTML = '';
        }

        function renderHistoryImagePreview(body, previewUrl, fileName) {
            body.innerHTML = '<div class="history-preview-empty">正在加载图片...</div>';
            const img = new Image();
            let settled = false;
            const timer = window.setTimeout(() => {
                if (settled) return;
                settled = true;
                body.innerHTML = '<div class="history-preview-empty">图片加载时间较长，请稍后重试或下载查看。</div>';
            }, 12000);
            img.onload = () => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                const wrap = document.createElement('div');
                wrap.className = 'history-image-viewer';
                const stage = document.createElement('div');
                stage.className = 'history-image-stage';
                const tools = document.createElement('div');
                tools.className = 'history-image-tools';
                tools.innerHTML = `
                    <button type="button" data-zoom="reset" aria-label="重置缩放">重置</button>
                    <button type="button" data-zoom="out" aria-label="缩小">-</button>
                    <span data-zoom-label>100%</span>
                    <button type="button" data-zoom="in" aria-label="放大">+</button>
                `;
                img.className = 'history-preview-image';
                img.alt = fileName;
                img.draggable = false;
                stage.appendChild(img);
                wrap.appendChild(stage);
                wrap.appendChild(tools);
                body.innerHTML = '';
                body.appendChild(wrap);

                const state = { scale: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0, originX: 0, originY: 0 };
                const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
                const render = () => {
                    img.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
                    const label = tools.querySelector('[data-zoom-label]');
                    if (label) label.textContent = `${Math.round(state.scale * 100)}%`;
                    const resetBtn = tools.querySelector('[data-zoom="reset"]');
                    const isChanged = Math.abs(state.scale - 1) > 0.01 || Math.abs(state.x) > 0.5 || Math.abs(state.y) > 0.5;
                    if (resetBtn) resetBtn.classList.toggle('is-visible', isChanged);
                    stage.classList.toggle('is-dragging', state.dragging);
                };
                const zoomAt = (nextScale, clientX = null, clientY = null) => {
                    const previousScale = state.scale;
                    state.scale = clamp(nextScale, 0.25, 5);
                    if (state.scale === previousScale) return;
                    if (clientX !== null && clientY !== null) {
                        const rect = stage.getBoundingClientRect();
                        const px = clientX - rect.left - rect.width / 2 - state.x;
                        const py = clientY - rect.top - rect.height / 2 - state.y;
                        const ratio = state.scale / previousScale;
                        state.x -= px * (ratio - 1);
                        state.y -= py * (ratio - 1);
                    }
                    if (state.scale <= 1) {
                        state.x = 0;
                        state.y = 0;
                    }
                    render();
                };

                tools.addEventListener('click', (event) => {
                    const action = event.target.closest('button')?.dataset.zoom;
                    if (!action) return;
                    if (action === 'in') zoomAt(state.scale * 1.2);
                    if (action === 'out') zoomAt(state.scale / 1.2);
                    if (action === 'reset') {
                        state.scale = 1;
                        state.x = 0;
                        state.y = 0;
                        render();
                    }
                });

                stage.addEventListener('wheel', (event) => {
                    event.preventDefault();
                    const direction = event.deltaY < 0 ? 1.12 : 1 / 1.12;
                    zoomAt(state.scale * direction, event.clientX, event.clientY);
                }, { passive: false });

                stage.addEventListener('pointerdown', (event) => {
                    if (event.button !== 0 || state.scale <= 1) return;
                    state.dragging = true;
                    state.startX = event.clientX;
                    state.startY = event.clientY;
                    state.originX = state.x;
                    state.originY = state.y;
                    stage.setPointerCapture(event.pointerId);
                    render();
                });
                stage.addEventListener('pointermove', (event) => {
                    if (!state.dragging) return;
                    state.x = state.originX + event.clientX - state.startX;
                    state.y = state.originY + event.clientY - state.startY;
                    render();
                });
                const stopDrag = (event) => {
                    if (!state.dragging) return;
                    state.dragging = false;
                    try { stage.releasePointerCapture(event.pointerId); } catch (_) { }
                    render();
                };
                stage.addEventListener('pointerup', stopDrag);
                stage.addEventListener('pointercancel', stopDrag);
                render();
            };
            img.onerror = () => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                body.innerHTML = '<div class="history-preview-empty">图片预览失败，可以下载后查看。</div>';
            };
            img.src = previewUrl;
        }

        async function openHistoryPreview(item) {
            const path = String(item?.fullPath || '').trim();
            const fileName = String(item?.fileName || path.split('/').pop() || '文件');
            if (!path) return showModal('无法预览', '这条历史记录没有文件路径。', 'error');

            const modal = document.getElementById('history-preview-modal');
            const title = document.getElementById('history-preview-title');
            const body = document.getElementById('history-preview-body');
            const downloadLink = document.getElementById('history-preview-download');
            if (!modal || !title || !body || !downloadLink) return;

            const previewUrl = buildPreviewUrl(path);
            const downloadUrl = buildPreviewUrl(path, true);
            const ext = getPreviewExt(fileName, path);
            const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
            const officeExts = ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'];
            const textExts = ['.txt', '.md', '.csv', '.json', '.js', '.css', '.html', '.xml', '.log'];

            title.textContent = `预览：${fileName}`;
            downloadLink.href = downloadUrl;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            body.innerHTML = '<div class="history-preview-empty">正在加载预览...</div>';

            if (imageExts.includes(ext)) {
                renderHistoryImagePreview(body, previewUrl, fileName);
                return;
            }

            if (ext === '.pdf') {
                body.innerHTML = `<iframe src="${previewUrl}" class="w-full h-full border-0" title="${escapeHtml(fileName)}"></iframe>`;
                return;
            }

            if (textExts.includes(ext)) {
                try {
                    const res = await fetch(previewUrl);
                    if (!res.ok) throw new Error('load_failed');
                    const text = await res.text();
                    body.innerHTML = `<pre class="history-preview-text">${escapeHtml(text)}</pre>`;
                } catch (_) {
                    body.innerHTML = '<div class="history-preview-empty">文本预览失败，可以下载后查看。</div>';
                }
                return;
            }

            if (officeExts.includes(ext)) {
                const absUrl = new URL(previewUrl, window.location.origin).href;
                const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
                if (!isLocal) {
                    const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absUrl)}`;
                    body.innerHTML = `<iframe src="${officeUrl}" class="w-full h-full border-0" title="${escapeHtml(fileName)}"></iframe>`;
                    return;
                }
                body.innerHTML = `
                    <div class="history-preview-empty">
                        <div>
                            <p class="font-bold text-[#2c2c2c] mb-2">Office 在线预览需要部署到公网域名后使用。</p>
                            <p class="text-sm">本地环境可以先下载查看；部署到 Cloudflare 后，Word / Excel / PPT 会尝试在线预览。</p>
                        </div>
                    </div>`;
                return;
            }

            body.innerHTML = '<div class="history-preview-empty">当前格式暂不支持在线预览，可以下载后查看。</div>';
        }

        window.closeHistoryPreview = closeHistoryPreview;

        function renderHistory() {
            const listEl = document.getElementById('history-list');
            const emptyEl = document.getElementById('history-empty');
            const name = nameInput.value.trim();
            const keyword = String(document.getElementById('history-filter-subject').value || '').trim().toLowerCase();
            const dateFrom = String(document.getElementById('history-filter-date-from').value || '');
            const dateTo = String(document.getElementById('history-filter-date-to').value || '');
            let history = name ? getHistoryForName(name).filter(item => item.deleted !== true) : [];

            listEl.innerHTML = '';
            if (!name) {
                emptyEl.classList.remove('hidden');
                emptyEl.querySelector('p').textContent = '请先登录后查看历史';
                return;
            }
            history = history.filter((item) => {
                const displayType = String(item.displayType || '').toLowerCase();
                if (keyword && !displayType.includes(keyword)) return false;
                if (!dateFrom && !dateTo) return true;
                const dt = new Date(String(item.time || '').replace(/\./g, '/'));
                if (Number.isNaN(dt.getTime())) return true;
                if (dateFrom) {
                    const from = new Date(`${dateFrom}T00:00:00`);
                    if (dt < from) return false;
                }
                if (dateTo) {
                    const to = new Date(`${dateTo}T23:59:59`);
                    if (dt > to) return false;
                }
                return true;
            });

            if (history.length === 0) {
                emptyEl.classList.remove('hidden');
                emptyEl.querySelector('p').textContent = '没有符合筛选条件的记录';
                return;
            }

            emptyEl.classList.add('hidden');
            history.forEach((item, idx) => {
                const isDeleted = item.deleted === true;
                const canDelete = Boolean(item.deleteToken) && !isDeleted;
                const statusPill = isDeleted
                    ? '<span class="bg-[#e8e7e3] text-[#8a8a8a] px-2 py-0.5 rounded-full">已撤回</span>'
                    : '<span class="bg-[#e8f0e4] text-[#5a7a52] px-2 py-0.5 rounded-full">已提交</span>';
                const mode = String(item.submitMode || '').toLowerCase();
                const revision = Number(item.submitCount || 0);
                const modePill = mode === 'modified'
                    ? `<span class="bg-[#f5ece1] text-[#9a7a52] px-2 py-0.5 rounded-full">修改(v${Math.max(2, revision || 2)})</span>`
                    : '<span class="bg-[#efeef5] text-[#787596] px-2 py-0.5 rounded-full">新增</span>';
                const gradePill = item.score
                    ? `<span class="bg-[#f5f0e1] text-[#8a7a52] px-2 py-0.5 rounded-full">评分: ${item.score}</span>`
                    : '';
                const commentHtml = item.comment
                    ? `<p class="text-[11px] text-[#7a7a7a] mt-1 truncate" title="${item.comment}">评语：${item.comment}</p>`
                    : '';

                const div = document.createElement('div');
                div.className = "history-card-clickable bg-white rounded-2xl p-6 flex flex-col gap-3 border border-[#f0f0f0] min-h-[180px] relative overflow-hidden group transition-shadow";
                div.tabIndex = 0;
                div.setAttribute('role', 'button');
                div.setAttribute('title', '点击预览文件');
                div.setAttribute('data-history-id', item.id);
                if (canDelete) {
                    div.setAttribute('data-delete-token', item.deleteToken);
                    div.setAttribute('data-full-path', item.fullPath);
                }
                div.innerHTML = `
                    <div class="pointer-events-none absolute inset-0 z-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl" style="background: radial-gradient(600px circle at var(--glow-x, -1000px) var(--glow-y, -1000px), rgba(96, 165, 250, 0.06), transparent 40%);"></div>
                    <div class="relative z-10 flex flex-col h-full gap-3">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                ${canDelete ? `<input type="checkbox" class="history-checkbox w-3.5 h-3.5 accent-[#2c2c2c] rounded cursor-pointer" data-id="${item.id}" onchange="updateBatchUI()">` : ''}
                                <span class="text-[11px] font-bold px-3 py-1 rounded-full ${idx % 2 === 0 ? 'bg-[#f0ece1] text-[#7a7465]' : 'bg-[#efeef5] text-[#787596]'} truncate max-w-[70%]">${item.displayType || '-'}</span>
                            </div>
                            ${canDelete ? `<button onclick="event.stopPropagation();deleteHistory('${item.id}', '${item.fullPath}', '${item.deleteToken || ''}')" class="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 flex items-center justify-center rounded-full hover:bg-[#f5e4e4] text-[#b0a8a8] hover:text-[#c45c5c]" title="撤回"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>` : ''}
                        </div>
                        <h3 class="font-serif text-[17px] font-bold text-[#2c2c2c] leading-snug truncate" title="${item.fileName}">${item.fileName}</h3>
                        <div class="flex flex-wrap gap-1.5 text-[11px] font-medium mt-auto">
                            ${statusPill}${modePill}${gradePill}
                        </div>
                        <div class="flex items-center justify-between text-[11px] text-[#8a8a8a] pt-2 border-t border-[#f0f0f0]">
                            <span>${item.time || '-'}</span>
                            <span class="truncate ml-2">${item.receiptCode ? '回执 ' + item.receiptCode : ''}</span>
                        </div>
                        ${commentHtml}
                    </div>
                `;

                // 3D tilt + glow
                div.addEventListener('mousemove', (e) => {
                    const rect = div.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    div.style.setProperty('--glow-x', `${x}px`);
                    div.style.setProperty('--glow-y', `${y}px`);
                    const cx = rect.width / 2, cy = rect.height / 2;
                    const rx = ((y - cy) / cy) * -3;
                    const ry = ((x - cx) / cx) * 3;
                    div.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg) scale3d(1.01,1.01,1.01)`;
                    div.style.boxShadow = '0 12px 40px rgba(0,0,0,0.06)';
                });
                div.addEventListener('mouseleave', () => {
                    div.style.transform = '';
                    div.style.boxShadow = '';
                    div.style.setProperty('--glow-x', '-1000px');
                    div.style.setProperty('--glow-y', '-1000px');
                });
                div.addEventListener('click', (e) => {
                    if (e.target.closest('button,a,input,label')) return;
                    openHistoryPreview(item);
                });
                div.addEventListener('keydown', (e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    if (e.target.closest('button,a,input,label')) return;
                    e.preventDefault();
                    openHistoryPreview(item);
                });

                listEl.appendChild(div);
            });
            updateBatchUI();
        }

        function updateBatchUI() {
            const checks = document.querySelectorAll('.history-checkbox:checked');
            const batchBtn = document.getElementById('history-batch-delete');
            const countEl = document.getElementById('history-selected-count');
            if (checks.length > 0) {
                batchBtn.classList.remove('hidden');
                countEl.classList.remove('hidden');
                countEl.textContent = `已选 ${checks.length} 项`;
            } else {
                batchBtn.classList.add('hidden');
                countEl.classList.add('hidden');
            }
        }

        function toggleSelectAllHistory() {
            const selectAll = document.getElementById('history-select-all').checked;
            document.querySelectorAll('.history-checkbox').forEach(cb => cb.checked = selectAll);
            updateBatchUI();
        }

        async function batchDeleteHistory() {
            const checks = [...document.querySelectorAll('.history-checkbox:checked')];
            if (checks.length === 0) return;
            const confirmed = await confirmDialog(`确定要批量撤回 ${checks.length} 份作业吗？此操作不可恢复。`);
            if (!confirmed) return;
            const name = nameInput.value.trim();
            if (!name) return;

            let successCount = 0;
            for (const cb of checks) {
                const id = cb.getAttribute('data-id');
                const card = document.querySelector(`[data-history-id="${id}"]`);
                if (!card) continue;
                const token = card.getAttribute('data-delete-token');
                const path = card.getAttribute('data-full-path');
                if (!token || !path) continue;
                try {
                    const res = await fetch('/api/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path, deleteToken: token })
                    });
                    if (res.ok) {
                        const history = getHistoryForName(name).map(item => {
                            if (String(item.id) === String(id)) return { ...item, deleted: true };
                            return item;
                        });
                        setHistoryForName(name, history);
                        successCount++;
                    }
                } catch (e) { }
            }
            if (successCount > 0) {
                renderHistory();
                showModal('批量撤回完成', `成功撤回 ${successCount} 份作业。`, 'success');
            } else {
                showModal('撤回失败', '没有作业被成功撤回，请稍后重试。', 'error');
            }
            document.getElementById('history-select-all').checked = false;
        }

        function confirmDialog(message) {
            return new Promise((resolve) => {
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;inset:0;background:rgba(44,44,44,0.3);backdrop-filter:blur(4px);z-index:9999;animation:confirm-overlay-in 0.2s ease';
                const box = document.createElement('div');
                box.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(1);background:#f9f8f5;border-radius:20px;padding:32px 36px;z-index:10000;min-width:320px;max-width:400px;box-shadow:0 24px 64px rgba(0,0,0,0.12);animation:confirm-box-in 0.25s cubic-bezier(0.16,1,0.3,1)';
                box.innerHTML = `
                    <h3 style="font-family:Newsreader,serif;font-size:20px;color:#2c2c2c;margin-bottom:8px">确认操作</h3>
                    <p style="font-size:14px;color:#7a7a7a;line-height:1.6;margin-bottom:24px">${message}</p>
                    <div style="display:flex;gap:10px;justify-content:flex-end">
                        <button id="confirm-cancel" style="padding:8px 20px;border-radius:10px;border:1px solid #e5e4e0;background:#fff;color:#5c5c5c;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.15s">取消</button>
                        <button id="confirm-ok" style="padding:8px 20px;border-radius:10px;border:none;background:#2c2c2c;color:#f5f4ed;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.15s">确认撤回</button>
                    </div>
                `;
                document.body.appendChild(overlay);
                document.body.appendChild(box);
                const cleanup = (result) => {
                    box.style.opacity = '0';
                    box.style.transform = 'translate(-50%,-50%) scale(0.95)';
                    box.style.transition = 'all 0.15s ease';
                    overlay.style.opacity = '0';
                    overlay.style.transition = 'opacity 0.15s ease';
                    setTimeout(() => { overlay.remove(); box.remove(); }, 160);
                    resolve(result);
                };
                box.querySelector('#confirm-cancel').onclick = () => cleanup(false);
                box.querySelector('#confirm-ok').onclick = () => cleanup(true);
                overlay.onclick = () => cleanup(false);
            });
        }

        async function deleteHistory(id, filePath, deleteToken) {
            const confirmed = await confirmDialog('确定要从云端彻底删除这份作业吗？此操作不可恢复。');
            if (!confirmed) return;
            if (!deleteToken) {
                showModal("无法撤回", "这条历史记录没有删除凭证，可能是旧版本上传。请联系管理员处理。", "error");
                return;
            }
            const name = nameInput.value.trim();
            if (!name) {
                showModal("提示", "请先登录，再操作历史记录。", "error");
                return;
            }
            try {
                const res = await fetch('/api/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: filePath, deleteToken })
                });
                if (res.ok) {
                    const history = getHistoryForName(name).map((item) => {
                        if (String(item.id) === String(id)) return { ...item, deleted: true };
                        return item;
                    });
                    setHistoryForName(name, history);

                    const card = document.querySelector(`[data-history-id="${id}"]`);
                    if (card) {
                        const listEl = document.getElementById('history-list');
                        const siblings = [...listEl.children].filter(c => c !== card);

                        // FLIP: record old positions
                        const oldPositions = new Map();
                        siblings.forEach(el => {
                            oldPositions.set(el, el.getBoundingClientRect());
                        });

                        // Exit animation on deleted card
                        card.style.animation = 'card-exit 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards';
                        card.addEventListener('animationend', () => {
                            card.remove();

                            if (listEl.children.length === 0) {
                                document.getElementById('history-empty').classList.remove('hidden');
                                return;
                            }

                            // FLIP: calculate new positions & animate
                            siblings.forEach(el => {
                                if (!el.parentNode) return;
                                const oldRect = oldPositions.get(el);
                                const newRect = el.getBoundingClientRect();
                                const dx = oldRect.left - newRect.left;
                                const dy = oldRect.top - newRect.top;
                                if (dx === 0 && dy === 0) return;

                                el.style.transform = `translate(${dx}px, ${dy}px)`;
                                el.style.transition = 'none';
                                requestAnimationFrame(() => {
                                    requestAnimationFrame(() => {
                                        el.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)';
                                        el.style.transform = '';
                                        el.addEventListener('transitionend', () => {
                                            el.style.transition = '';
                                        }, { once: true });
                                    });
                                });
                            });
                        }, { once: true });
                    } else {
                        renderHistory();
                    }
                } else {
                    let err = "请稍后重试";
                    try { err = (await res.json()).error || err; } catch (e) { }
                    showModal("撤回失败", err, "error");
                }
            } catch (err) {
                showModal("网络错误", "撤回请求失败", "error");
            }
        }

        function ensureAiWelcome() {
            if (aiChatHistory.length === 0) {
                aiChatHistory.push({ role: 'assistant', content: '你好，我可以帮你梳理作业思路、检查结构、解释要求。' });
            }
            renderAiChat();
        }

        function renderAiChat() {
            const html = aiChatHistory.map((m) => {
                const isUser = m.role === 'user';
                const align = isUser ? 'justify-end' : 'justify-start';
                const bubble = isUser
                    ? 'bg-[#2c2c2c] text-[#f5f4ed]'
                    : 'bg-[#f0ece1] text-[#3c3c3c]';
                return `<div class="flex ${align}"><div class="max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${bubble}">${String(m.content || '').replace(/</g, '&lt;')}</div></div>`;
            }).join('');
            aiChatListEl.innerHTML = html;
            aiChatListEl.scrollTop = aiChatListEl.scrollHeight;
            if (mobileAiChatListEl) {
                mobileAiChatListEl.innerHTML = html;
                mobileAiChatListEl.scrollTop = mobileAiChatListEl.scrollHeight;
            }
        }

        async function sendAiChat(source = 'desktop') {
            const isMobile = source === 'mobile';
            const input = document.getElementById(isMobile ? 'mobile-ai-chat-input' : 'ai-chat-input') || document.getElementById('ai-chat-input');
            const sendBtn = document.getElementById(isMobile ? 'mobile-ai-chat-send' : 'ai-chat-send') || document.getElementById('ai-chat-send');
            const question = String(input?.value || '').trim();
            if (!question) return;

            const name = nameInput.value.trim();
            if (!name) {
                showModal("提示", "请先登录学生账号再使用 AI。", "error");
                return;
            }
            const subject = hiddenSelect.value || '';
            const deadline = deadlinesMap[subject] || '';
            aiChatHistory.push({ role: 'user', content: question });
            renderAiChat();
            input.value = '';
            if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.textContent = '思考中...';
            }

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30000);
            try {
                const res = await fetch('/api/ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        name,
                        subject,
                        deadline,
                        question,
                        history: aiChatHistory.slice(-8)
                    })
                });
                const rawText = await res.text();
                let data = {};
                try { data = JSON.parse(rawText || '{}'); } catch (_) { }
                if (!res.ok || !data?.answer) {
                    const errText = data?.error || `请求失败（HTTP ${res.status}）${rawText ? `：${String(rawText).slice(0, 180)}` : ''}`;
                    aiChatHistory.push({ role: 'assistant', content: errText, source: data?.source || `http_${res.status}` });
                } else {
                    aiChatHistory.push({ role: 'assistant', content: data.answer, source: data.source || 'unknown' });
                }
            } catch (err) {
                const isAbort = String(err?.name || '').toLowerCase().includes('abort');
                aiChatHistory.push({
                    role: 'assistant',
                    content: isAbort ? '请求超时，请稍后重试（可换短一点的问题）。' : '网络异常，请稍后重试。',
                    source: isAbort ? 'timeout' : 'network_error'
                });
            } finally {
                clearTimeout(timer);
                if (sendBtn) {
                    sendBtn.disabled = false;
                    sendBtn.textContent = '发送';
                }
                renderAiChat();
            }
        }

        window.sendAiChat = sendAiChat;

        const mainNav = document.getElementById('main-nav');
        const bttBtn = document.getElementById('btt-btn');
        let lastScrollY = window.scrollY;

        window.addEventListener('scroll', () => {
            const currentScrollY = window.scrollY;
            if (currentScrollY > 80 && currentScrollY > lastScrollY) {
                mainNav.classList.add('nav-hidden');
            } else {
                mainNav.classList.remove('nav-hidden');
            }
            if (currentScrollY > 300) {
                bttBtn.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
            } else {
                bttBtn.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
            }
            lastScrollY = currentScrollY;
        }, { passive: true });
