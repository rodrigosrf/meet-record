const statusDot = document.getElementById('statusDot');
const statusLabel = document.getElementById('statusLabel');
const meetingTitle = document.getElementById('meetingTitle');
const meetingTime = document.getElementById('meetingTime');
const mainCard = document.getElementById('mainCard');
const settingsBtn = document.getElementById('settingsBtn');
const savePathDisplay = document.getElementById('savePath');
const configAlert = document.getElementById('configAlert');

const stopBtn = document.getElementById('stopBtn');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const recordingButtons = document.getElementById('recordingButtons');
const pauseRecIcon = document.getElementById('pauseRecIcon');
const resumeRecIcon = document.getElementById('resumeRecIcon');

// New Transcription UI Elements
const transcriptionContainer = document.getElementById('transcriptionContainer');
const backgroundTasks = document.getElementById('backgroundTasks');
const tasksCount = document.getElementById('tasksCount');
const libraryBtn = document.getElementById('libraryBtn');
const libraryPanel = document.getElementById('libraryPanel');
const closeLibraryBtn = document.getElementById('closeLibraryBtn');
const libraryContent = document.getElementById('libraryContent');
const openFolderBtn = document.getElementById('openFolderBtn');
const summaryModal = document.getElementById('summaryModal');
const closeSummaryBtn = document.getElementById('closeSummaryBtn');
const summaryContent = document.getElementById('summaryContent');
const summaryTitle = document.getElementById('summaryTitle');
const notesContainer = document.getElementById('notesContainer');
const meetingNotes = document.getElementById('meetingNotes');
const recordVideoCheckbox = document.getElementById('recordVideoCheckbox');

// Audio Context for Visualizer
let audioCtx;
let analyser;
let dataArray;
let animationId;

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let isStarting = false;
let isManualRecording = false;
let startTime;
let timerInterval;
let isPaused = false;
let totalPausedTime = 0;
let lastPauseStart = 0;
let currentMeetingName = "";
let config = {};
let activeTranscriptions = 0;
let inProgressTranscriptions = new Set();
let queuedTranscriptions = new Set();
let lastStoppedMeetingName = "";
let allVideos = [];
let currentFilter = 'all';
let searchQuery = '';
let currentMeetingFolder = "";
let lastScreenshotData = null;
let isRecordingVideo = false;

// Initialize
async function init() {
    config = await window.electronAPI.getConfig();
    if (config.outputDirectory) {
        savePathDisplay.textContent = config.outputDirectory;
        configAlert.classList.add('hidden');
    }

    settingsBtn.addEventListener('click', () => {
        window.electronAPI.openSettings();
    });

    stopBtn.addEventListener('click', () => {
        stopRecording(true);
    });

    startBtn.addEventListener('click', () => {
        handleManualStart();
    });

    pauseBtn.addEventListener('click', () => {
        togglePause();
    });

    libraryBtn.addEventListener('click', () => {
        toggleLibrary();
    });

    closeLibraryBtn.addEventListener('click', () => {
        libraryPanel.classList.remove('active');
    });

    openFolderBtn.addEventListener('click', () => {
        window.electronAPI.openOutputDirectory();
    });

    // Library Search
    const librarySearch = document.getElementById('librarySearch');
    librarySearch.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderLibrary(true);
    });

    window.electronAPI.onMeetingDetected(async (titles) => {
        if (lastStoppedMeetingName && !titles.includes(lastStoppedMeetingName)) {
            lastStoppedMeetingName = "";
        }

        if (!isRecording) {
            const availableMeetings = titles.filter(t => t !== lastStoppedMeetingName);
            if (availableMeetings.length > 0) {
                const bestMatch = availableMeetings.find(t => t.includes('Reuni') || t.includes('Meeting')) || availableMeetings[0];
                handleMeetingDetected(bestMatch);
            }
        } else if (!isManualRecording) {
            const stillExists = titles.some(t => t === currentMeetingName);
            if (!stillExists) {
                stopRecording();
            }
        }
    });

    window.electronAPI.onNoMeetingDetected(() => {
        lastStoppedMeetingName = "";
        if (isRecording && !isManualRecording) {
            stopRecording();
        }
    });

    window.electronAPI.onConfigUpdated((newConfig) => {
        config = newConfig;
        if (config.outputDirectory) {
            savePathDisplay.textContent = config.outputDirectory;
            configAlert.classList.add('hidden');
        }
    });

    window.electronAPI.onStartManualRecording(() => {
        if (!isRecording) {
            handleManualStart();
        }
    });

    window.electronAPI.onStopRecording(() => {
        if (isRecording) {
            stopRecording(true);
        }
    });

    window.electronAPI.onTriggerManualScreenshot(() => {
        if (isRecording) {
            captureScreenshot();
            
            // Show notification for feedback when app is hidden
            const n = new Notification("Meet Record", {
                body: "Print manual capturado!",
                silent: true
            });
            setTimeout(() => n.close(), 2000);
        }
    });

    recordVideoCheckbox.addEventListener('change', () => {
        const audioLabel = document.querySelector('.mode-label.audio-mode');
        const videoLabel = document.querySelector('.mode-label.video-mode');
        if (recordVideoCheckbox.checked) {
            audioLabel.classList.remove('active');
            videoLabel.classList.add('active');
        } else {
            audioLabel.classList.add('active');
            videoLabel.classList.remove('active');
        }
    });

    window.electronAPI.onTogglePause(() => {
        togglePause();
    });
}

async function toggleLibrary() {
    libraryPanel.classList.toggle('active');
    if (libraryPanel.classList.contains('active')) {
        renderLibrary();
    }
}

async function renderLibrary(skipFetch = false) {
    if (!skipFetch) {
        libraryContent.innerHTML = '<p style="text-align:center; opacity:0.5;">Buscando arquivos...</p>';
        allVideos = await window.electronAPI.getLibraryVideos();
    }
    
    if (allVideos.length === 0) {
        libraryContent.innerHTML = '<p style="text-align:center; opacity:0.5;">Nenhuma gravação encontrada.</p>';
        return;
    }

    let filtered = allVideos.filter(rec => rec.name.toLowerCase().includes(searchQuery));

    if (filtered.length === 0) {
        libraryContent.innerHTML = '<p style="text-align:center; opacity:0.5;">Nenhum resultado encontrado.</p>';
        return;
    }

    const groups = groupVideosByDate(filtered);
    libraryContent.innerHTML = '';
    
    for (const dateLabel of Object.keys(groups)) {
        const groupHeader = document.createElement('div');
        groupHeader.className = 'date-group-header';
        groupHeader.textContent = dateLabel;
        libraryContent.appendChild(groupHeader);

        const groupContainer = document.createElement('div');
        groupContainer.className = 'date-group';
        
        for (const [index, rec] of groups[dateLabel].entries()) {
            const item = document.createElement('div');
            item.className = 'library-item';
            
            const dateStr = new Date(rec.date).toLocaleString('pt-BR', {
                hour: '2-digit', minute: '2-digit'
            });

            const order = groups[dateLabel].length - index;

            // Thumbnail Logic
            let thumbnailHtml = `
                <div class="lib-item-thumbnail">
                    <div class="no-thumb">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                    </div>
                </div>`;

            if (rec.metadata && rec.metadata.folderName) {
                const thumbResult = await window.electronAPI.getRecordingThumbnail(rec.metadata.folderName);
                if (thumbResult && thumbResult.success) {
                    const blob = new Blob([thumbResult.buffer], { type: 'image/jpeg' });
                    const thumbUrl = URL.createObjectURL(blob);
                    thumbnailHtml = `
                        <div class="lib-item-thumbnail">
                            <img src="${thumbUrl}" alt="Thumbnail">
                        </div>`;
                }
            }

            const isVideo = rec.path.endsWith('.webm');
            const buttonText = isVideo ? 'Assistir' : 'Ouvir';
            const badgeText = isVideo ? 'WEBM' : 'MP3';

            item.innerHTML = `
                ${thumbnailHtml}
                <button class="lib-item-delete" onclick="deleteRecording('${rec.path.replace(/\\/g, '\\\\')}')" title="Excluir Gravação">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
                <div class="lib-item-order">${order}</div>
                <div class="lib-item-info">
                    <h4>${rec.name}</h4>
                    <span>${dateStr}</span>
                    ${rec.metadata && rec.metadata.note ? `<p class="lib-item-notes">${rec.metadata.note}</p>` : ''}
                </div>
                <div class="lib-item-actions">
                     <button class="btn-small" onclick="openRecording('${rec.path.replace(/\\/g, '\\\\')}')">${buttonText}</button>
                     <span class="badge badge-success">${badgeText}</span>
                </div>
            `;
            groupContainer.appendChild(item);
        }
        libraryContent.appendChild(groupContainer);
    }
}

function groupVideosByDate(videos) {
    const groups = {};
    const today = new Date().setHours(0,0,0,0);
    const yesterday = new Date(today - 86400000).getTime();
    
    videos.forEach(video => {
        const videoDate = new Date(video.date);
        const videoDay = new Date(video.date).setHours(0,0,0,0);
        
        let label = '';
        if (videoDay === today) label = 'Hoje';
        else if (videoDay === yesterday) label = 'Ontem';
        else {
            label = videoDate.toLocaleDateString('pt-BR', { 
                day: '2-digit', month: 'long' 
            });
        }
        
        if (!groups[label]) groups[label] = [];
        groups[label].push(video);
    });
    
    return groups;
}

async function handleManualStart() {
    if (isRecording || isStarting) return;

    if (!config.outputDirectory) {
        statusLabel.textContent = "Aguardando Configuração";
        configAlert.classList.remove('hidden');
        return;
    }

    isStarting = true;
    startBtn.disabled = true;
    startBtn.textContent = "Iniciando...";
    const hasVideo = recordVideoCheckbox.checked;

    // Stop playback if active
    if (playbackAudio) {
        stopPlayback();
    }

    isManualRecording = true;
    statusLabel.textContent = "Buscando Janelas...";
    const sources = await window.electronAPI.getSources();
    
    const meetingSource = sources.find(s => {
        const name = s.name.toLowerCase();
        return name.includes('reuni') || name.includes('meeting') || name.includes('teams');
    });

    if (meetingSource) {
        currentMeetingName = meetingSource.name;
        meetingTitle.textContent = meetingSource.name;
        startRecording(meetingSource.id, hasVideo);
        return;
    }

    const screenSource = sources.find(s => s.id.startsWith('screen:')) || sources[0];
    if (screenSource) {
        currentMeetingName = "Gravação Manual";
        meetingTitle.textContent = "Gravação Manual (Tela)";
        startRecording(screenSource.id, hasVideo);
    } else {
        statusLabel.textContent = "Nenhuma fonte encontrada";
    }
}

async function handleMeetingDetected(title) {
    if (isRecording || isStarting) return;

    // Stop playback if active
    if (playbackAudio) {
        stopPlayback();
    }

    isStarting = true;
    isManualRecording = false;
    currentMeetingName = title;
    meetingTitle.textContent = title;

    if (!config.outputDirectory) {
        statusLabel.textContent = "Aguardando Configuração";
        configAlert.classList.remove('hidden');
        return;
    }

    configAlert.classList.add('hidden');
    
    const sources = await window.electronAPI.getSources();
    const source = sources.find(s => s.name === title) || sources.find(s => s.name.includes(title) || title.includes(s.name));
    
    if (source) {
        startRecording(source.id);
    } else {
        const teamsSource = sources.find(s => s.name.includes('Teams'));
        if (teamsSource) {
            startRecording(teamsSource.id);
        }
    }
}

async function startRecording(sourceId, hasVideo = false) {
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    const safeTitle = currentMeetingName.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_');
    currentMeetingFolder = `${timestamp}_${safeTitle}`;
    lastScreenshotData = null; // Reset for new meeting
    isRecordingVideo = hasVideo;

    try {
        const constraints = {
            audio: {
                mandatory: {
                    chromeMediaSource: 'desktop'
                }
            },
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: sourceId
                }
            }
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Setup Visualizer
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 256; // Increased for more detail
        analyser.smoothingTimeConstant = 0.8;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);

        // Start animation loop
        drawVisualizer();

        // Choose stream and mimeType
        let mimeType = 'audio/webm;codecs=opus';
        let streamToRecord = new MediaStream(stream.getAudioTracks());

        if (hasVideo) {
            mimeType = 'video/webm;codecs=vp9,opus';
            streamToRecord = stream;
        }

        mediaRecorder = new MediaRecorder(streamToRecord, { mimeType });

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                recordedChunks.push(e.data);
            }
        };

        mediaRecorder.onstop = () => {
            saveRecording();
        };

        mediaRecorder.start();
        isRecording = true;
        isStarting = false;
        
        mainCard.classList.add('recording');
        statusDot.classList.add('active');
        statusLabel.textContent = isRecordingVideo ? "Gravando Vídeo + Áudio..." : "Gravando Áudio...";
        startTime = Date.now();
        totalPausedTime = 0;
        isPaused = false;
        
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(updateTimer, 1000);
        
        recordingButtons.classList.remove('hidden');
        startBtn.classList.add('hidden');
        startBtn.disabled = false;
        startBtn.textContent = "Iniciar Gravação Manual";
        
        pauseBtn.querySelector('span').textContent = "Pausar";
        pauseRecIcon.classList.remove('hidden');
        resumeRecIcon.classList.add('hidden');
        statusDot.classList.remove('paused');
        
        // Setup Screenshot Stream
        setupScreenshotStream(stream);
        
        // Show Notes and Notification
        notesContainer.classList.remove('hidden');
        meetingNotes.value = "";
        
        const n = new Notification("Meet Record", {
            body: `Gravação Iniciada: ${currentMeetingName}`,
            silent: true
        });
        setTimeout(() => n.close(), 3000);

        // Show Overlay
        window.electronAPI.showOverlay();
        window.electronAPI.syncOverlay({ isPaused: false, timer: "00:00:00" });
        
    } catch (err) {
        console.error("Erro ao iniciar gravação:", err);
        statusLabel.textContent = "Erro ao gravar";
        isStarting = false;
        isRecording = false;
        startBtn.disabled = false;
        startBtn.textContent = "Iniciar Gravação Manual";
    }
}

function stopRecording(isManual = false) {
    if (mediaRecorder && isRecording) {
        if (isManual) {
            lastStoppedMeetingName = currentMeetingName;
        }
        
        mediaRecorder.stop();
        isRecording = false;
        isStarting = false;
        
        const tracks = mediaRecorder.stream.getTracks();
        tracks.forEach(track => track.stop());
        
        mainCard.classList.remove('recording');
        statusDot.classList.remove('active');
        statusLabel.textContent = "Salvando MP3...";
        meetingTitle.textContent = "Processando arquivo";
        meetingTime.textContent = "00:00:00";
        recordingButtons.classList.add('hidden');
        startBtn.classList.remove('hidden');
        startBtn.disabled = false;
        startBtn.textContent = "Iniciar Gravação Manual";
        
        clearInterval(timerInterval);
        
        // Cleanup screenshot video
        const video = document.getElementById('screenshotVideo');
        if (video) {
            video.srcObject = null;
            video.remove();
        }
        globalStream = null;
        
        // Hide Notes
        notesContainer.classList.add('hidden');

        // Stop visualizer
        cancelAnimationFrame(animationId);
        resetVisualizer();

        // Hide Overlay
        window.electronAPI.hideOverlay();
    }
}

function togglePause() {
    if (!mediaRecorder || !isRecording) return;

    if (!isPaused) {
        mediaRecorder.pause();
        isPaused = true;
        lastPauseStart = Date.now();
        statusDot.classList.remove('active');
        statusDot.classList.add('paused');
        statusLabel.textContent = "Gravação Pausada";
        
        pauseBtn.querySelector('span').textContent = "Retomar";
        pauseRecIcon.classList.add('hidden');
        resumeRecIcon.classList.remove('hidden');
        
        // Automatic screenshots removed
    } else {
        mediaRecorder.resume();
        isPaused = false;
        totalPausedTime += (Date.now() - lastPauseStart);
        statusDot.classList.add('active');
        statusDot.classList.remove('paused');
        statusLabel.textContent = "Gravando Áudio...";
        
        pauseBtn.querySelector('span').textContent = "Pausar";
        pauseRecIcon.classList.remove('hidden');
        resumeRecIcon.classList.add('hidden');
        
        setupScreenshotStream(globalStream);
    }

    // Sync with Overlay
    window.electronAPI.syncOverlay({ isPaused: isPaused });
}

function drawVisualizer() {
    animationId = requestAnimationFrame(drawVisualizer);
    
    const canvas = document.getElementById('visualizerCanvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth;
    const height = canvas.height = canvas.offsetHeight;
    
    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, width, height);
    
    const barWidth = (width / dataArray.length) * 2.5;
    let barHeight;
    let x = 0;

    // Create Gradient
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#38bdf8'); // var(--accent-color)
    gradient.addColorStop(1, '#818cf8'); // Lighter indigo

    for(let i = 0; i < dataArray.length; i++) {
        barHeight = (dataArray[i] / 255) * height;

        // Draw with some glow/softness
        ctx.fillStyle = gradient;
        
        // Rounded bars logic
        const radius = barWidth / 2;
        const barX = x;
        const barY = height - barHeight;
        
        if (barHeight > 1) {
            ctx.beginPath();
            ctx.roundRect(barX, barY, barWidth - 2, barHeight, [radius, radius, 0, 0]);
            ctx.fill();
            
            // Subtle Glow for higher peaks
            if (dataArray[i] > 150) {
                ctx.shadowBlur = 15;
                ctx.shadowColor = '#38bdf8';
            } else {
                ctx.shadowBlur = 0;
            }
        }

        x += barWidth + 1;
    }
}

function resetVisualizer() {
    const canvas = document.getElementById('visualizerCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

async function saveRecording() {
    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    
    let fileName = "";
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    const safeTitle = currentMeetingName.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_');
    
    if (isManualRecording) {
        fileName = `${timestamp}_grav_manual.webm`;
    } else {
        fileName = `${timestamp}_${safeTitle}.webm`;
    }

    // Short recording check (Auto-delete)
    const duration = Date.now() - startTime;
    if (duration < 60000) { // Less than 1 minute
        console.log("Recording too short, discarding...");
        
        // Discard screenshots as well
        if (currentMeetingFolder) {
            window.electronAPI.discardMeetingScreenshots(currentMeetingFolder);
        }

        statusLabel.textContent = "Aguardando Reunião...";
        meetingTitle.textContent = "Gravação descartada (muito curta)";
        recordedChunks = [];
        isManualRecording = false;
        
        const n = new Notification("Meet Record", {
            body: "Gravação e prints descartados automaticamente (< 1 min).",
        });
        setTimeout(() => n.close(), 3000);
        return;
    }

    const metadata = {
        title: currentMeetingName,
        date: now.toISOString(),
        note: meetingNotes.value,
        duration: duration,
        folderName: currentMeetingFolder
    };
    
    const result = await window.electronAPI.saveFile({ buffer, fileName, metadata, hasVideo: isRecordingVideo });
    
    if (result.success) {
        statusLabel.textContent = "Aguardando Reunião...";
        meetingTitle.textContent = "Nenhuma reunião detectada";
        meetingTime.textContent = "00:00:00"; // Reset time display
        renderLibrary();

        const n = new Notification("Meet Record", {
            body: "Gravação salva com sucesso!",
        });
        setTimeout(() => n.close(), 3000);
    } else {
        statusLabel.textContent = "Erro ao salvar";
        alert(`Erro: ${result.error}`);
    }
    
    recordedChunks = [];
    isManualRecording = false;
}

function updateTimer() {
    if (isPaused || !isRecording) return;
    
    const elapsed = (Date.now() - startTime) - totalPausedTime;
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    
    meetingTime.textContent = 
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    // Sync with Overlay
    window.electronAPI.syncOverlay({ timer: meetingTime.textContent });
}

async function captureScreenshot() {
    if (!isRecording || !globalStream) return;

    try {
        const video = document.getElementById('screenshotVideo');
        if (!video) return;

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        if (canvas.width === 0 || canvas.height === 0) return;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Manual capture always proceeds without similarity check
        
        canvas.toBlob(async (blob) => {
            if (!blob) return;
            const buffer = new Uint8Array(await blob.arrayBuffer());
            const now = new Date();
            const timestamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
            const fileName = `manual_screenshot_${timestamp}.jpg`;
            
            await window.electronAPI.saveScreenshot({ 
                buffer, 
                fileName, 
                folderName: currentMeetingFolder 
            });
        }, 'image/jpeg', 0.6);
    } catch (err) {
        console.error("Screenshot capture error:", err);
    }
}

let globalStream = null;

async function setupScreenshotStream(stream) {
    globalStream = stream;
    const video = document.createElement('video');
    video.id = 'screenshotVideo';
    video.srcObject = stream;
    video.muted = true;
    video.style.display = 'none';
    document.body.appendChild(video);
    
    video.onloadedmetadata = () => {
        video.play();
    };
}

let playbackAudio = null;
let playbackInterval = null;

async function openRecording(filePath) {
    try {
        if (isRecording) {
            alert("Não é possível reproduzir enquanto uma gravação está em andamento.");
            return;
        }

        if (filePath.endsWith('.webm')) {
            window.electronAPI.openFile(filePath);
            return;
        }

        const result = await window.electronAPI.getFileBuffer(filePath);
        if (result.success) {
            // Clean up previous playback
            stopPlayback();

            const blob = new Blob([result.buffer], { type: 'audio/mp3' });
            const url = URL.createObjectURL(blob);
            
            playbackAudio = new Audio(url);
            
            const playbackControls = document.getElementById('playbackControls');
            const cardControls = document.getElementById('cardControls');
            const playerFileName = document.getElementById('playerFileName');
            const playerRange = document.getElementById('playerRange');
            const playPauseBtn = document.getElementById('playPauseBtn');
            const stopPlaybackBtn = document.getElementById('stopPlaybackBtn');
            const playIcon = document.getElementById('playIcon');
            const pauseIcon = document.getElementById('pauseIcon');
            
            // Set UI state
            const fileName = filePath.split(/[\\/]/).pop();
            playerFileName.textContent = fileName;
            statusLabel.textContent = "Reproduzindo...";
            meetingTitle.textContent = "Modo Player";
            
            cardControls.classList.add('hidden');
            playbackControls.classList.remove('hidden');
            mainCard.classList.add('playing');
            
            playbackAudio.onloadedmetadata = () => {
                playerRange.max = playbackAudio.duration;
            };

            playbackAudio.ontimeupdate = () => {
                playerRange.value = playbackAudio.currentTime;
            };

            playbackAudio.onended = () => {
                stopPlayback();
            };

            playPauseBtn.onclick = () => {
                if (playbackAudio.paused) {
                    playbackAudio.play();
                    playIcon.classList.add('hidden');
                    pauseIcon.classList.remove('hidden');
                } else {
                    playbackAudio.pause();
                    playIcon.classList.remove('hidden');
                    pauseIcon.classList.add('hidden');
                }
            };

            playerRange.oninput = () => {
                playbackAudio.currentTime = playerRange.value;
            };

            stopPlaybackBtn.onclick = () => {
                stopPlayback();
            };

            // Start playing
            playbackAudio.play();
            playIcon.classList.add('hidden');
            pauseIcon.classList.remove('hidden');
            
        } else {
            alert(result.error);
        }
    } catch (err) {
        console.error("Erro ao carregar áudio:", err);
        alert("Erro ao carregar arquivo de áudio.");
    }
}

function stopPlayback() {
    if (playbackAudio) {
        playbackAudio.pause();
        const url = playbackAudio.src;
        if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
        }
        playbackAudio = null;
    }

    const playbackControls = document.getElementById('playbackControls');
    const cardControls = document.getElementById('cardControls');
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');

    playbackControls.classList.add('hidden');
    cardControls.classList.remove('hidden');
    mainCard.classList.remove('playing');
    
    statusLabel.textContent = "Aguardando Reunião...";
    meetingTitle.textContent = "Nenhuma reunião detectada";
    meetingTime.textContent = "00:00:00";
    
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
}

async function deleteRecording(filePath) {
    if (confirm("Tem certeza que deseja excluir esta gravação? Esta ação não pode ser desfeita.")) {
        const result = await window.electronAPI.deleteFile(filePath);
        if (result.success) {
            renderLibrary();
        } else {
            alert(`Erro ao excluir: ${result.error}`);
        }
    }
}

window.openRecording = openRecording;
window.deleteRecording = deleteRecording;

init();
