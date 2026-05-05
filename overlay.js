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
