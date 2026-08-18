const overlayContainer = document.querySelector('.overlay-container');
const overlayTimer = document.getElementById('overlayTimer');
const overlayPrintBtn = document.getElementById('overlayPrintBtn');
const overlayPauseBtn = document.getElementById('overlayPauseBtn');
const overlayStopBtn = document.getElementById('overlayStopBtn');
const pauseIcon = document.getElementById('pauseIcon');
const resumeIcon = document.getElementById('resumeIcon');

// Listen for updates from main process
window.electronAPI.onOverlayUpdate((data) => {
    if (data.timer) {
        overlayTimer.textContent = data.timer;
    }
    if (data.isPaused !== undefined) {
        if (data.isPaused) {
            pauseIcon.classList.add('hidden');
            resumeIcon.classList.remove('hidden');
            overlayTimer.style.opacity = '0.5';
        } else {
            pauseIcon.classList.remove('hidden');
            resumeIcon.classList.add('hidden');
            overlayTimer.style.opacity = '1';
        }
    }
    if (data.vuLevel !== undefined && overlayContainer) {
        // Voice Activity Ambient Glow
        const vu = Math.min(1, Math.max(0, data.vuLevel));
        if (vu > 0.04 && !data.isPaused) {
            const glowOpacity = Math.min(0.85, vu * 1.3);
            const glowBlur = 8 + vu * 22;
            overlayContainer.style.borderColor = `rgba(56, 189, 248, ${0.25 + glowOpacity * 0.55})`;
            overlayContainer.style.boxShadow = `0 8px 32px rgba(0, 0, 0, 0.4), 0 0 ${glowBlur}px rgba(56, 189, 248, ${glowOpacity * 0.65}), inset 0 0 10px rgba(129, 140, 248, ${glowOpacity * 0.35})`;
        } else {
            overlayContainer.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            overlayContainer.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.4)';
        }
    }
});

// Send actions to main process
overlayPrintBtn.addEventListener('click', () => {
    window.electronAPI.sendOverlayAction('print');
});

overlayPauseBtn.addEventListener('click', () => {
    window.electronAPI.sendOverlayAction('pause');
});

overlayStopBtn.addEventListener('click', () => {
    window.electronAPI.sendOverlayAction('stop');
});

// Shortcuts
window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'p') {
        window.electronAPI.sendOverlayAction('print');
    } else if (e.code === 'Space') {
        window.electronAPI.sendOverlayAction('pause');
    }
});
