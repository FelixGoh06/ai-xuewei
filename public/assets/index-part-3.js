// --- Added Animation Logic ---
        function bindGlowAndTilt() {
            document.querySelectorAll('.btn-glow').forEach(btn => {
                btn.addEventListener('mousemove', e => {
                    const rect = btn.getBoundingClientRect();
                    btn.style.setProperty('--glow-x', (e.clientX - rect.left) + 'px');
                    btn.style.setProperty('--glow-y', (e.clientY - rect.top) + 'px');
                });
            });

            document.querySelectorAll('.card-tilt').forEach(card => {
                card.addEventListener('mousemove', e => {
                    const rect = card.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    const centerX = rect.width / 2;
                    const centerY = rect.height / 2;

                    const rotateX = ((y - centerY) / centerY) * -4; // Max 4 deg
                    const rotateY = ((x - centerX) / centerX) * 4;

                    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
                });

                card.addEventListener('mouseleave', () => {
                    card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
                });
            });
        }
        bindGlowAndTilt();
