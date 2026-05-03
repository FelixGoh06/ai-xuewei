const rawFetch = window.fetch.bind(window);
        function getStudentToken() { return localStorage.getItem('studentToken') || ''; }
        function setStudentProfile(profile) { localStorage.setItem('studentProfile', JSON.stringify(profile || {})); }
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

        const tabStudent = document.getElementById('auth-tab-student');
        const tabAdmin = document.getElementById('auth-tab-admin');
        const subtitle = document.getElementById('auth-subtitle');
        const studentPanel = document.getElementById('student-login-panel');
        const adminPanel = document.getElementById('admin-login-panel');
        const studentErr = document.getElementById('student-login-err');
        const adminErr = document.getElementById('admin-login-err');
        const firstWrap = document.getElementById('first-change-wrap');
        const firstErr = document.getElementById('first-change-password-err');
        let pendingMustChange = false;
        let disableTilt = false;

        function setTab(mode) {
            if (mode === 'admin') {
                tabAdmin.classList.remove('text-[#8a8a8a]', 'border-transparent');
                tabAdmin.classList.add('text-[#2c2c2c]', 'border-[#2c2c2c]');
                tabStudent.classList.remove('text-[#2c2c2c]', 'border-[#2c2c2c]');
                tabStudent.classList.add('text-[#8a8a8a]', 'border-transparent');

                studentPanel.classList.add('hidden');
                adminPanel.classList.remove('hidden');
                subtitle.textContent = '管理员登录后可进入管理后台。';
                return;
            }
            tabStudent.classList.remove('text-[#8a8a8a]', 'border-transparent');
            tabStudent.classList.add('text-[#2c2c2c]', 'border-[#2c2c2c]');
            tabAdmin.classList.remove('text-[#2c2c2c]', 'border-[#2c2c2c]');
            tabAdmin.classList.add('text-[#8a8a8a]', 'border-transparent');

            adminPanel.classList.add('hidden');
            studentPanel.classList.remove('hidden');
            subtitle.textContent = '学生登录后可提交作业、查看个人历史记录。';
        }

        async function handleStudentLogin() {
            studentErr.classList.add('hidden');
            const login = String(document.getElementById('student-login-id').value || '').trim();
            const password = String(document.getElementById('student-login-pwd').value || '');
            if (!login || !password) {
                studentErr.textContent = '请输入账号和密码';
                studentErr.classList.remove('hidden');
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
                    studentErr.textContent = data?.error || '登录失败';
                    studentErr.classList.remove('hidden');
                    return;
                }
                localStorage.setItem('studentToken', data.token);
                setStudentProfile(data.user || {});
                pendingMustChange = Boolean(data.mustChangePassword);
                if (pendingMustChange) {
                    firstWrap.classList.remove('hidden');
                    return;
                }
                loginSuccess = true;
                disableTilt = true;
                btn.textContent = '登录成功';
                const card = document.querySelector('.card-tilt');
                card.style.transform = '';
                card.style.overflow = 'hidden';
                const children = Array.from(card.children);
                children.forEach((child, i) => {
                    child.style.transition = `opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1), transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)`;
                    child.style.transitionDelay = `${i * 0.04}s`;
                    child.style.opacity = '0';
                    child.style.transform = 'translateY(12px)';
                });

                setTimeout(() => {
                    card.style.transition = 'transform 0.65s cubic-bezier(0.65, 0, 0.35, 1), background-color 0.5s ease, border-color 0.3s ease, box-shadow 0.3s ease';
                    card.style.transform = 'scale(30)';
                    card.style.backgroundColor = '#f5f4ed';
                    card.style.borderColor = 'transparent';
                    card.style.boxShadow = 'none';
                    document.body.style.transition = 'background-color 0.5s ease';
                    document.body.style.backgroundColor = '#f5f4ed';
                }, 280);

                await new Promise(r => setTimeout(r, 900));
                window.location.href = '/';
                return;
            } finally {
                btn.disabled = false;
                if (!loginSuccess) btn.textContent = '登 录';
            }
        }

        async function handleAdminLogin() {
            adminErr.classList.add('hidden');
            const username = String(document.getElementById('admin-login-id').value || '').trim();
            const password = String(document.getElementById('admin-login-pwd').value || '');
            if (!username || !password) {
                adminErr.textContent = '请输入管理员账号和密码';
                adminErr.classList.remove('hidden');
                return;
            }
            const btn = document.getElementById('admin-login-btn');
            btn.disabled = true;
            btn.textContent = '登录中...';
            let loginSuccess = false;
            try {
                const res = await fetch('/api/admin/login', {
                    method: 'POST',
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data?.token) {
                    adminErr.textContent = data?.error || '登录失败';
                    adminErr.classList.remove('hidden');
                    return;
                }
                localStorage.setItem('adminToken', data.token);
                localStorage.setItem('adminName', data.user || username);
                loginSuccess = true;
                disableTilt = true;
                btn.textContent = '登录成功';
                const card = document.querySelector('.card-tilt');
                card.style.transform = '';
                card.style.overflow = 'hidden';
                const children = Array.from(card.children);
                children.forEach((child, i) => {
                    child.style.transition = `opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1), transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)`;
                    child.style.transitionDelay = `${i * 0.04}s`;
                    child.style.opacity = '0';
                    child.style.transform = 'translateY(12px)';
                });

                setTimeout(() => {
                    card.style.transition = 'transform 0.65s cubic-bezier(0.65, 0, 0.35, 1), background-color 0.5s ease, border-color 0.3s ease, box-shadow 0.3s ease';
                    card.style.transform = 'scale(30)';
                    card.style.backgroundColor = '#fbf9f4';
                    card.style.borderColor = 'transparent';
                    card.style.boxShadow = 'none';
                    document.body.style.transition = 'background-color 0.5s ease';
                    document.body.style.backgroundColor = '#fbf9f4';
                }, 280);

                await new Promise(r => setTimeout(r, 900));
                window.location.href = '/admin';
                return;
            } finally {
                btn.disabled = false;
                if (!loginSuccess) btn.textContent = '登 录';
            }
        }

        async function handleFirstChangePassword() {
            firstErr.classList.add('hidden');
            if (!pendingMustChange) return;
            const p1 = String(document.getElementById('first-new-password').value || '');
            const p2 = String(document.getElementById('first-new-password-2').value || '');
            if (p1.length < 6) {
                firstErr.textContent = '新密码至少 6 位';
                firstErr.classList.remove('hidden');
                return;
            }
            if (p1 !== p2) {
                firstErr.textContent = '两次输入不一致';
                firstErr.classList.remove('hidden');
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
                    firstErr.textContent = data?.error || '修改失败';
                    firstErr.classList.remove('hidden');
                    return;
                }
                btn.textContent = '登录成功';
                const card = document.querySelector('.card-tilt');
                const children = Array.from(card.children);
                children.forEach((child, i) => {
                    child.style.transition = `opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)`;
                    child.style.transitionDelay = `${i * 0.05}s`;
                    child.style.opacity = '0';
                    child.style.transform = 'translateY(15px)';
                });

                setTimeout(() => {
                    card.style.transition = 'transform 0.6s cubic-bezier(0.65, 0, 0.35, 1), background-color 0.6s ease';
                    card.style.transform = 'scale(30)';
                    card.style.backgroundColor = '#f5f4ed';
                    document.body.style.transition = 'background-color 0.6s ease';
                    document.body.style.backgroundColor = '#f5f4ed';
                }, 300);

                await new Promise(r => setTimeout(r, 900));
                window.location.href = '/';
                return;
            } finally {
                btn.disabled = false;
                btn.textContent = '保存新密码';
            }
        }

        tabStudent.addEventListener('click', () => setTab('student'));
        tabAdmin.addEventListener('click', () => setTab('admin'));
        document.getElementById('student-login-btn').addEventListener('click', handleStudentLogin);
        document.getElementById('student-login-pwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleStudentLogin(); });
        document.getElementById('admin-login-btn').addEventListener('click', handleAdminLogin);
        document.getElementById('admin-login-pwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAdminLogin(); });
        document.getElementById('first-change-password-btn').addEventListener('click', handleFirstChangePassword);
        const role = String(new URLSearchParams(window.location.search).get('role') || '').toLowerCase();
        setTab(role === 'admin' ? 'admin' : 'student');
