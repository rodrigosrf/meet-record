import { getAudioInputDevices, createMixedAudioStream } from './src/renderer/audioDeviceManager.js';
import { openAudioRecording, stopPlaybackAudio, isPlaybackActive, isPlaybackPaused, getPlaybackFrequencyData } from './src/renderer/audioPlayer.js';
import { initLibraryManager, renderLibraryUI, updateLibraryPlayingState, getAllVideos } from './src/renderer/libraryManager.js';
import { openScreenshotGallery } from './src/renderer/screenshotGallery.js';
import { openTagEditorModal, closeTagEditorModal, getTagColor } from './src/renderer/tagEditor.js';
import { AudioVisualizer } from './src/renderer/audioVisualizer.js';
import { VideoCompositor } from './src/renderer/videoCompositor.js';
import { themeManager } from './src/renderer/themeManager.js';

let videoCompositor = null;

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

// Active recording tags elements
const activeRecTagsList = document.getElementById('activeRecTagsList');
const activeRecTagInput = document.getElementById('activeRecTagInput');
const addActiveRecTagBtn = document.getElementById('addActiveRecTagBtn');
const activeRecTagsSuggestions = document.getElementById('activeRecTagsSuggestions');
const toggleActiveTagsBtn = document.getElementById('toggleActiveTagsBtn');
const activeRecTagsDrawer = document.getElementById('activeRecTagsDrawer');
const toggleActiveTagsLabel = document.getElementById('toggleActiveTagsLabel');
let activeRecordingTags = [];

// Theme Header UI elements
const themeDropdownBtn = document.getElementById('themeDropdownBtn');
const themeDropdownMenu = document.getElementById('themeDropdownMenu');

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
let systemAudioSourceNode = null;
let systemAudioStream = null;
let consecutiveSpeechFrames = 0;
let isPromptingMeetingEnd = false;

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
    // Initialize Theme Manager & Ambient Glow
    themeManager.init();

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
    visualizerEngine.onVuUpdate = (vu) => {
        // Efeito de Iluminação Reativa Ambiente (Ambient Voice Glow)
        themeManager.applyAmbientGlow(vu);

        if (isRecording && !isPaused) {
            window.electronAPI.syncOverlay({ vuLevel: vu });
        }
    };

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
                if (visualizerEngine) {
                    visualizerEngine.setMode(btn.dataset.mode);
                }
            });
        });
    }

    // Configurar Theme Dropdown
    if (themeDropdownBtn && themeDropdownMenu) {
        themeDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            themeDropdownMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!themeDropdownMenu.contains(e.target) && !themeDropdownBtn.contains(e.target)) {
                themeDropdownMenu.classList.add('hidden');
            }
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
    closeLibraryBtn.addEventListener('click', () => closeLibrary());
    openFolderBtn.addEventListener('click', () => window.electronAPI.openOutputDirectory());
    document.getElementById('openLibraryFolderBtn')?.addEventListener('click', () => window.electronAPI.openOutputDirectory());

    // Tecla ESC para fechar modal de tags ou barra lateral da biblioteca
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const tagEditorBackdrop = document.getElementById('tagEditorBackdrop');
            if (tagEditorBackdrop && !tagEditorBackdrop.classList.contains('hidden')) {
                closeTagEditorModal();
                return;
            }

            if (libraryPanel && libraryPanel.classList.contains('active')) {
                closeLibrary();
                return;
            }
        }
    });

    if (toggleActiveTagsBtn) {
        toggleActiveTagsBtn.addEventListener('click', () => toggleActiveTagsDrawer());
    }
    if (addActiveRecTagBtn) {
        addActiveRecTagBtn.addEventListener('click', () => addActiveTagFromInput());
    }
    if (activeRecTagInput) {
        activeRecTagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addActiveTagFromInput();
            }
        });
    }

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
        } else {
            // Se estamos gravando e a reunião ativa foi encerrada
            if (currentMeetingHandle) {
                const currentMeeting = meetings.find(m => m.handle === currentMeetingHandle);
                if (!currentMeeting) {
                    promptTeamsMeetingEnded(currentMeetingName);
                } else if (!isTitleManuallyEdited && titleInput.classList.contains('hidden') && currentMeeting.title !== currentMeetingName) {
                    currentMeetingName = currentMeeting.title;
                    meetingTitle.textContent = currentMeetingName;
                }
            } else if (!isManualRecording && meetings.length === 0) {
                promptTeamsMeetingEnded(currentMeetingName);
            }
        }
    });

    window.electronAPI.onNoMeetingDetected(() => {
        if (isRecording) {
            if (currentMeetingHandle || /teams/i.test(currentMeetingName)) {
                promptTeamsMeetingEnded(currentMeetingName);
            }
        }
    });

    window.electronAPI.onConfigUpdated((newConfig) => {
        config = { ...config, ...newConfig };
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
        if (e.key === 'Escape') {
            e.stopPropagation();
            exitEditMode(false);
        }
    });
    titleInput.addEventListener('blur', () => exitEditMode(true));

    // Mouse tracking & ripples para VideoCompositor em gravações de tela
    window.addEventListener('mousemove', (e) => {
        if (videoCompositor && isRecording && isRecordingVideo) {
            const nx = e.clientX / window.innerWidth;
            const ny = e.clientY / window.innerHeight;
            videoCompositor.setCursorPosition(nx, ny);
        }
    });

    window.addEventListener('mousedown', (e) => {
        if (videoCompositor && isRecording && isRecordingVideo) {
            const nx = e.clientX / window.innerWidth;
            const ny = e.clientY / window.innerHeight;
            videoCompositor.addClick(nx, ny, e.button === 2 ? 'right' : 'left');
        }
    });
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

function closeLibrary() {
    if (libraryPanel && libraryPanel.classList.contains('active')) {
        libraryPanel.classList.remove('active');
    }
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

async function promptTeamsMeetingEnded(meetingTitle) {
    if (isPromptingMeetingEnd || !isRecording) return;
    isPromptingMeetingEnd = true;

    try {
        const titleToUse = meetingTitle || currentMeetingName || "Microsoft Teams";
        console.log(`[Teams] Janela da reunião "${titleToUse}" foi encerrada. Perguntando ao usuário se deseja finalizar gravação...`);
        
        const shouldStop = await window.electronAPI.askStopRecording({
            meetingTitle: titleToUse
        });

        if (shouldStop) {
            console.log("[Teams] Usuário confirmou encerramento da gravação.");
            stopRecording(false);
        } else {
            console.log("[Teams] Usuário optou por continuar a gravação.");
            isManualRecording = true;
            currentMeetingHandle = "";
        }
    } catch (err) {
        console.error("Erro ao solicitar confirmação de encerramento:", err);
    } finally {
        isPromptingMeetingEnd = false;
    }
}

async function initActiveRecordingTags() {
    activeRecordingTags = [];
    if (activeRecTagInput) activeRecTagInput.value = '';
    closeActiveTagsDrawer();
    await renderActiveRecTags();
    await renderActiveRecTagSuggestions();
}

function toggleActiveTagsDrawer() {
    if (!activeRecTagsDrawer) return;
    const isHidden = activeRecTagsDrawer.classList.contains('hidden');
    if (isHidden) {
        openActiveTagsDrawer();
    } else {
        closeActiveTagsDrawer();
    }
}

function openActiveTagsDrawer() {
    if (!activeRecTagsDrawer) return;
    activeRecTagsDrawer.classList.remove('hidden');
    if (toggleActiveTagsBtn) toggleActiveTagsBtn.classList.add('active');
    if (activeRecTagInput) setTimeout(() => activeRecTagInput.focus(), 50);
}

function closeActiveTagsDrawer() {
    if (!activeRecTagsDrawer) return;
    activeRecTagsDrawer.classList.add('hidden');
    if (toggleActiveTagsBtn) toggleActiveTagsBtn.classList.remove('active');
}

async function renderActiveRecTags() {
    if (toggleActiveTagsLabel) {
        toggleActiveTagsLabel.textContent = activeRecordingTags.length > 0 
            ? `Tags (${activeRecordingTags.length})` 
            : 'Tags';
    }
    if (!activeRecTagsList) return;
    if (activeRecordingTags.length === 0) {
        activeRecTagsList.innerHTML = '<span style="font-size: 0.72rem; opacity: 0.5;">Nenhuma tag adicionada.</span>';
        return;
    }
    const categories = await window.electronAPI.getTagCategories();
    activeRecTagsList.innerHTML = activeRecordingTags.map((tag, idx) => {
        const color = getTagColor(tag, categories);
        return `
            <span class="tag-badge tag-removable" data-tag-idx="${idx}" style="background-color: ${color}22; color: ${color}; border: 1px solid ${color}55;" title="Remover #${tag}">
                <span>#${tag}</span>
                <span class="tag-remove-icon">&times;</span>
            </span>
        `;
    }).join('');

    activeRecTagsList.querySelectorAll('.tag-removable').forEach(el => {
        el.onclick = () => {
            const idx = parseInt(el.getAttribute('data-tag-idx'), 10);
            if (!isNaN(idx)) {
                activeRecordingTags.splice(idx, 1);
                renderActiveRecTags();
                renderActiveRecTagSuggestions();
            }
        };
    });
}

async function renderActiveRecTagSuggestions() {
    if (!activeRecTagsSuggestions) return;
    const categories = await window.electronAPI.getTagCategories();
    const suggestionsMap = new Map();

    // Sugerir APENAS tags que já foram inseridas anteriormente em outros vídeos
    try {
        const videos = await window.electronAPI.getLibraryVideos();
        (videos || []).forEach(v => {
            if (v.metadata && Array.isArray(v.metadata.tags)) {
                v.metadata.tags.forEach(t => {
                    const tag = typeof t === 'string' ? t.trim() : '';
                    if (tag && !activeRecordingTags.includes(tag) && !suggestionsMap.has(tag)) {
                        suggestionsMap.set(tag, getTagColor(tag, categories));
                    }
                });
            }
        });
    } catch (e) { /* ignore */ }

    const entries = Array.from(suggestionsMap.entries()).slice(0, 15);
    if (entries.length === 0) {
        activeRecTagsSuggestions.innerHTML = '';
        return;
    }

    activeRecTagsSuggestions.innerHTML = entries.map(([tag, color]) => `
        <button type="button" class="tag-badge tag-suggestion active-suggestion-chip" data-tag="${tag}" style="background-color: ${color}18; color: ${color}; border: 1px solid ${color}44;" title="Adicionar #${tag}">
            + #${tag}
        </button>
    `).join('');

    activeRecTagsSuggestions.querySelectorAll('.active-suggestion-chip').forEach(btn => {
        btn.onclick = () => {
            const tag = btn.getAttribute('data-tag');
            if (tag && !activeRecordingTags.includes(tag)) {
                activeRecordingTags.push(tag);
                renderActiveRecTags();
                renderActiveRecTagSuggestions();
            }
        };
    });
}

function addActiveTagFromInput() {
    if (!activeRecTagInput) return;
    const val = activeRecTagInput.value.trim();
    if (!val) return;
    const parts = val.split(/[,;]+/).map(t => t.trim().replace(/^#/, '')).filter(t => t.length > 0);
    parts.forEach(p => {
        if (!activeRecordingTags.includes(p)) {
            activeRecordingTags.push(p);
        }
    });
    activeRecTagInput.value = '';
    renderActiveRecTags();
    renderActiveRecTagSuggestions();
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
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        dataArray = new Uint8Array(analyser.frequencyBinCount);

        const rawAudioTracks = rawStream.getAudioTracks();
        if (rawAudioTracks && rawAudioTracks.length > 0) {
            systemAudioStream = new MediaStream([rawAudioTracks[0]]);
            systemAudioSourceNode = audioCtx.createMediaStreamSource(systemAudioStream);
            systemAudioSourceNode.connect(analyser);

            rawAudioTracks[0].onended = () => {
                console.warn("[Áudio] Faixa de áudio do sistema foi encerrada.");
                if (isRecording && (currentMeetingHandle || /teams/i.test(currentMeetingName))) {
                    promptTeamsMeetingEnded(currentMeetingName);
                }
            };
        } else {
            console.warn("[Áudio] Nenhuma faixa de áudio de saída isolada capturada do sistema.");
            systemAudioStream = null;
            systemAudioSourceNode = null;
        }

        const rawVideoTracks = rawStream.getVideoTracks();
        if (rawVideoTracks && rawVideoTracks.length > 0) {
            rawVideoTracks[0].onended = () => {
                console.warn("[Vídeo] Faixa de vídeo da janela/tela foi encerrada.");
                if (isRecording && (currentMeetingHandle || /teams/i.test(currentMeetingName))) {
                    promptTeamsMeetingEnded(currentMeetingName);
                }
            };
        }

        consecutiveSpeechFrames = 0;
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
            const fxConfig = config.visualEffectsConfig || {};
            const rawVideoTracks = rawStream.getVideoTracks();

            // Usar compositor de vídeo se efeitos estiverem ativos
            if (rawVideoTracks.length > 0 && (fxConfig.cursorSpotlight !== false || fxConfig.clickRipples !== false || fxConfig.privacyBlur === true)) {
                try {
                    videoCompositor = new VideoCompositor({
                        cursorSpotlight: fxConfig.cursorSpotlight !== false,
                        clickRipples: fxConfig.clickRipples !== false,
                        privacyBlur: fxConfig.privacyBlur === true,
                        performanceProfile: fxConfig.performanceProfile || 'balanced'
                    });
                    const { composedTrack } = await videoCompositor.start(rawVideoTracks[0]);
                    streamToRecord = new MediaStream([composedTrack, ...combinedStream.getAudioTracks()]);
                } catch (compErr) {
                    console.warn("Falha ao iniciar compositor de vídeo, utilizando stream direto:", compErr);
                    streamToRecord = combinedStream;
                }
            } else {
                streamToRecord = combinedStream;
            }
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
        initActiveRecordingTags();
        
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
        consecutiveSpeechFrames = 0;
        isPromptingMeetingEnd = false;

        if (systemAudioSourceNode) {
            try {
                systemAudioSourceNode.disconnect();
            } catch (e) { /* ignore */ }
            systemAudioSourceNode = null;
        }

        if (systemAudioStream) {
            try {
                systemAudioStream.getTracks().forEach(t => t.stop());
            } catch (e) { /* ignore */ }
            systemAudioStream = null;
        }
        
        const video = document.getElementById('screenshotVideo');
        if (video) {
            video.srcObject = null;
            video.remove();
        }
        globalStream = null;

        if (videoCompositor) {
            videoCompositor.stop();
            videoCompositor = null;
        }
        
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
        consecutiveSpeechFrames = 0;
        return;
    }

    const rawAudioTracks = systemAudioStream ? systemAudioStream.getAudioTracks() : [];
    const isTrackDead = rawAudioTracks.length === 0 || rawAudioTracks[0].readyState === 'ended' || rawAudioTracks[0].muted;

    let isVoiceActive = false;

    if (!isTrackDead) {
        analyser.getByteFrequencyData(dataArray);

        // Analisar banda da voz humana: Bins 2 a 32 (~375 Hz a ~6000 Hz)
        // Ignoramos bins 0 e 1 (< 180 Hz) para não computar DC offset, zumbido elétrico de 50/60 Hz e chiado residual de placa
        let voiceSum = 0;
        let voiceBinsCount = 0;
        let voiceMax = 0;

        for (let i = 2; i <= 32 && i < dataArray.length; i++) {
            const val = dataArray[i];
            voiceSum += val;
            if (val > voiceMax) voiceMax = val;
            voiceBinsCount++;
        }

        const voiceAvg = voiceBinsCount > 0 ? voiceSum / voiceBinsCount : 0;

        // Limiar calibrado: voz humana na reunião gera voiceAvg > 15-60 e voiceMax > 50.
        // Ruído de fundo de placa em repouso normalmente fica em voiceAvg < 5 e voiceMax < 25.
        // Consideramos voz ativa se voiceAvg > 8 ou houver pico de voz voiceMax > 35.
        if (voiceAvg > 8 || voiceMax > 35) {
            isVoiceActive = true;
        }
    }

    if (isVoiceActive) {
        consecutiveSpeechFrames++;
        // Histerese: exige pelo menos 4 frames consecutivos (~1 segundo) de áudio ativo
        // para considerar que a reunião está com som e resetar o temporizador.
        // Evita que bips curtos de notificação (ex: Outlook, Slack) de 200ms resetem 4+ minutos de silêncio acumulado.
        if (consecutiveSpeechFrames >= 4) {
            silenceStartTime = Date.now();
        }
    } else {
        consecutiveSpeechFrames = 0;
        if (!silenceStartTime) {
            silenceStartTime = Date.now();
        }

        const silenceLimitMinutes = config.autoStopSilenceMinutes !== undefined ? parseFloat(config.autoStopSilenceMinutes) : 5;
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
    
    if (isRecording) {
        if (analyser && dataArray) {
            analyser.getByteFrequencyData(dataArray);

            if (!isPaused) {
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
            visualizerEngine.draw(dataArray, true, isPaused);
        }
    } else if (isPlaybackActive()) {
        const playbackData = getPlaybackFrequencyData();
        const paused = isPlaybackPaused();
        if (visualizerEngine) {
            visualizerEngine.draw(playbackData, true, paused);
        }
    } else {
        if (visualizerEngine) {
            visualizerEngine.draw(null, false, false);
        }
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

    // Extrair hashtags do campo de anotações
    const noteText = meetingNotes ? meetingNotes.value : "";
    const noteHashtags = (noteText.match(/#([a-zA-Z0-9_\u00C0-\u017F-]+)/g) || [])
        .map(h => h.replace(/^#/, '').trim());

    // Combinar tags ativas selecionadas + hashtags do texto
    const combinedTags = Array.from(new Set([
        ...activeRecordingTags,
        ...noteHashtags
    ])).filter(t => t.length > 0);

    const metadata = {
        title: currentMeetingName,
        date: now.toISOString(),
        note: noteText,
        tags: combinedTags,
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
    activeRecordingTags = [];
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
    const fileName = filePath.split(/[\\/]/).pop();
    meetingTitle.textContent = fileName || "Modo Player";

    // Setup prints button in player
    const playerPrintsBtn = document.getElementById('playerPrintsBtn');
    const playerPrintsCount = document.getElementById('playerPrintsCount');
    if (playerPrintsBtn) {
        const videos = getAllVideos() || [];
        const recObj = videos.find(v => v.path === filePath) || { path: filePath, name: fileName, metadata: {} };
        const folderName = recObj.metadata?.folderName || '';
        window.electronAPI.getRecordingScreenshots(folderName, filePath).then(screenshots => {
            if (screenshots && screenshots.length > 0) {
                playerPrintsBtn.classList.remove('hidden');
                if (playerPrintsCount) playerPrintsCount.textContent = `Prints (${screenshots.length})`;
                playerPrintsBtn.onclick = () => openScreenshotGallery(recObj);
            } else {
                playerPrintsBtn.classList.add('hidden');
            }
        }).catch(() => {
            playerPrintsBtn.classList.add('hidden');
        });
    }

    openAudioRecording(filePath, {
        onStateChange: (state) => {
            updateLibraryPlayingState(filePath, state);
            if (state === 'stopped' || state === 'ended') {
                updatePlaybackControlsUI(false);
                statusLabel.textContent = "Aguardando Reunião...";
                meetingTitle.textContent = "Nenhuma reunião detectada";
                meetingTime.textContent = "00:00:00";
            } else if (state === 'playing') {
                statusLabel.textContent = "Reproduzindo...";
                if (statusDot) {
                    statusDot.classList.add('playing');
                    statusDot.classList.remove('paused');
                }
            } else if (state === 'paused') {
                statusLabel.textContent = "Reprodução Pausada";
                if (statusDot) {
                    statusDot.classList.remove('playing');
                    statusDot.classList.add('paused');
                }
            }
        }
    });
}

function updatePlaybackControlsUI(active) {
    const playbackControls = document.getElementById('playbackControls');
    const cardControls = document.getElementById('cardControls');
    const playerPrintsBtn = document.getElementById('playerPrintsBtn');

    if (playbackControls && cardControls) {
        if (active) {
            playbackControls.classList.remove('hidden');
            cardControls.classList.add('hidden');
            mainCard.classList.add('playing');
            if (statusDot) {
                statusDot.classList.add('playing');
                statusDot.classList.remove('paused');
            }
        } else {
            playbackControls.classList.add('hidden');
            if (playerPrintsBtn) playerPrintsBtn.classList.add('hidden');
            cardControls.classList.remove('hidden');
            mainCard.classList.remove('playing');
            if (statusDot) {
                statusDot.classList.remove('playing', 'paused');
            }
            updateLibraryPlayingState(null, 'stopped');
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
