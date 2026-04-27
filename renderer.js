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

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let isManualRecording = false;
let startTime;
let timerInterval;
let currentMeetingName = "";
let config = {};

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
        stopRecording();
    });

    startBtn.addEventListener('click', () => {
        handleManualStart();
    });

    window.electronAPI.onMeetingDetected(async (titles) => {
        if (!isRecording) {
            // Pick the most likely meeting window (contains 'Reuni' or 'Meeting')
            const bestMatch = titles.find(t => t.includes('Reuni') || t.includes('Meeting')) || titles[0];
            handleMeetingDetected(bestMatch);
        } else if (!isManualRecording) {
            // If recording and NOT manual, check if the CURRENT meeting window is still in the list
            const stillExists = titles.some(t => t === currentMeetingName);
            if (!stillExists) {
                console.log("Janela da reunião fechada. Finalizando gravação automática.");
                stopRecording();
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
    });

    window.electronAPI.onTranscriptionStatus((data) => {
        if (data.status === 'started') {
            statusLabel.textContent = `Transcrevendo: ${data.file}...`;
            statusDot.classList.add('processing'); // We can add a CSS class for processing state
        } else if (data.status === 'finished') {
            statusLabel.textContent = "Transcrição Concluída!";
            statusDot.classList.remove('processing');
            setTimeout(() => {
                if (!isRecording) statusLabel.textContent = "Aguardando Reunião...";
            }, 5000);
        } else if (data.status === 'error') {
            statusLabel.textContent = "Erro na Transcrição";
            statusDot.classList.remove('processing');
            console.error("Whisper Error:", data.message);
        }
    });
}

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

function stopRecording() {
    if (mediaRecorder && isRecording) {
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
