let playbackAudio = null;
let playbackAudioCtx = null;
let playbackSourceNode = null;
let playbackAnalyser = null;
let playbackDataArray = null;
let currentBlobUrl = null;
let currentSpeed = 1.0;

function formatTime(seconds) {
    if (isNaN(seconds) || seconds === null) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function ensureAudioGraph() {
    if (!playbackAudio) {
        playbackAudio = new Audio();
        playbackAudio.crossOrigin = 'anonymous';
    }
    if (!playbackAudioCtx) {
        playbackAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!playbackSourceNode && playbackAudioCtx && playbackAudio) {
        try {
            playbackSourceNode = playbackAudioCtx.createMediaElementSource(playbackAudio);
            playbackAnalyser = playbackAudioCtx.createAnalyser();
            playbackAnalyser.fftSize = 256;
            playbackAnalyser.smoothingTimeConstant = 0.8;
            playbackDataArray = new Uint8Array(playbackAnalyser.frequencyBinCount);

            playbackSourceNode.connect(playbackAnalyser);
            playbackAnalyser.connect(playbackAudioCtx.destination);
        } catch (e) {
            console.warn("Não foi possível conectar o MediaElementSource ao AudioContext:", e);
        }
    }
}

export function isPlaybackActive() {
    return !!(playbackAudio && playbackAudio.src && playbackAudio.src.length > 0);
}

export function isPlaybackPaused() {
    return !!(playbackAudio && playbackAudio.paused);
}

export function isPlayingAudio() {
    return !!(playbackAudio && !playbackAudio.paused && !playbackAudio.ended && playbackAudio.currentTime >= 0);
}

export function getPlaybackFrequencyData() {
    if (playbackAnalyser && playbackDataArray && isPlayingAudio()) {
        playbackAnalyser.getByteFrequencyData(playbackDataArray);
        return playbackDataArray;
    }
    return null;
}

export async function openAudioRecording(filePath, { onStateChange } = {}) {
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

        ensureAudioGraph();
        if (playbackAudioCtx && playbackAudioCtx.state === 'suspended') {
            await playbackAudioCtx.resume();
        }

        const blob = new Blob([result.buffer], { type: 'audio/mp3' });
        currentBlobUrl = URL.createObjectURL(blob);
        
        playbackAudio.src = currentBlobUrl;
        playbackAudio.playbackRate = currentSpeed;

        const playerFileName = document.getElementById('playerFileName');
        const playerRange = document.getElementById('playerRange');
        const playerTimeDisplay = document.getElementById('playerTimeDisplay');
        const playerCurrentTime = document.getElementById('playerCurrentTime');
        const playerTotalTime = document.getElementById('playerTotalTime');
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
            if (!playbackAudio) return;
            const currentFormatted = formatTime(playbackAudio.currentTime);
            const totalFormatted = formatTime(playbackAudio.duration);
            if (playerCurrentTime) playerCurrentTime.textContent = currentFormatted;
            if (playerTotalTime) playerTotalTime.textContent = totalFormatted;
            if (playerTimeDisplay) playerTimeDisplay.textContent = `${currentFormatted} / ${totalFormatted}`;
        }

        if (playPauseBtn) {
            playPauseBtn.onclick = async () => {
                if (!playbackAudio || !playbackAudio.src) return;
                if (playbackAudioCtx && playbackAudioCtx.state === 'suspended') {
                    await playbackAudioCtx.resume();
                }
                if (playbackAudio.paused) {
                    try {
                        await playbackAudio.play();
                    } catch (e) {
                        console.warn("Erro ao retomar áudio:", e);
                    }
                    if (playIcon) playIcon.classList.add('hidden');
                    if (pauseIcon) pauseIcon.classList.remove('hidden');
                    if (onStateChange) onStateChange('playing');
                } else {
                    playbackAudio.pause();
                    if (playIcon) playIcon.classList.remove('hidden');
                    if (pauseIcon) pauseIcon.classList.add('hidden');
                    if (onStateChange) onStateChange('paused');
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

        await playbackAudio.play();
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
        playbackAudio.currentTime = 0;
        playbackAudio.removeAttribute('src');
        playbackAudio.load();
    }
    if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
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
