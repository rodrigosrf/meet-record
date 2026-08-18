import { app, BrowserWindow, ipcMain, desktopCapturer, dialog, shell, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, spawn } from 'child_process';
import fs from 'fs';
import Store from 'electron-store';
import { convertToMp3AndSave } from './src/main/ffmpegService.js';
import { 
    getLibraryVideosAsync, 
    getRecordingThumbnailAsync, 
    deleteRecordingAsync, 
    archiveRecordingsAsync, 
    reorganizeFilesAsync,
    migrateImagesDirectoryAsync
} from './src/main/libraryService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new Store({
    defaults: {
        outputDirectory: '',
        autoRecord: true,
        autoStopSilenceMinutes: 1,
        organizationConfig: {
            pathTemplate: '{year}-{month}-{day}',
            fileNamingTemplate: '{timestamp}_{title}',
            autoArchiveDays: 0,
            archivePath: '',
            compressionEnabled: false,
            separateVideoFolder: false
        },
        visualEffectsConfig: {
            cursorSpotlight: true,
            clickRipples: true,
            privacyBlur: false,
            lowerThirds: true,
            generateWaveformBanner: true,
            performanceProfile: 'balanced'
        },
        tagCategories: []
    }
});

function resolveTemplate(template, metadata) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');

    const vars = {
        '{year}': now.getFullYear(),
        '{month}': pad(now.getMonth() + 1),
        '{day}': pad(now.getDate()),
        '{date}': `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
        '{timestamp}': `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`,
        '{title}': (metadata.title || 'Sem_Titulo').replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_'),
        '{week}': getWeekNumber(now),
        '{hour}': pad(now.getHours()),
        '{minute}': pad(now.getMinutes())
    };

    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
    }
    return result;
}

function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

let mainWindow;
let settingsWindow;
let overlayWindow;
let detectionInterval;
const activeProcesses = new Map();
const transcriptionQueue = [];
let isProcessingQueue = false;

let isQuitting = false;

let psDaemonProcess = null;
let psDaemonBuffer = '';
let isScanningPending = false;

// Logging System (Console Debug Only)
function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    if (type === 'error') {
        console.error(`[${timestamp}] [ERROR] ${message}`);
    } else if (type === 'warn') {
        console.warn(`[${timestamp}] [WARN] ${message}`);
    } else {
        console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        title: 'Meet Recorder - Monitor',
        icon: path.join(__dirname, 'assets', 'icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        autoHideMenuBar: true,
        backgroundColor: '#0f172a'
    });

    mainWindow.loadFile('index.html');

    mainWindow.on('closed', () => {
        mainWindow = null;
        isQuitting = true;
        stopDetectionLoop();
        stopPowerShellDaemon();

        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.destroy();
            overlayWindow = null;
        }
        if (settingsWindow && !settingsWindow.isDestroyed()) {
            settingsWindow.destroy();
            settingsWindow = null;
        }

        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
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
        icon: path.join(__dirname, 'assets', 'icon.ico'),
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

function createOverlayWindow() {
    if (overlayWindow) return;

    overlayWindow = new BrowserWindow({
        width: 280,
        height: 60,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        focusable: false, // Don't take focus away from other apps
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // Ensure it stays on top of everything, including full-screen apps
    overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    
    // Make it visible on all virtual desktops
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    overlayWindow.loadFile('overlay.html');
    
    // Position it at the bottom right of the primary screen
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    overlayWindow.setPosition(width - 300, height - 80);

    overlayWindow.on('closed', () => {
        overlayWindow = null;
    });

    // Re-enforce always on top if it somehow loses it
    overlayWindow.on('always-on-top-changed', (event, isAlwaysOnTop) => {
        if (!isAlwaysOnTop) {
            overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        }
    });
}

app.whenReady().then(() => {
    createWindow();
    startDetectionLoop();
    migrateImagesDirectoryAsync(store.get('outputDirectory'));
    cleanupOldImages();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        } else {
            mainWindow.show();
        }
    });
});

app.on('before-quit', () => {
    isQuitting = true;
    stopDetectionLoop();
    stopPowerShellDaemon();
});

app.on('will-quit', () => {
    isQuitting = true;
    stopDetectionLoop();
    stopPowerShellDaemon();
});

app.on('window-all-closed', function () {
    isQuitting = true;
    stopDetectionLoop();
    stopPowerShellDaemon();
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
        autoRecord: store.get('autoRecord')
    };
});

ipcMain.handle('update-config', (event, newConfig) => {
    if (newConfig.outputDirectory !== undefined) {
        store.set('outputDirectory', newConfig.outputDirectory);
    }
    if (newConfig.autoRecord !== undefined) {
        store.set('autoRecord', newConfig.autoRecord);
    }
    
    const updatedConfig = {
        outputDirectory: store.get('outputDirectory'),
        autoRecord: store.get('autoRecord')
    };
    
    mainWindow.webContents.send('config-updated', updatedConfig);
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

ipcMain.handle('open-file', async (event, filePath) => {
    if (fs.existsSync(filePath)) {
        shell.openPath(filePath);
        return { success: true };
    }
    return { success: false, error: 'Arquivo não encontrado.' };
});

ipcMain.handle('open-file-location', async (event, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath);
        return { success: true };
    }
    const outputDir = store.get('outputDirectory');
    if (outputDir && fs.existsSync(outputDir)) {
        shell.openPath(outputDir);
        return { success: true };
    }
    return { success: false, error: 'Arquivo ou pasta não encontrado.' };
});

// Overlay IPC Bridge
ipcMain.on('sync-overlay', (event, data) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('overlay-update', data);
    }
});

ipcMain.on('overlay-action', (event, action) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    switch (action) {
        case 'print':
            mainWindow.webContents.send('trigger-manual-screenshot');
            break;
        case 'pause':
            mainWindow.webContents.send('toggle-pause');
            break;
        case 'stop':
            mainWindow.webContents.send('stop-recording');
            break;
    }
});

ipcMain.on('show-overlay', () => {
    if (!overlayWindow) {
        createOverlayWindow();
    } else {
        overlayWindow.show();
    }
});

ipcMain.on('hide-overlay', () => {
    if (overlayWindow) {
        overlayWindow.hide();
    }
});

ipcMain.handle('get-file-buffer', async (event, filePath) => {
    if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
        return { success: true, buffer: new Uint8Array(buffer) };
    }
    return { success: false, error: 'Arquivo não encontrado.' };
});

ipcMain.handle('delete-file', async (event, filePath) => {
    return await deleteRecordingAsync(filePath);
});

ipcMain.handle('get-recording-thumbnail', async (event, folderName, recPath) => {
    const outputDir = store.get('outputDirectory');
    return await getRecordingThumbnailAsync(outputDir, folderName, recPath);
});

ipcMain.handle('get-library-videos', async () => {
    const outputDir = store.get('outputDirectory');
    return await getLibraryVideosAsync(outputDir);
});

ipcMain.handle('save-file', async (event, { buffer, fileName, metadata, hasVideo }) => {
    const outputDir = store.get('outputDirectory');
    if (!outputDir) return { success: false, error: 'No output directory' };

    const orgConfig = store.get('organizationConfig');
    const pathTemplate = orgConfig?.pathTemplate || '{year}-{month}-{day}';
    const fileNamingTemplate = orgConfig?.fileNamingTemplate || '{timestamp}_{title}';

    const resolvedDir = resolveTemplate(pathTemplate, metadata);
    const targetDir = path.join(outputDir, resolvedDir);
    
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const resolvedBaseName = resolveTemplate(fileNamingTemplate, metadata || {});
    const webmFileName = fileName || `${resolvedBaseName}.webm`;
    const finalMp3Name = webmFileName.replace(/\.webm$/i, '.mp3');
    const finalMp3Path = path.join(targetDir, finalMp3Name);
    const finalWebmPath = path.join(targetDir, webmFileName);

    const tempWebmPath = path.join(targetDir, `temp_${Date.now()}.webm`);

    try {
        fs.writeFileSync(tempWebmPath, Buffer.from(buffer));
        const visualEffectsConfig = store.get('visualEffectsConfig') || {};
        return await convertToMp3AndSave({
            tempWebmPath,
            finalMp3Path,
            finalWebmPath,
            hasVideo,
            metadata,
            visualEffectsConfig
        });
    } catch (error) {
        console.error('Error saving file:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-screenshot', async (event, { buffer, fileName, folderName, metadata }) => {
    const outputDir = store.get('outputDirectory');
    if (!outputDir) return { success: false, error: 'Diretório de saída não configurado.' };

    const orgConfig = store.get('organizationConfig');
    const pathTemplate = orgConfig?.pathTemplate || '{year}-{month}-{day}';
    const resolvedDir = resolveTemplate(pathTemplate, metadata || { title: folderName });
    const targetDir = path.join(outputDir, resolvedDir);

    try {
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const filePath = path.join(targetDir, fileName);
        fs.writeFileSync(filePath, Buffer.from(buffer));
        return { success: true, filePath };
    } catch (error) {
        console.error('Error saving screenshot:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('discard-meeting-screenshots', async (event, folderName) => {
    const outputDir = store.get('outputDirectory');
    if (!outputDir || !folderName) return { success: false };

    try {
        const deleteMatchingImagesInDir = (dir) => {
            if (!fs.existsSync(dir)) return;
            const items = fs.readdirSync(dir, { withFileTypes: true });
            for (const item of items) {
                const fullPath = path.join(dir, item.name);
                if (item.isDirectory()) {
                    deleteMatchingImagesInDir(fullPath);
                } else if (item.name.startsWith(folderName) && (item.name.endsWith('.jpg') || item.name.endsWith('.png'))) {
                    try { fs.unlinkSync(fullPath); } catch (e) {}
                }
            }
        };

        deleteMatchingImagesInDir(outputDir);
        return { success: true };
    } catch (error) {
        console.error('Error discarding screenshots:', error);
    }
    return { success: false };
});

// ===== ORGANIZATION CONFIG IPCs =====
ipcMain.handle('get-organization-config', () => {
    return store.get('organizationConfig');
});

ipcMain.handle('update-organization-config', (event, config) => {
    store.set('organizationConfig', config);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('config-updated', {
            outputDirectory: store.get('outputDirectory'),
            autoRecord: store.get('autoRecord')
        });
    }
    return { success: true };
});

ipcMain.handle('preview-organization-path', (event, { template, title }) => {
    const metadata = { title: title || 'Exemplo_Titulo' };
    try {
        const resolved = resolveTemplate(template, metadata);
        const outputDir = store.get('outputDirectory') || 'C:\\Gravações';
        return { success: true, path: path.join(outputDir, resolved) };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('archive-recordings', async (event, { olderThanDays }) => {
    const outputDir = store.get('outputDirectory');
    const orgConfig = store.get('organizationConfig');
    const archivePath = orgConfig?.archivePath;
    return await archiveRecordingsAsync(outputDir, archivePath, olderThanDays);
});

ipcMain.handle('reorganize-files', async (event, { pathTemplate }) => {
    const outputDir = store.get('outputDirectory');
    return await reorganizeFilesAsync(outputDir, pathTemplate, resolveTemplate);
});

// ===== TAGGING SYSTEM IPCs =====
ipcMain.handle('update-recording-tags', async (event, { filePath, tags, favorite }) => {
    try {
        const baseName = path.parse(filePath).name;
        const dir = path.dirname(filePath);
        const metadataPath = path.join(dir, baseName + '.json');

        if (fs.existsSync(metadataPath)) {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            if (tags !== undefined) metadata.tags = tags;
            if (favorite !== undefined) metadata.favorite = favorite;
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        } else {
            // Create new metadata file
            const metadata = {
                title: baseName,
                date: new Date().toISOString(),
                tags: tags || [],
                favorite: favorite || false
            };
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-tag-categories', () => {
    return store.get('tagCategories') || [];
});

ipcMain.handle('update-tag-categories', (event, categories) => {
    store.set('tagCategories', categories);
    return { success: true };
});

function cleanupOldImages() {
    const outputDir = store.get('outputDirectory');
    if (!outputDir || !fs.existsSync(outputDir)) return;

    try {
        const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
        const now = Date.now();

        function cleanDir(dir) {
            const items = fs.readdirSync(dir, { withFileTypes: true });
            items.forEach(item => {
                const fullPath = path.join(dir, item.name);
                if (item.isDirectory()) {
                    if (item.name === 'archive') return;
                    cleanDir(fullPath);
                    // Remove empty subdirectories if any
                    try {
                        if (fs.readdirSync(fullPath).length === 0) {
                            fs.rmdirSync(fullPath);
                        }
                    } catch (e) {}
                } else if (item.name.endsWith('.jpg') || item.name.endsWith('.png')) {
                    try {
                        const stats = fs.statSync(fullPath);
                        if (now - stats.mtimeMs > MAX_AGE) {
                            fs.unlinkSync(fullPath);
                        }
                    } catch (e) {}
                }
            });
        }

        cleanDir(outputDir);
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}

function startPowerShellDaemon() {
    if (psDaemonProcess) return;

    log('Iniciando daemon do PowerShell em segundo plano', 'info');

    let scriptPath = path.join(__dirname, 'detectMeetings.ps1');
    scriptPath = scriptPath.replace(/\bapp\.asar\b/g, 'app.asar.unpacked');

    try {
        psDaemonProcess = spawn('powershell', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath
        ], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        psDaemonBuffer = '';

        psDaemonProcess.stdout.on('data', (chunk) => {
            psDaemonBuffer += chunk.toString('utf8');
            
            let newlineIndex;
            while ((newlineIndex = psDaemonBuffer.indexOf('\n')) !== -1) {
                const line = psDaemonBuffer.substring(0, newlineIndex).trim();
                psDaemonBuffer = psDaemonBuffer.substring(newlineIndex + 1);
                
                if (line) {
                    handleDaemonScanResult(line);
                }
            }
        });

        psDaemonProcess.stderr.on('data', (data) => {
            const msg = data.toString('utf8').trim();
            if (msg) {
                log(`PowerShell Daemon (stderr): ${msg}`, 'debug');
            }
        });

        psDaemonProcess.on('exit', (code, signal) => {
            log(`Daemon do PowerShell encerrado (código: ${code}, sinal: ${signal})`, 'warn');
            psDaemonProcess = null;
            isScanningPending = false;
            
            if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
                setTimeout(() => {
                    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
                        log('Reiniciando daemon do PowerShell...', 'info');
                        startPowerShellDaemon();
                    }
                }, 3000);
            }
        });

        psDaemonProcess.on('error', (err) => {
            log(`Erro no daemon do PowerShell: ${err.message}`, 'error');
            psDaemonProcess = null;
            isScanningPending = false;
        });

    } catch (err) {
        log(`Falha ao spawnar daemon do PowerShell: ${err.message}`, 'error');
    }
}

function handleDaemonScanResult(stdout) {
    isScanningPending = false;
    try {
        let jsonMatch = stdout.match(/\[.*\]/s);
        let meetingTitles = [];
        
        if (jsonMatch) {
            try {
                meetingTitles = JSON.parse(jsonMatch[0]);
            } catch (e) {
                log(`Erro ao parsear JSON do daemon: ${e.message}`, 'error');
            }
        } else if (stdout.trim()) {
            try {
                const trimmed = stdout.trim();
                if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
                    meetingTitles = [JSON.parse(trimmed)];
                } else if (!trimmed.includes('\n')) {
                    meetingTitles = [trimmed];
                }
            } catch (e) {
                log(`Falha ao processar saída do daemon: ${stdout}`, 'debug');
            }
        }

        if (meetingTitles.length === 0) {
            log('Nenhuma reunião confirmada pelo script PowerShell', 'debug');
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('no-meeting-detected');
            }
            return;
        }

        const meetingsArray = Array.isArray(meetingTitles) ? meetingTitles : [meetingTitles];

        if (meetingsArray.length > 0) {
            const titles = meetingsArray.map(m => m.title).join(', ');
            log(`Reunião detectada: ${titles}`, 'info');
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('meeting-detected', meetingsArray);
            }
        } else {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('no-meeting-detected');
            }
        }
    } catch (parseError) {
        log(`Erro ao processar resposta do daemon: ${parseError.message}`, 'error');
    }
}

function stopPowerShellDaemon() {
    if (psDaemonProcess) {
        const proc = psDaemonProcess;
        psDaemonProcess = null;
        try {
            if (proc.stdin && proc.stdin.writable) {
                proc.stdin.write('EXIT\n');
                proc.stdin.end();
            }
        } catch (e) { /* ignore */ }

        try {
            if (process.platform === 'win32' && proc.pid) {
                exec(`taskkill /F /T /PID ${proc.pid}`, () => {});
            } else {
                proc.kill('SIGKILL');
            }
        } catch (e) { /* ignore */ }
    }
}

function stopDetectionLoop() {
    if (detectionInterval) {
        clearInterval(detectionInterval);
        detectionInterval = null;
    }
}

function startDetectionLoop() {
    log('Iniciando loop de detecção automática com daemon', 'debug');
    startPowerShellDaemon();

    if (detectionInterval) clearInterval(detectionInterval);

    detectionInterval = setInterval(async () => {
        if (isQuitting || !mainWindow || mainWindow.isDestroyed()) {
            stopDetectionLoop();
            return;
        }

        try {
            const sources = await desktopCapturer.getSources({ 
                types: ['window'],
                thumbnailSize: { width: 0, height: 0 }
            });

            const potentialMeetingWindows = sources.filter(source => {
                const name = source.name.toLowerCase();
                return name.includes('teams') || 
                       name.includes('reuni') || 
                       name.includes('meeting') || 
                       name.includes('chamada') || 
                       name.includes('call') ||
                       name.includes('meet') ||
                       name.includes('confer');
            });

            if (potentialMeetingWindows.length === 0) {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('no-meeting-detected');
                }
                return;
            }

            log(`Janelas potenciais encontradas: ${potentialMeetingWindows.length}`, 'debug');

            if (!psDaemonProcess && !isQuitting) {
                startPowerShellDaemon();
            }

            if (psDaemonProcess && psDaemonProcess.stdin.writable && !isScanningPending) {
                isScanningPending = true;
                psDaemonProcess.stdin.write("SCAN\n");
            }
        } catch (error) {
            log(`Erro no loop de detecção: ${error.message}`, 'error');
        }
    }, 5000);
}

