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

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let isManualRecording = false;
let startTime;
let timerInterval;
let currentMeetingName = "";
let config = {};
let activeTranscriptions = 0;
let inProgressTranscriptions = new Set();
let queuedTranscriptions = new Set();
let lastStoppedMeetingName = "";
let allVideos = [];
let currentFilter = 'all';
let searchQuery = '';

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
    
    Object.keys(groups).forEach(dateLabel => {
        const groupHeader = document.createElement('div');
        groupHeader.className = 'date-group-header';
        groupHeader.textContent = dateLabel;
        libraryContent.appendChild(groupHeader);

        const groupContainer = document.createElement('div');
        groupContainer.className = 'date-group';
        
        groups[dateLabel].forEach(rec => {
            const item = document.createElement('div');
            item.className = 'library-item';
            
            const dateStr = new Date(rec.date).toLocaleString('pt-BR', {
                hour: '2-digit', minute: '2-digit'
            });

            item.innerHTML = `
                <div class="lib-item-info">
                    <h4>${rec.name}</h4>
                    <span>${dateStr}</span>
                </div>
                <div class="lib-item-actions">
                     <button class="btn-small" onclick="openRecording('${rec.path.replace(/\\/g, '\\\\')}')">Ouvir</button>
                     <span class="badge badge-success">MP3</span>
                </div>
            `;
            groupContainer.appendChild(item);
        });
        libraryContent.appendChild(groupContainer);
    });
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
    if (!config.outputDirectory) {
        statusLabel.textContent = "Aguardando Configuração";
        configAlert.classList.remove('hidden');
        return;
    }

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
        startRecording(meetingSource.id);
        return;
    }

    const screenSource = sources.find(s => s.id.startsWith('screen:')) || sources[0];
    if (screenSource) {
        currentMeetingName = "Gravação Manual";
        meetingTitle.textContent = "Gravação Manual (Tela)";
        startRecording(screenSource.id);
    } else {
        statusLabel.textContent = "Nenhuma fonte encontrada";
    }
}

async function handleMeetingDetected(title) {
    // Stop playback if active
    if (playbackAudio) {
        stopPlayback();
    }

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

async function startRecording(sourceId) {
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
        
        // Use only audio tracks for recording
        const audioStream = new MediaStream(stream.getAudioTracks());

        mediaRecorder = new MediaRecorder(audioStream, { 
            mimeType: 'audio/webm;codecs=opus' 
        });

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
        
        mainCard.classList.add('recording');
        statusDot.classList.add('active');
        statusLabel.textContent = "Gravando Áudio...";
        stopBtn.classList.remove('hidden');
        startBtn.classList.add('hidden');
        
        startTime = Date.now();
        timerInterval = setInterval(updateTimer, 1000);
        
    } catch (err) {
        console.error("Erro ao iniciar gravação:", err);
        statusLabel.textContent = "Erro ao gravar";
    }
}

function stopRecording(isManual = false) {
    if (mediaRecorder && isRecording) {
        if (isManual) {
            lastStoppedMeetingName = currentMeetingName;
        }
        
        mediaRecorder.stop();
        isRecording = false;
        
        const tracks = mediaRecorder.stream.getTracks();
        tracks.forEach(track => track.stop());
        
        mainCard.classList.remove('recording');
        statusDot.classList.remove('active');
        statusLabel.textContent = "Salvando MP3...";
        meetingTitle.textContent = "Processando arquivo";
        meetingTime.textContent = "00:00:00";
        stopBtn.classList.add('hidden');
        startBtn.classList.remove('hidden');
        
        clearInterval(timerInterval);
    }
}

async function saveRecording() {
    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    
    let fileName = "";
    const now = new Date();
    
    if (isManualRecording) {
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const minute = String(now.getMinutes()).padStart(2, '0');
        fileName = `audio-${month}-${day}-${hour}-${minute}.webm`;
    } else {
        const timestamp = now.toISOString().replace(/[:.]/g, '-');
        const safeTitle = currentMeetingName.replace(/[<>:"/\\|?*]/g, '');
        fileName = `${safeTitle}_${timestamp}.webm`;
    }
    
    const result = await window.electronAPI.saveFile({ buffer, fileName });
    
    if (result.success) {
        statusLabel.textContent = "Aguardando Reunião...";
        meetingTitle.textContent = "Nenhuma reunião detectada";
        meetingTime.textContent = "00:00:00"; // Reset time display
        renderLibrary();
    } else {
        statusLabel.textContent = "Erro ao salvar";
        alert(`Erro: ${result.error}`);
    }
    
    recordedChunks = [];
    isManualRecording = false;
}

function updateTimer() {
    const elapsed = Date.now() - startTime;
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    
    meetingTime.textContent = 
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

let playbackAudio = null;
let playbackInterval = null;

async function openRecording(filePath) {
    try {
        if (isRecording) {
            alert("Não é possível reproduzir enquanto uma gravação está em andamento.");
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

window.openRecording = openRecording;

init();
