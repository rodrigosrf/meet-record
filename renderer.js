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

    window.electronAPI.onMeetingDetected(async (titles) => {
        // Se a reunião que paramos manualmente não está mais na lista, limpamos o bloqueio
        if (lastStoppedMeetingName && !titles.includes(lastStoppedMeetingName)) {
            lastStoppedMeetingName = "";
        }

        if (!isRecording) {
            // Filtra reuniões que não foram paradas manualmente
            const availableMeetings = titles.filter(t => t !== lastStoppedMeetingName);
            
            if (availableMeetings.length > 0) {
                // Pega a melhor correspondência entre as disponíveis
                const bestMatch = availableMeetings.find(t => t.includes('Reuni') || t.includes('Meeting')) || availableMeetings[0];
                handleMeetingDetected(bestMatch);
            }
        } else if (!isManualRecording) {
            // Se gravando e NÃO manual, verifica se a reunião ATUAL ainda existe
            const stillExists = titles.some(t => t === currentMeetingName);
            if (!stillExists) {
                console.log("Janela da reunião fechada. Finalizando gravação automática.");
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

    window.electronAPI.onTranscriptionStatus((data) => {
        if (data.status === 'queued') {
            queuedTranscriptions.add(data.fullPath);
            updateBackgroundTasksUI();
            addTranscriptionItem(data.file, data.fullPath, 'queued');
        } else if (data.status === 'started') {
            queuedTranscriptions.delete(data.fullPath);
            inProgressTranscriptions.add(data.fullPath);
            updateBackgroundTasksUI();
            
            // If already exists (from queued), update it, otherwise add it
            if (document.getElementById(`trans-${data.file.replace(/[^a-z0-9]/gi, '_')}`)) {
                updateTranscriptionItem(data.file, 'started');
            } else {
                addTranscriptionItem(data.file, data.fullPath, 'started');
            }
            
            statusLabel.textContent = "Transcrevendo...";
            statusDot.classList.add('processing');
        } else if (data.status === 'finished') {
            inProgressTranscriptions.delete(data.fullPath);
            updateBackgroundTasksUI();
            updateTranscriptionItem(data.file, 'finished');
            
            if (inProgressTranscriptions.size === 0) {
                statusLabel.textContent = "Transcrição Concluída!";
                statusDot.classList.remove('processing');
                setTimeout(() => {
                    if (!isRecording) statusLabel.textContent = "Aguardando Reunião...";
                }, 4000);
            }
        } else if (data.status === 'error') {
            inProgressTranscriptions.delete(data.fullPath);
            queuedTranscriptions.delete(data.fullPath);
            updateBackgroundTasksUI();
            updateTranscriptionItem(data.file, 'error');
            
            if (inProgressTranscriptions.size === 0) {
                statusLabel.textContent = "Erro na Transcrição";
                statusDot.classList.remove('processing');
                setTimeout(() => {
                    if (!isRecording) statusLabel.textContent = "Aguardando Reunião...";
                }, 6000);
            }
        } else if (data.status === 'canceled') {
            inProgressTranscriptions.delete(data.fullPath);
            queuedTranscriptions.delete(data.fullPath);
            updateBackgroundTasksUI();
            updateTranscriptionItem(data.file, 'canceled');
            
            if (inProgressTranscriptions.size === 0) {
                statusLabel.textContent = "Transcrição Cancelada";
                statusDot.classList.remove('processing');
                setTimeout(() => {
                    if (!isRecording) statusLabel.textContent = "Aguardando Reunião...";
                }, 3000);
            }
        }
    });
}

function updateBackgroundTasksUI() {
    const total = inProgressTranscriptions.size + queuedTranscriptions.size;
    if (total > 0) {
        backgroundTasks.classList.remove('hidden');
        const text = total > 1 ? 'Tarefas' : 'Tarefa';
        const detail = inProgressTranscriptions.size > 0 ? `(${inProgressTranscriptions.size} ativa)` : '(na fila)';
        tasksCount.textContent = `${total} ${text} de transcrição ${detail}`;
    } else {
        backgroundTasks.classList.add('hidden');
    }
}

function addTranscriptionItem(fileName, fullPath, status = 'started') {
    const id = `trans-${fileName.replace(/[^a-z0-9]/gi, '_')}`;
    if (document.getElementById(id)) return;

    const isQueued = status === 'queued';
    const item = document.createElement('div');
    item.className = `transcription-item ${isQueued ? 'queued' : ''}`;
    item.id = id;
    item.innerHTML = `
        <div class="item-icon">
            ${isQueued ? `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            ` : `
                <div class="mini-spinner-anim">
                    <div class="mini-bounce1"></div>
                    <div class="mini-bounce2"></div>
                </div>
            `}
        </div>
        <div class="item-details">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h4>${fileName}</h4>
                <button class="btn-cancel" onclick="cancelTranscription('${fullPath.replace(/\\/g, '\\\\')}')" title="Cancelar Transcrição">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <p class="status-text">${isQueued ? 'Aguardando na fila...' : 'Processando transcrição...'}</p>
            <div class="progress-mini">
                <div class="progress-mini-bar"></div>
            </div>
        </div>
    `;
    transcriptionContainer.appendChild(item);
}

async function cancelTranscription(filePath) {
    const result = await window.electronAPI.cancelTranscription(filePath);
    if (!result.success) {
        console.error("Erro ao cancelar transcrição:", result.error);
    }
}

window.cancelTranscription = cancelTranscription;

function updateTranscriptionItem(fileName, status) {
    const id = `trans-${fileName.replace(/[^a-z0-9]/gi, '_')}`;
    const item = document.getElementById(id);
    if (!item) return;

    const statusText = item.querySelector('.status-text');
    const iconContainer = item.querySelector('.item-icon');
    
    if (status === 'started') {
        item.classList.remove('queued');
        statusText.textContent = "Processando transcrição...";
        iconContainer.innerHTML = `
            <div class="mini-spinner-anim">
                <div class="mini-bounce1"></div>
                <div class="mini-bounce2"></div>
            </div>
        `;
        return;
    }

    const cancelBtn = item.querySelector('.btn-cancel');
    if (cancelBtn) cancelBtn.remove(); // Remove cancel button if process ends

    if (status === 'finished') {
        item.classList.add('finished');
        statusText.textContent = "Transcrição concluída com sucesso!";
        iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (status === 'error') {
        item.classList.add('error');
        statusText.textContent = "Erro ao transcrever arquivo.";
        iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    } else if (status === 'canceled') {
        item.classList.add('error');
        statusText.textContent = "Transcrição cancelada.";
        iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    }

    // Remove item after a delay
    setTimeout(() => {
        item.style.animation = 'fadeOut 0.5s ease forwards';
        setTimeout(() => item.remove(), 500);
    }, status === 'error' || status === 'canceled' ? 8000 : 5000);
}

async function toggleLibrary() {
    libraryPanel.classList.toggle('active');
    if (libraryPanel.classList.contains('active')) {
        renderLibrary();
    }
}

async function renderLibrary() {
    libraryContent.innerHTML = '<p style="text-align:center; opacity:0.5;">Buscando arquivos...</p>';
    const videos = await window.electronAPI.getLibraryVideos();
    
    if (videos.length === 0) {
        libraryContent.innerHTML = '<p style="text-align:center; opacity:0.5;">Nenhuma gravação encontrada.</p>';
        return;
    }

    libraryContent.innerHTML = '';
    videos.forEach(video => {
        const item = document.createElement('div');
        item.className = 'library-item';
        
        const dateStr = new Date(video.date).toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        const isProcessing = inProgressTranscriptions.has(video.path);
        const statusClass = video.transcribed ? 'badge-success' : (isProcessing ? 'badge-pending' : 'badge-pending');
        const statusText = video.transcribed ? 'Transcrito' : (isProcessing ? 'Transcrevendo...' : 'Pendente');

        item.innerHTML = `
            <div class="lib-item-info">
                <h4>${video.name}</h4>
                <span>${dateStr}</span>
            </div>
            <div class="lib-item-actions">
                <span class="badge ${statusClass}">
                    ${statusText}
                </span>
                <button class="btn-small ${video.transcribed || isProcessing ? 'hidden' : ''}" 
                        onclick="requestManualTranscription('${video.path.replace(/\\/g, '\\\\')}')">
                    Transcrever
                </button>
            </div>
        `;
        libraryContent.appendChild(item);
    });
}

async function requestManualTranscription(filePath) {
    inProgressTranscriptions.add(filePath); // Add immediately to UI state
    const result = await window.electronAPI.requestTranscription(filePath);
    if (result.success) {
        renderLibrary(); // Re-render to update the button state immediately
    } else {
        inProgressTranscriptions.delete(filePath);
        alert("Erro ao solicitar transcrição: " + result.error);
    }
}

// Attach to window so onclick works
window.requestManualTranscription = requestManualTranscription;

async function handleManualStart() {
    if (!config.outputDirectory) {
        statusLabel.textContent = "Aguardando Configuração";
        configAlert.classList.remove('hidden');
        return;
    }

    isManualRecording = true;
    statusLabel.textContent = "Buscando Janelas...";
    const sources = await window.electronAPI.getSources();
    
    // 1. Try to find an existing meeting window
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

    // 2. Fallback: Try to find a screen
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
    isManualRecording = false;
    currentMeetingName = title;
    meetingTitle.textContent = title;

    if (!config.outputDirectory) {
        statusLabel.textContent = "Aguardando Configuração";
        configAlert.classList.remove('hidden');
        return;
    }

    configAlert.classList.add('hidden');
    
    // Find the correct source
    const sources = await window.electronAPI.getSources();
    // Try to find the source that matches the title exactly
    const source = sources.find(s => s.name === title) || sources.find(s => s.name.includes(title) || title.includes(s.name));
    
    if (source) {
        startRecording(source.id);
    } else {
        // If specific window not found, maybe it's just general Teams
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

        mediaRecorder = new MediaRecorder(stream, { 
            mimeType: 'video/webm;codecs=vp9,opus' 
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
        
        // Update UI
        mainCard.classList.add('recording');
        statusDot.classList.add('active');
        statusLabel.textContent = "Gravando Reunião";
        stopBtn.classList.remove('hidden');
        startBtn.classList.add('hidden');
        
        startTime = Date.now();
        timerInterval = setInterval(updateTimer, 1000);
        
    } catch (err) {
        console.error("Erro ao iniciar gravação:", err);
    }
}

function stopRecording(isManual = false) {
    if (mediaRecorder && isRecording) {
        if (isManual) {
            lastStoppedMeetingName = currentMeetingName;
        }
        
        mediaRecorder.stop();
        isRecording = false;
        
        // Clean up stream
        const tracks = mediaRecorder.stream.getTracks();
        tracks.forEach(track => track.stop());
        
        // Update UI
        mainCard.classList.remove('recording');
        statusDot.classList.remove('active');
        statusLabel.textContent = "Aguardando Reunião...";
        meetingTitle.textContent = "Nenhuma reunião detectada";
        meetingTime.textContent = "00:00:00";
        stopBtn.classList.add('hidden');
        startBtn.classList.remove('hidden');
        
        clearInterval(timerInterval);
    }
}

async function saveRecording() {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    
    let fileName = "";
    const now = new Date();
    
    if (isManualRecording) {
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const minute = String(now.getMinutes()).padStart(2, '0');
        fileName = `gravacao-${month}-${day}-${hour}-${minute}.webm`;
    } else {
        const timestamp = now.toISOString().replace(/[:.]/g, '-');
        const safeTitle = currentMeetingName.replace(/[<>:"/\\|?*]/g, '');
        fileName = `${safeTitle}_${timestamp}.webm`;
    }
    
    // We need an IPC call to save the file since renderer can't write to arbitrary paths directly easily without nodeIntegration
    const result = await window.electronAPI.saveFile({ buffer, fileName });
    
    if (result.success) {
        console.log(`Arquivo salvo com sucesso: ${result.path}`);
    } else {
        console.error(`Erro ao salvar arquivo: ${result.error}`);
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

init();
