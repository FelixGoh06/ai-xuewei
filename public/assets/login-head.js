function revealLoginPage() {
    if (!document.body) return;
    document.body.style.opacity = '1';
    requestAnimationFrame(() => {
        document.querySelectorAll('.animate-float-in').forEach((el) => {
            el.addEventListener('animationend', () => {
                el.classList.remove('animate-float-in');
                el.style.opacity = '';
                el.style.transform = '';
            }, { once: true });
        });
        document.body.classList.add('login-ready');
    });
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', revealLoginPage, { once: true });
} else {
    revealLoginPage();
}
