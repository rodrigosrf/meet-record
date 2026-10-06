const overlayContainer = document.querySelector('.overlay-container');
const overlayTimer = document.getElementById('overlayTimer');
const overlayPrintBtn = document.getElementById('overlayPrintBtn');
const overlayPauseBtn = document.getElementById('overlayPauseBtn');
const overlayStopBtn = document.getElementById('overlayStopBtn');
const pauseIcon = document.getElementById('pauseIcon');
const resumeIcon = document.getElementById('resumeIcon');

let isCurrentlyPaused = false;

// Listen for updates from main process
window.electronAPI.onOverlayUpdate((data) => {
    if (data.timer) {
        overlayTimer.textContent = data.timer;
    }
    if (data.isPaused !== undefined) {
        isCurrentlyPaused = !!data.isPaused;
        if (isCurrentlyPaused) {
            pauseIcon.classList.add('hidden');
            resumeIcon.classList.remove('hidden');
            overlayContainer.classList.add('paused');
        } else {
            pauseIcon.classList.remove('hidden');
            resumeIcon.classList.add('hidden');
            overlayContainer.classList.remove('paused');
        }
    }
    if (data.vuLevel !== undefined && overlayContainer) {
        // Voice Activity Ambient Glow
        const vu = Math.min(1, Math.max(0, data.vuLevel));
        if (vu > 0.04 && !isCurrentlyPaused) {
            const glowOpacity = Math.min(0.9, 0.35 + vu * 1.1);
            const glowBlur = 14 + vu * 26;
            overlayContainer.style.borderColor = `rgba(56, 189, 248, ${Math.min(1, 0.5 + glowOpacity * 0.5)})`;
            overlayContainer.style.boxShadow = `0 12px 36px rgba(0, 0, 0, 0.75), 0 0 ${glowBlur}px rgba(56, 189, 248, ${glowOpacity * 0.75}), inset 0 1px 0 rgba(255, 255, 255, 0.25)`;
        } else if (!isCurrentlyPaused) {
            overlayContainer.style.borderColor = 'rgba(56, 189, 248, 0.55)';
            overlayContainer.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.75), 0 0 16px rgba(56, 189, 248, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
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
