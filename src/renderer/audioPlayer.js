let playbackAudio = null;
let currentSpeed = 1.0;

function formatTime(seconds) {
    if (isNaN(seconds) || seconds === null) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export async function openAudioRecording(filePath, { onStateChange }) {
    try {
        if (filePath.endsWith('.webm')) {
            window.electronAPI.openFile(filePath);
            return;
        }

        const result = await window.electronAPI.getFileBuffer(filePath);
        if (!result.success) {
            alert(result.error);
            return;
        }

        stopPlaybackAudio();

        const blob = new Blob([result.buffer], { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);
        
        playbackAudio = new Audio(url);
        playbackAudio.playbackRate = currentSpeed;

        const playerFileName = document.getElementById('playerFileName');
        const playerRange = document.getElementById('playerRange');
        const playerTimeDisplay = document.getElementById('playerTimeDisplay');
        const playPauseBtn = document.getElementById('playPauseBtn');
        const playIcon = document.getElementById('playIcon');
        const pauseIcon = document.getElementById('pauseIcon');
        const stopPlaybackBtn = document.getElementById('stopPlaybackBtn');
        const seekBackBtn = document.getElementById('seekBackBtn');
        const seekForwardBtn = document.getElementById('seekForwardBtn');

        const fileName = filePath.split(/[\\/]/).pop();
        if (playerFileName) playerFileName.textContent = fileName;

        playbackAudio.onloadedmetadata = () => {
            if (playerRange) playerRange.max = playbackAudio.duration;
            updateTimeDisplay();
        };

        playbackAudio.ontimeupdate = () => {
            if (playerRange) playerRange.value = playbackAudio.currentTime;
            updateTimeDisplay();
        };

        playbackAudio.onended = () => {
            stopPlaybackAudio();
            if (onStateChange) onStateChange('ended');
        };

        function updateTimeDisplay() {
            if (playerTimeDisplay && playbackAudio) {
                playerTimeDisplay.textContent = `${formatTime(playbackAudio.currentTime)} / ${formatTime(playbackAudio.duration)}`;
            }
        }

        if (playPauseBtn) {
            playPauseBtn.onclick = () => {
                if (!playbackAudio) return;
                if (playbackAudio.paused) {
                    playbackAudio.play();
                    if (playIcon) playIcon.classList.add('hidden');
                    if (pauseIcon) pauseIcon.classList.remove('hidden');
                } else {
                    playbackAudio.pause();
                    if (playIcon) playIcon.classList.remove('hidden');
                    if (pauseIcon) pauseIcon.classList.add('hidden');
                }
            };
        }

        if (playerRange) {
            playerRange.oninput = () => {
                if (playbackAudio) {
                    playbackAudio.currentTime = playerRange.value;
                    updateTimeDisplay();
                }
            };
        }

        if (seekBackBtn) {
            seekBackBtn.onclick = () => {
                if (playbackAudio) {
                    playbackAudio.currentTime = Math.max(0, playbackAudio.currentTime - 10);
                    updateTimeDisplay();
                }
            };
        }

        if (seekForwardBtn) {
            seekForwardBtn.onclick = () => {
                if (playbackAudio) {
                    playbackAudio.currentTime = Math.min(playbackAudio.duration, playbackAudio.currentTime + 10);
                    updateTimeDisplay();
                }
            };
        }

        if (stopPlaybackBtn) {
            stopPlaybackBtn.onclick = () => {
                stopPlaybackAudio();
                if (onStateChange) onStateChange('stopped');
            };
        }

        // Setup Speed Selector Buttons
        setupSpeedButtons();

        playbackAudio.play();
        if (playIcon) playIcon.classList.add('hidden');
        if (pauseIcon) pauseIcon.classList.remove('hidden');

        if (onStateChange) onStateChange('playing');

    } catch (err) {
        console.error("Error playing audio recording:", err);
        alert("Erro ao carregar arquivo de áudio.");
    }
}

export function stopPlaybackAudio() {
    if (playbackAudio) {
        playbackAudio.pause();
        const url = playbackAudio.src;
        if (url && url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
        }
        playbackAudio = null;
    }
}

export function setPlaybackSpeed(speed) {
    currentSpeed = speed;
    if (playbackAudio) {
        playbackAudio.playbackRate = speed;
    }
    updateSpeedUI(speed);
}

function setupSpeedButtons() {
    const speedChips = document.querySelectorAll('.speed-chip');
    speedChips.forEach(chip => {
        chip.onclick = () => {
            const speed = parseFloat(chip.dataset.speed || 1.0);
            setPlaybackSpeed(speed);
        };
    });
    updateSpeedUI(currentSpeed);
}

function updateSpeedUI(speed) {
    const speedChips = document.querySelectorAll('.speed-chip');
    speedChips.forEach(chip => {
        const val = parseFloat(chip.dataset.speed);
        if (val === speed) {
            chip.classList.add('active');
        } else {
            chip.classList.remove('active');
        }
    });
}
