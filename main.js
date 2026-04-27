import { app, BrowserWindow, ipcMain, desktopCapturer, dialog, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import fs from 'fs';
import Store from 'electron-store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new Store();

let mainWindow;
let settingsWindow;
let detectionInterval;
const activeProcesses = new Map();
const transcriptionQueue = [];
let isProcessingQueue = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        title: 'Meet Recorder - Monitor',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        autoHideMenuBar: true,
        backgroundColor: '#0f172a'
    });

    mainWindow.loadFile('index.html');
}

function createSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 850,
        height: 600,
        title: 'Configurações',
        parent: mainWindow,
        modal: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        autoHideMenuBar: true
    });

    settingsWindow.loadFile('settings.html');
    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();
    startDetectionLoop();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('get-sources', async () => {
    return await desktopCapturer.getSources({ types: ['window', 'screen'] });
});

ipcMain.handle('select-directory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (!canceled) {
        store.set('outputDirectory', filePaths[0]);
        mainWindow.webContents.send('config-updated', { outputDirectory: filePaths[0] });
        return filePaths[0];
    }
    return null;
});

ipcMain.handle('get-config', () => {
    return {
        outputDirectory: store.get('outputDirectory'),
        autoTranscribe: store.get('autoTranscribe', true),
        aiConfig: store.get('aiConfig', {
            provider: 'openrouter',
            model: 'openai/gpt-4o',
            apiKey: '',
            systemPrompt: 'Você é um assistente útil que resume reuniões de forma executiva, destacando pontos principais, decisões tomadas e próximos passos.',
            autoSummarize: false
        })
    };
});

ipcMain.handle('update-config', (event, newConfig) => {
    if (newConfig.outputDirectory !== undefined) {
        store.set('outputDirectory', newConfig.outputDirectory);
        mainWindow.webContents.send('config-updated', { outputDirectory: newConfig.outputDirectory });
    }
    if (newConfig.autoTranscribe !== undefined) {
        store.set('autoTranscribe', newConfig.autoTranscribe);
    }
    if (newConfig.aiConfig !== undefined) {
        const currentAiConfig = store.get('aiConfig') || {};
        store.set('aiConfig', { ...currentAiConfig, ...newConfig.aiConfig });
    }
    return { success: true };
});

ipcMain.on('open-settings', () => {
    createSettingsWindow();
});

ipcMain.handle('open-output-directory', async () => {
    const outputDir = store.get('outputDirectory');
    if (outputDir && fs.existsSync(outputDir)) {
        shell.openPath(outputDir);
        return { success: true };
    }
    return { success: false, error: 'Diretório não configurado ou não encontrado.' };
});

ipcMain.handle('get-library-videos', async () => {
    const outputDir = store.get('outputDirectory');
    if (!outputDir || !fs.existsSync(outputDir)) return [];

    const videos = [];
    
    function scanDir(currentPath) {
        const files = fs.readdirSync(currentPath);
        files.forEach(file => {
            const fullPath = path.join(currentPath, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                scanDir(fullPath);
            } else if (file.endsWith('.webm')) {
                const baseName = path.parse(file).name;
                const dir = path.dirname(fullPath);
                const hasTranscription = fs.readdirSync(dir).some(f => 
                    f.startsWith(baseName) && (f.endsWith('.txt') || f.endsWith('.srt'))
                );
                videos.push({
                    name: file,
                    path: fullPath,
                    date: stat.birthtime,
                    transcribed: hasTranscription
                });
            }
        });
    }

    try {
        scanDir(outputDir);
        
        // Add summary status
        videos.forEach(v => {
            const baseName = path.parse(v.path).name;
            const dir = path.dirname(v.path);
            v.summarized = fs.existsSync(path.join(dir, `${baseName}_summary.md`));
        });

        return videos.sort((a, b) => b.date - a.date);
    } catch (err) {
        console.error("Error scanning library:", err);
        return [];
    }
});

ipcMain.handle('request-transcription', async (event, filePath) => {
    if (fs.existsSync(filePath)) {
        addToTranscriptionQueue(filePath);
        return { success: true };
    }
    return { success: false, error: 'File not found' };
});

ipcMain.handle('cancel-transcription', async (event, filePath) => {
    const childProcess = activeProcesses.get(filePath);
    const queueIndex = transcriptionQueue.indexOf(filePath);

    if (childProcess || queueIndex > -1) {
        if (childProcess) {
            childProcess.kill();
            activeProcesses.delete(filePath);
        }
        if (queueIndex > -1) {
            transcriptionQueue.splice(queueIndex, 1);
        }
        
        const baseName = path.parse(filePath).name;
        const dir = path.dirname(filePath);
        const extensions = ['.txt', '.srt', '.vtt', '.tsv', '.json'];
        try {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                if (file.startsWith(baseName) && extensions.some(ext => file.endsWith(ext))) {
                    fs.unlinkSync(path.join(dir, file));
                }
            });
        } catch (err) {
            console.error("Error cleaning up canceled transcription files:", err);
        }

        if (mainWindow) {
            mainWindow.webContents.send('transcription-status', { 
                status: 'canceled', 
                file: path.basename(filePath),
                fullPath: filePath
            });
        }
        return { success: true };
    }
    return { success: false, error: 'Process not found' };
});

async function generateSummaryAction(filePath) {
    const aiConfig = store.get('aiConfig');
    if (!aiConfig || !aiConfig.apiKey) {
        return { success: false, error: 'Chave de API não configurada.' };
    }

    const baseName = path.parse(filePath).name;
    const dir = path.dirname(filePath);
    const txtPath = path.join(dir, `${baseName}.txt`);

    if (!fs.existsSync(txtPath)) {
        return { success: false, error: 'Arquivo de transcrição não encontrado. Transcreva o vídeo primeiro.' };
    }

    try {
        const transcription = fs.readFileSync(txtPath, 'utf8');
        
        let apiUrl = '';
        let headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${aiConfig.apiKey}`
        };

        if (aiConfig.provider === 'openrouter') {
            apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
            headers['HTTP-Referer'] = 'https://github.com/rodrigosrf/meet-record';
            headers['X-Title'] = 'Meet Recorder';
        } else if (aiConfig.provider === 'openai') {
            apiUrl = 'https://api.openai.com/v1/chat/completions';
        } else if (aiConfig.provider === 'gemini') {
            apiUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                model: aiConfig.model || 'openai/gpt-4o',
                messages: [
                    { role: 'system', content: aiConfig.systemPrompt },
                    { role: 'user', content: `Por favor, resuma a seguinte transcrição de reunião:\n\n${transcription}` }
                ]
            })
        });

        const data = await response.json();
        if (data.error) {
            throw new Error(data.error.message || JSON.stringify(data.error));
        }

        const summary = data.choices[0].message.content;
        const summaryPath = path.join(dir, `${baseName}_summary.md`);
        fs.writeFileSync(summaryPath, summary);

        return { success: true, summary, path: summaryPath };
    } catch (error) {
        console.error('Error generating summary:', error);
        return { success: false, error: error.message };
    }
}

ipcMain.handle('generate-summary', async (event, filePath) => {
    return await generateSummaryAction(filePath);
});

ipcMain.handle('get-summary', async (event, videoPath) => {
    const baseName = path.parse(videoPath).name;
    const dir = path.dirname(videoPath);
    const summaryPath = path.join(dir, `${baseName}_summary.md`);

    if (fs.existsSync(summaryPath)) {
        const content = fs.readFileSync(summaryPath, 'utf8');
        return { success: true, content };
    }
    return { success: false, error: 'Resumo não encontrado.' };
});

ipcMain.handle('save-file', async (event, { buffer, fileName }) => {
    const outputDir = store.get('outputDirectory');
    if (!outputDir) return { success: false, error: 'No output directory' };

    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateDir = `${month}-${day}`;
    const targetDir = path.join(outputDir, dateDir);
    const filePath = path.join(targetDir, fileName);

    try {
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.writeFileSync(filePath, Buffer.from(buffer));
        
        if (store.get('autoTranscribe', true)) {
            addToTranscriptionQueue(filePath);
        }
        return { success: true, path: filePath };
    } catch (error) {
        console.error('Error saving file:', error);
        return { success: false, error: error.message };
    }
});

function addToTranscriptionQueue(filePath) {
    if (transcriptionQueue.includes(filePath) || activeProcesses.has(filePath)) {
        return;
    }

    transcriptionQueue.push(filePath);

    if (mainWindow) {
        mainWindow.webContents.send('transcription-status', { 
            status: 'queued', 
            file: path.basename(filePath),
            fullPath: filePath 
        });
    }

    if (!isProcessingQueue) {
        processNextInQueue();
    }
}

async function processNextInQueue() {
    if (transcriptionQueue.length === 0) {
        isProcessingQueue = false;
        return;
    }

    isProcessingQueue = true;
    const filePath = transcriptionQueue.shift();
    runTranscription(filePath);
}

function runTranscription(filePath) {
    if (mainWindow) {
        mainWindow.webContents.send('transcription-status', { 
            status: 'started', 
            file: path.basename(filePath),
            fullPath: filePath 
        });
    }

    const command = `whisper "${filePath}" --model medium --language Portuguese --output_dir "${path.dirname(filePath)}"`;
    
    const childProcess = exec(command, (error, stdout, stderr) => {
        activeProcesses.delete(filePath);
        
        if (error) {
            if (!childProcess.killed && mainWindow) {
                mainWindow.webContents.send('transcription-status', { 
                    status: 'error', 
                    message: error.message,
                    file: path.basename(filePath),
                    fullPath: filePath
                });
            }
            processNextInQueue();
            return;
        }
        
        if (mainWindow) {
            mainWindow.webContents.send('transcription-status', { 
                status: 'finished', 
                file: path.basename(filePath),
                fullPath: filePath
            });
        }

        // Check for auto-summarize
        const aiConfig = store.get('aiConfig');
        if (aiConfig && aiConfig.autoSummarize && aiConfig.apiKey) {
            console.log("Auto-summarizing transcription for:", filePath);
            ipcMain.emit('generate-summary-internal', filePath);
        }

        processNextInQueue();
    });

    activeProcesses.set(filePath, childProcess);
}

// Internal summary generation to avoid IPC overhead when calling from main
ipcMain.on('generate-summary-internal', async (filePath) => {
    try {
        await generateSummaryAction(filePath);
        // Refresh library in renderer if possible
        if (mainWindow) {
            mainWindow.webContents.send('config-updated', {}); // Trigger a refresh indirectly or use a specific event
        }
    } catch (e) {
        console.error("Auto-summary failed:", e);
    }
});

function startDetectionLoop() {
    detectionInterval = setInterval(async () => {
        try {
            const sources = await desktopCapturer.getSources({ 
                types: ['window'],
                thumbnailSize: { width: 0, height: 0 }
            });

            const potentialMeetingWindows = sources.filter(source => {
                const name = source.name.toLowerCase();
                return (name.includes('reuni') || name.includes('meeting') || name.includes('teams')) &&
                       !name.startsWith('chat |') && 
                       !name.startsWith('calendar |') &&
                       name !== 'microsoft teams';
            });

            if (potentialMeetingWindows.length === 0) {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('no-meeting-detected');
                }
                return;
            }

            const scriptPath = path.join(__dirname, 'detectMeetings.ps1');
            const command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; & '${scriptPath}'"`;

            exec(command, (error, stdout, stderr) => {
                if (error) return;

                try {
                    const jsonMatch = stdout.match(/(\[[\s\S]*\]|"(?:\\.|[^"\\])*")/);
                    if (!jsonMatch) {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('no-meeting-detected');
                        }
                        return;
                    }

                    const meetingTitles = JSON.parse(jsonMatch[1]);
                    const titlesArray = Array.isArray(meetingTitles) ? meetingTitles : [meetingTitles];

                    if (titlesArray.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('meeting-detected', titlesArray);
                    } else if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('no-meeting-detected');
                    }
                } catch (parseError) {}
            });
        } catch (error) {}
    }, 5000);
}
