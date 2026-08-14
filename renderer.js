import { getAudioInputDevices, createMixedAudioStream } from './src/renderer/audioDeviceManager.js';
import { openAudioRecording, stopPlaybackAudio } from './src/renderer/audioPlayer.js';
import { initLibraryManager, renderLibraryUI } from './src/renderer/libraryManager.js';
import { openTagEditorModal } from './src/renderer/tagEditor.js';
import { AudioVisualizer } from './src/renderer/audioVisualizer.js';

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

const libraryBtn = document.getElementById('libraryBtn');
const libraryPanel = document.getElementById('libraryPanel');
const closeLibraryBtn = document.getElementById('closeLibraryBtn');
const openFolderBtn = document.getElementById('openFolderBtn');
const notesContainer = document.getElementById('notesContainer');
const meetingNotes = document.getElementById('meetingNotes');
const recordVideoCheckbox = document.getElementById('recordVideoCheckbox');
const autoRecordCheckbox = document.getElementById('autoRecordCheckbox');
const titleInput = document.getElementById('titleInput');
const editTitleBtn = document.getElementById('editTitleBtn');
const audioDeviceSelect = document.getElementById('audioDeviceSelect');

// Cover Screenshot State
let hasAutoCoverBeenTaken = false;
let isCurrentMeetingFocused = false;

// Audio Context & Visualizer Engine
let audioCtx;
let analyser;
let dataArray;
let animationId;
let visualizerEngine;
let silenceCounter = 0;
let isAudioSilentWarningShown = false;
let silenceStartTime = null;
let silenceCheckInterval = null;

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let isStarting = false;
let isManualRecording = false;
let startTime;
let timerInterval;
let currentMeetingHandle = "";
let lastDetectedMeetings = [];
let manuallyStoppedMeetings = new Map();
const STOPPED_MEETING_COOLDOWN = 2 * 60 * 1000;
let currentMeetingFolder = "";
let currentMeetingName = "";
let isRecordingVideo = false;
let config = {};
let isTitleManuallyEdited = false;
let activeStreamCleanup = null;
let globalStream = null;
let isPaused = false;
let totalPausedTime = 0;
let lastPauseStart = 0;

// Initialize App
async function init() {
    config = await window.electronAPI.getConfig();
    if (config.outputDirectory) {
        savePathDisplay.textContent = config.outputDirectory;
        configAlert.classList.add('hidden');
    }

    if (config.autoRecord !== undefined) {
        autoRecordCheckbox.checked = config.autoRecord;
        updateAutoRecordModeUI(config.autoRecord);
    }

    // Populate Audio Hardware Devices
    await loadAudioDevices();

    // Setup Visualizer Engine & UI Mode Selectors
    visualizerEngine = new AudioVisualizer('visualizerCanvas', 'mainVisualizer');

    // Configurar botões de alternância de modos visuais
    const modeSelector = document.getElementById('vizModeSelector');
    if (modeSelector) {
        const modeButtons = modeSelector.querySelectorAll('.viz-mode-btn');
        const currentMode = visualizerEngine.getMode();
        modeButtons.forEach(btn => {
            if (btn.dataset.mode === currentMode) btn.classList.add('active');
            else btn.classList.remove('active');

            btn.addEventListener('click', () => {
                modeButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (visualizerEngine) visualizerEngine.setMode(btn.dataset.mode);
            });
        });
    }

    // Iniciar loop contínuo do visualizer (suporta repouso/standby e gravação)
    drawVisualizer();

    // Init Modules
    await initLibraryManager({
        onOpenRecording: (filePath) => openRecording(filePath),
        onDeleteRecording: (filePath) => deleteRecording(filePath),
        onOpenTagEditor: (filePath, tags, isFav) => openTagEditorModal(filePath, tags, isFav, {
            onSaveSuccess: () => renderLibraryUI({
                onOpenRecording: openRecording,
                onDeleteRecording: deleteRecording,
                onOpenTagEditor: openTagEditorModal
            })
        })
    });

    // Event Listeners
    settingsBtn.addEventListener('click', () => window.electronAPI.openSettings());
    stopBtn.addEventListener('click', () => stopRecording(true));
    startBtn.addEventListener('click', () => handleManualStart());
    pauseBtn.addEventListener('click', () => togglePause());

    libraryBtn.addEventListener('click', () => toggleLibrary());
    closeLibraryBtn.addEventListener('click', () => libraryPanel.classList.remove('active'));
    openFolderBtn.addEventListener('click', () => window.electronAPI.openOutputDirectory());
    document.getElementById('openLibraryFolderBtn')?.addEventListener('click', () => window.electronAPI.openOutputDirectory());

    window.electronAPI.onMeetingDetected(async (meetings) => {
        const now = Date.now();
        lastDetectedMeetings = meetings;
        
        const activeMeetingObj = meetings.find(m => m.handle === currentMeetingHandle) || meetings[0];
        isCurrentMeetingFocused = activeMeetingObj ? !!activeMeetingObj.isFocused : false;

        if (isRecording && !hasAutoCoverBeenTaken && isCurrentMeetingFocused) {
            const elapsed = (Date.now() - startTime) - totalPausedTime;
            if (elapsed >= 60000) {
                captureCoverScreenshot();
            }
        }

        for (const m of meetings) {
            if (manuallyStoppedMeetings.has(m.handle)) {
                manuallyStoppedMeetings.set(m.handle, now);
            }
        }

        for (const [handle, lastSeen] of manuallyStoppedMeetings.entries()) {
            if (now - lastSeen > STOPPED_MEETING_COOLDOWN) {
                manuallyStoppedMeetings.delete(handle);
            }
        }

        if (!isRecording) {
            if (!config.autoRecord) return;
            
            const availableMeetings = meetings.filter(m => !manuallyStoppedMeetings.has(m.handle));
            if (availableMeetings.length > 0) {
                const bestMatch = availableMeetings.find(m => m.title.includes('Reuni') || m.title.includes('Meeting')) || availableMeetings[0];
                handleMeetingDetected(bestMatch.title, bestMatch.handle);
            }
        } else if (!isManualRecording) {
            const currentMeeting = meetings.find(m => m.handle === currentMeetingHandle);
            if (!currentMeeting) {
                stopRecording();
            } else if (!isTitleManuallyEdited && titleInput.classList.contains('hidden') && currentMeeting.title !== currentMeetingName) {
                currentMeetingName = currentMeeting.title;
                meetingTitle.textContent = currentMeetingName;
            }
        }
    });

    window.electronAPI.onNoMeetingDetected(() => {
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
        if (config.autoRecord !== undefined) {
            autoRecordCheckbox.checked = config.autoRecord;
            updateAutoRecordModeUI(config.autoRecord);
        }
    });

    window.electronAPI.onStartManualRecording(() => {
        if (!isRecording) handleManualStart();
    });

    window.electronAPI.onStopRecording(() => {
        if (isRecording) stopRecording(true);
    });

    window.electronAPI.onTriggerManualScreenshot(() => {
        if (isRecording) {
            captureScreenshot();
            const n = new Notification("Meet Record", { body: "Print manual capturado!", silent: true });
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

    autoRecordCheckbox.addEventListener('change', () => {
        const isAuto = autoRecordCheckbox.checked;
        updateAutoRecordModeUI(isAuto);
        window.electronAPI.updateConfig({ autoRecord: isAuto });
    });

    window.electronAPI.onTogglePause(() => togglePause());

    meetingTitle.addEventListener('click', enterEditMode);
    editTitleBtn.addEventListener('click', enterEditMode);
    
    titleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') exitEditMode(true);
        if (e.key === 'Escape') exitEditMode(false);
    });
    titleInput.addEventListener('blur', () => exitEditMode(true));
}

async function loadAudioDevices() {
    if (!audioDeviceSelect) return;
    const devices = await getAudioInputDevices();
    
    audioDeviceSelect.innerHTML = '<option value="none">🔊 Apenas Outras Pessoas (Sem meu Mic)</option>';
    devices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = `🎙️ Incluir meu Mic: ${device.label || 'Microfone ' + (index + 1)}`;
        audioDeviceSelect.appendChild(option);
    });
}

function updateAutoRecordModeUI(isAuto) {
    const offLabel = document.querySelector('.mode-label.auto-off-mode');
    const onLabel = document.querySelector('.mode-label.auto-on-mode');
    if (isAuto) {
        offLabel?.classList.remove('active');
        onLabel?.classList.add('active');
    } else {
        offLabel?.classList.remove('active');
        onLabel?.classList.add('active');
    }
}

function enterEditMode() {
    if (meetingTitle.textContent === "Modo Player" || meetingTitle.textContent === "Processando arquivo") return;
    titleInput.value = meetingTitle.textContent === "Nenhuma reunião detectada" ? "" : meetingTitle.textContent;
    meetingTitle.classList.add('hidden');
    editTitleBtn.classList.add('hidden');
    titleInput.classList.remove('hidden');
    titleInput.focus();
    titleInput.select();
}

function exitEditMode(save) {
    if (save && titleInput.value.trim() !== "") {
        const newTitle = titleInput.value.trim();
        if (newTitle !== currentMeetingName) {
            currentMeetingName = newTitle;
            meetingTitle.textContent = newTitle;
            isTitleManuallyEdited = true;
        }
    }
    titleInput.classList.add('hidden');
    meetingTitle.classList.remove('hidden');
    editTitleBtn.classList.remove('hidden');
}

async function toggleLibrary() {
    libraryPanel.classList.toggle('active');
    if (libraryPanel.classList.contains('active')) {
        renderLibraryUI({
            onOpenRecording: openRecording,
            onDeleteRecording: deleteRecording,
            onOpenTagEditor: openTagEditorModal
        });
    }
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
    startBtn.querySelector('span').textContent = "Iniciando...";
    const hasVideo = recordVideoCheckbox.checked;

    stopPlaybackAudio();
    updatePlaybackControlsUI(false);

    isManualRecording = true;
    isTitleManuallyEdited = false;
    statusLabel.textContent = "Buscando Janelas...";
    const sources = await window.electronAPI.getSources();
    
    const meetingSource = sources.find(s => {
        const name = s.name.toLowerCase();
        return name.includes('reuni') || name.includes('meeting') || name.includes('teams');
    });

    if (meetingSource) {
        if (!isTitleManuallyEdited) {
            currentMeetingName = meetingSource.name;
            meetingTitle.textContent = meetingSource.name;
        }
        startRecording(meetingSource.id, "", hasVideo);
        return;
    }

    const screenSource = sources.find(s => s.id.startsWith('screen:')) || sources[0];
    if (screenSource) {
        if (!isTitleManuallyEdited) {
            currentMeetingName = "Gravação Manual";
            meetingTitle.textContent = "Gravação Manual (Tela)";
        }
        currentMeetingHandle = "manual_" + Date.now();
        startRecording(screenSource.id, "", hasVideo);
    } else {
        statusLabel.textContent = "Nenhuma fonte encontrada";
    }
}

async function handleMeetingDetected(title, handle) {
    if (isRecording || isStarting) return;

    stopPlaybackAudio();
    updatePlaybackControlsUI(false);

    isStarting = true;
    isManualRecording = false;
    if (!isTitleManuallyEdited) {
        currentMeetingName = title;
        meetingTitle.textContent = title;
    }
    currentMeetingHandle = handle;

    if (!config.outputDirectory) {
        statusLabel.textContent = "Aguardando Configuração";
        configAlert.classList.remove('hidden');
        return;
    }

    configAlert.classList.add('hidden');
    const sources = await window.electronAPI.getSources();
    const source = sources.find(s => s.name === title) || sources.find(s => s.name.includes(title) || title.includes(s.name));
    
    if (source) {
        startRecording(source.id, handle, recordVideoCheckbox.checked);
    } else {
        const teamsSource = sources.find(s => s.name.includes('Teams'));
        if (teamsSource) {
            startRecording(teamsSource.id, handle, recordVideoCheckbox.checked);
        }
    }
}

async function startRecording(sourceId, handle, hasVideo = false) {
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    const safeTitle = currentMeetingName.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_');
    currentMeetingFolder = `${timestamp}_${safeTitle}`;
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

        const rawStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Audio Hardware Device Mixing
        const selectedDeviceId = audioDeviceSelect ? audioDeviceSelect.value : 'none';
        const { combinedStream, cleanup } = await createMixedAudioStream({
            systemStream: rawStream,
            selectedDeviceId,
            includeMic: selectedDeviceId !== 'none'
        });
        
        // Ensure combinedStream has active audio tracks
        const audioTracks = combinedStream.getAudioTracks();
        if (!audioTracks || audioTracks.length === 0 || audioTracks[0].readyState !== 'live') {
            if (cleanup) cleanup();
            throw new Error("Nenhuma faixa de áudio ativa capturada do sistema.");
        }

        // Add track health event listeners
        audioTracks.forEach(track => {
            track.onmute = () => {
                console.warn("[Áudio] Faixa de áudio do sistema foi mutada pelo SO.");
                if (statusLabel && isRecording) {
                    statusLabel.textContent = "⚠️ Áudio do sistema mutado";
                }
            };
            track.onunmute = () => {
                console.log("[Áudio] Faixa de áudio do sistema desmutada.");
            };
            track.onended = () => {
                console.warn("[Áudio] Faixa de áudio encerrada inesperadamente.");
            };
        });
        
        activeStreamCleanup = cleanup;
        globalStream = combinedStream;

        // Setup Visualizer on System Audio Stream (ignoring mic for silence & visualizer analysis)
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        analyser = audioCtx.createAnalyser();
        const systemAudioTracks = rawStream.getAudioTracks();
        if (systemAudioTracks && systemAudioTracks.length > 0) {
            const systemAudioStream = new MediaStream([systemAudioTracks[0]]);
            const source = audioCtx.createMediaStreamSource(systemAudioStream);
            source.connect(analyser);
        } else {
            const source = audioCtx.createMediaStreamSource(combinedStream);
            source.connect(analyser);
        }
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        dataArray = new Uint8Array(analyser.frequencyBinCount);

        silenceCounter = 0;
        isAudioSilentWarningShown = false;
        silenceStartTime = Date.now();
        if (silenceCheckInterval) clearInterval(silenceCheckInterval);
        silenceCheckInterval = setInterval(checkSilenceAndAutoStop, 250);

        drawVisualizer();

        let mimeType = 'audio/webm;codecs=opus';
        let streamToRecord = new MediaStream(combinedStream.getAudioTracks());

        if (hasVideo) {
            mimeType = 'video/webm;codecs=vp9,opus';
            streamToRecord = combinedStream;
        }

        mediaRecorder = new MediaRecorder(streamToRecord, { mimeType });
        recordedChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = () => saveRecording();
        mediaRecorder.start();

        isRecording = true;
        isStarting = false;
        hasAutoCoverBeenTaken = false;
        recordVideoCheckbox.disabled = true;
        
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
        startBtn.querySelector('span').textContent = "Iniciar Gravação Manual";
        
        pauseBtn.querySelector('span').textContent = "Pausar";
        pauseRecIcon.classList.remove('hidden');
        resumeRecIcon.classList.add('hidden');
        statusDot.classList.remove('paused');
        
        setupScreenshotStream(combinedStream);
        
        notesContainer.classList.remove('hidden');
        meetingNotes.value = "";
        
        const n = new Notification("Meet Record", {
            body: `Gravação Iniciada: ${currentMeetingName}`,
            silent: true
        });
        setTimeout(() => n.close(), 3000);

        window.electronAPI.showOverlay();
        window.electronAPI.syncOverlay({ isPaused: false, timer: "00:00:00" });
        
    } catch (err) {
        console.error("Erro ao iniciar gravação:", err);
        statusLabel.textContent = "Erro ao gravar";
        isStarting = false;
        isRecording = false;
        startBtn.disabled = false;
        startBtn.querySelector('span').textContent = "Iniciar Gravação Manual";
        recordVideoCheckbox.disabled = false;
    }
}

function stopRecording(isManual = false) {
    if (mediaRecorder && isRecording) {
        if (!hasAutoCoverBeenTaken) {
            captureCoverScreenshot();
        }

        if (isManual) {
            lastDetectedMeetings.forEach(m => manuallyStoppedMeetings.set(m.handle, Date.now()));
            if (currentMeetingHandle) manuallyStoppedMeetings.set(currentMeetingHandle, Date.now());
        }
        
        mediaRecorder.stop();
        isRecording = false;
        isStarting = false;
        isTitleManuallyEdited = false;
        
        if (activeStreamCleanup) {
            activeStreamCleanup();
            activeStreamCleanup = null;
        }

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
        startBtn.querySelector('span').textContent = "Iniciar Gravação Manual";
        
        recordVideoCheckbox.disabled = false;
        clearInterval(timerInterval);
        if (silenceCheckInterval) {
            clearInterval(silenceCheckInterval);
            silenceCheckInterval = null;
        }
        silenceStartTime = null;
        
        const video = document.getElementById('screenshotVideo');
        if (video) {
            video.srcObject = null;
            video.remove();
        }
        globalStream = null;
        
        notesContainer.classList.add('hidden');
        resetVisualizer();

        window.electronAPI.hideOverlay();
    }
}

function togglePause() {
    if (!mediaRecorder || !isRecording) return;

    if (!isPaused) {
        mediaRecorder.pause();
        isPaused = true;
        lastPauseStart = Date.now();
        silenceStartTime = Date.now();
        statusDot.classList.remove('active');
        statusDot.classList.add('paused');
        statusLabel.textContent = "Gravação Pausada";
        
        pauseBtn.querySelector('span').textContent = "Retomar";
        pauseRecIcon.classList.add('hidden');
        resumeRecIcon.classList.remove('hidden');
    } else {
        mediaRecorder.resume();
        isPaused = false;
        totalPausedTime += (Date.now() - lastPauseStart);
        silenceStartTime = Date.now();
        statusDot.classList.add('active');
        statusDot.classList.remove('paused');
        statusLabel.textContent = "Gravando Áudio...";
        
        pauseBtn.querySelector('span').textContent = "Pausar";
        pauseRecIcon.classList.remove('hidden');
        resumeRecIcon.classList.add('hidden');
        
        setupScreenshotStream(globalStream);
    }

    window.electronAPI.syncOverlay({ isPaused: isPaused });
}

function checkSilenceAndAutoStop() {
    if (!isRecording || isPaused || !analyser || !dataArray) {
        silenceStartTime = Date.now();
        return;
    }

    analyser.getByteFrequencyData(dataArray);

    let total = 0;
    for (let i = 0; i < dataArray.length; i++) {
        total += dataArray[i];
    }
    const avg = total / dataArray.length;

    if (avg > 1.5) {
        silenceStartTime = Date.now();
    } else {
        const silenceLimitMinutes = config.autoStopSilenceMinutes !== undefined ? parseFloat(config.autoStopSilenceMinutes) : 1;
        if (silenceLimitMinutes > 0 && silenceStartTime) {
            const silentMs = Date.now() - silenceStartTime;
            const limitMs = silenceLimitMinutes * 60 * 1000;
            if (silentMs >= limitMs) {
                console.log(`[Autostop] Gravação finalizada automaticamente após ${silenceLimitMinutes} min de silêncio no áudio da reunião.`);
                
                const n = new Notification("Meet Record", {
                    body: `Gravação finalizada automaticamente (${silenceLimitMinutes} min sem som na reunião).`,
                });
                setTimeout(() => n.close(), 5000);

                stopRecording(false);
            }
        }
    }
}

function drawVisualizer() {
    if (animationId) {
        cancelAnimationFrame(animationId);
    }
    animationId = requestAnimationFrame(drawVisualizer);
    
    if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);

        if (isRecording && !isPaused) {
            let total = 0;
            for (let i = 0; i < dataArray.length; i++) {
                total += dataArray[i];
            }
            if (total === 0) {
                silenceCounter++;
                if (silenceCounter > 600 && !isAudioSilentWarningShown) {
                    isAudioSilentWarningShown = true;
                    if (statusLabel) {
                        statusLabel.textContent = isRecordingVideo 
                            ? "Gravando Vídeo + Áudio... (⚠️ Sem som no sistema)" 
                            : "Gravando Áudio... (⚠️ Sem som no sistema)";
                    }
                }
            } else {
                silenceCounter = 0;
                if (isAudioSilentWarningShown) {
                    isAudioSilentWarningShown = false;
                    if (statusLabel) {
                        statusLabel.textContent = isRecordingVideo 
                            ? "Gravando Vídeo + Áudio..." 
                            : "Gravando Áudio...";
                    }
                }
            }
        }
    }

    if (visualizerEngine) {
        visualizerEngine.draw(dataArray, isRecording, isPaused);
    }
}

function resetVisualizer() {
    if (visualizerEngine) {
        visualizerEngine.reset();
    }
}

async function saveRecording() {
    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const now = new Date();

    const duration = Date.now() - startTime;
    if (duration < 60000) {
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
    
    const result = await window.electronAPI.saveFile({ buffer, metadata, hasVideo: isRecordingVideo });
    
    if (result.success) {
        statusLabel.textContent = "Aguardando Reunião...";
        meetingTitle.textContent = "Nenhuma reunião detectada";
        meetingTime.textContent = "00:00:00";
        renderLibraryUI({
            onOpenRecording: openRecording,
            onDeleteRecording: deleteRecording,
            onOpenTagEditor: openTagEditorModal
        });

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

    window.electronAPI.syncOverlay({ timer: meetingTime.textContent });

    // Check for auto cover screenshot after 1 minute when Teams is in focus
    if (!hasAutoCoverBeenTaken && elapsed >= 60000 && isCurrentMeetingFocused) {
        captureCoverScreenshot();
    }
}

async function captureCoverScreenshot() {
    if (hasAutoCoverBeenTaken || !isRecording || !globalStream) return;
    hasAutoCoverBeenTaken = true;

    try {
        const video = document.getElementById('screenshotVideo');
        if (!video) return;

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        if (canvas.width === 0 || canvas.height === 0) return;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob(async (blob) => {
            if (!blob) return;
            const buffer = new Uint8Array(await blob.arrayBuffer());
            const now = new Date();
            const timestamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
            const prefix = currentMeetingFolder || `${timestamp}_meeting`;
            const fileName = `${prefix}_cover.jpg`;
            
            await window.electronAPI.saveScreenshot({ 
                buffer, 
                fileName, 
                folderName: prefix,
                metadata: { title: currentMeetingName || 'Sem_Titulo' }
            });
            console.log("Capa da gravação gerada automaticamente:", fileName);
        }, 'image/jpeg', 0.85);
    } catch (err) {
        console.error("Erro ao capturar capa da gravação:", err);
    }
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
        
        canvas.toBlob(async (blob) => {
            if (!blob) return;
            const buffer = new Uint8Array(await blob.arrayBuffer());
            const now = new Date();
            const timestamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
            const safeTitle = (currentMeetingName || 'Gravação Manual').replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_');
            const prefix = currentMeetingFolder || `${timestamp}_${safeTitle}`;
            const fileName = `${prefix}_manual_screenshot_${timestamp}.jpg`;
            
            await window.electronAPI.saveScreenshot({ 
                buffer, 
                fileName, 
                folderName: prefix,
                metadata: { title: currentMeetingName || 'Sem_Titulo' }
            });
        }, 'image/jpeg', 0.6);
    } catch (err) {
        console.error("Screenshot capture error:", err);
    }
}

async function setupScreenshotStream(stream) {
    globalStream = stream;
    const video = document.getElementById('screenshotVideo') || document.createElement('video');
    video.id = 'screenshotVideo';
    video.srcObject = stream;
    video.muted = true;
    video.style.display = 'none';
    if (!document.getElementById('screenshotVideo')) {
        document.body.appendChild(video);
    }
    
    video.onloadedmetadata = () => video.play();
}

async function openRecording(filePath) {
    if (isRecording) {
        alert("Não é possível reproduzir enquanto uma gravação está em andamento.");
        return;
    }
    updatePlaybackControlsUI(true);
    statusLabel.textContent = "Reproduzindo...";
    meetingTitle.textContent = "Modo Player";

    openAudioRecording(filePath, {
        onStateChange: (state) => {
            if (state === 'stopped' || state === 'ended') {
                updatePlaybackControlsUI(false);
                statusLabel.textContent = "Aguardando Reunião...";
                meetingTitle.textContent = "Nenhuma reunião detectada";
                meetingTime.textContent = "00:00:00";
            }
        }
    });
}

function updatePlaybackControlsUI(active) {
    const playbackControls = document.getElementById('playbackControls');
    const cardControls = document.getElementById('cardControls');
    if (playbackControls && cardControls) {
        if (active) {
            playbackControls.classList.remove('hidden');
            cardControls.classList.add('hidden');
            mainCard.classList.add('playing');
        } else {
            playbackControls.classList.add('hidden');
            cardControls.classList.remove('hidden');
            mainCard.classList.remove('playing');
        }
    }
}

async function deleteRecording(filePath) {
    if (confirm("Tem certeza que deseja excluir esta gravação? Esta ação não pode ser desfeita.")) {
        const result = await window.electronAPI.deleteFile(filePath);
        if (result.success) {
            renderLibraryUI({
                onOpenRecording: openRecording,
                onDeleteRecording: deleteRecording,
                onOpenTagEditor: openTagEditorModal
            });
        } else {
            alert(`Erro ao excluir: ${result.error}`);
        }
    }
}

init();
