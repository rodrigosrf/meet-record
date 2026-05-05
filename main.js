import { app, BrowserWindow, ipcMain, desktopCapturer, dialog, shell, Tray, Menu, nativeImage, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import fs from 'fs';
import Store from 'electron-store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new Store({
    defaults: {
        outputDirectory: '',
        autoRecord: true
    }
});

let mainWindow;
let settingsWindow;
let overlayWindow;
let detectionInterval;
const activeProcesses = new Map();
const transcriptionQueue = [];
let isProcessingQueue = false;
let tray = null;
let isQuitting = false;

// Logging System
const logs = [];
const MAX_LOGS = 100;

function log(message, type = 'info') {
    const now = new Date();
    const entry = {
        timestamp: now.toLocaleTimeString('pt-BR'),
        fullTimestamp: now.toISOString(),
        message,
        type
    };
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.shift();
    
    // File saving removed per user request
    
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('new-log', entry);
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

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
        return false;
    });
}

function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    
    const contextMenu = Menu.buildFromTemplate([
        { 
            label: 'Abrir Meet Record', 
            click: () => {
                mainWindow.show();
            } 
        },
        { type: 'separator' },
        {
            label: 'Iniciar Gravação Manual',
            click: () => {
                mainWindow.webContents.send('start-manual-recording');
            }
        },
        {
            label: 'Finalizar Gravação',
            click: () => {
                mainWindow.webContents.send('stop-recording');
            }
        },
        {
            label: 'Tirar Print Manual',
            click: () => {
                mainWindow.webContents.send('trigger-manual-screenshot');
            }
        },
        { type: 'separator' },
        { 
            label: 'Sair', 
            click: () => {
                isQuitting = true;
                app.quit();
            } 
        }
    ]);

    tray.setToolTip('Meet Record');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
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
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    overlayWindow.loadFile('overlay.html');
    
    // Position it at the bottom right of the primary screen
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    overlayWindow.setPosition(width - 300, height - 80);

    overlayWindow.on('closed', () => {
        overlayWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();
    createTray();
    startDetectionLoop();
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
        autoRecord: store.get('autoRecord')
    };
});

ipcMain.handle('get-logs', () => {
    return logs;
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
    try {
        if (fs.existsSync(filePath)) {
            const baseName = path.parse(filePath).name;
            const dir = path.dirname(filePath);
            
            // Delete the file itself
            fs.unlinkSync(filePath);
            
            // Also try to delete metadata json
            const metadataPath = path.join(dir, baseName + '.json');
            if (fs.existsSync(metadataPath)) {
                fs.unlinkSync(metadataPath);
            }

            // Also try to delete the "other" version (mp3 or webm)
            const otherExt = filePath.endsWith('.mp3') ? '.webm' : '.mp3';
            const otherPath = path.join(dir, baseName + otherExt);
            if (fs.existsSync(otherPath)) {
                fs.unlinkSync(otherPath);
            }

            return { success: true };
        }
        return { success: false, error: 'Arquivo não encontrado.' };
    } catch (error) {
        console.error('Error deleting file:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-recording-thumbnail', async (event, folderName) => {
    const outputDir = store.get('outputDirectory');
    if (!outputDir || !folderName) return null;

    const imagesDir = path.join(outputDir, 'images', folderName);
    try {
        if (fs.existsSync(imagesDir)) {
            const files = fs.readdirSync(imagesDir)
                .filter(f => f.endsWith('.jpg') || f.endsWith('.png'));
            
            if (files.length === 0) return null;

            // Sort files to process them in chronological order
            files.sort();

            let selectedImage = null;
            let largestImage = null;
            let maxSize = 0;

            for (const file of files) {
                const fullPath = path.join(imagesDir, file);
                const size = fs.statSync(fullPath).size;

                if (size > maxSize) {
                    maxSize = size;
                    largestImage = file;
                }

                // Threshold: 100KB is usually enough to avoid purely black/empty screens
                if (!selectedImage && size > 100000) {
                    selectedImage = file;
                    // We don't break yet because we want to know the largest just in case
                }
            }

            // Use the first one that passed the threshold, 
            // or the largest one if none did.
            const finalImage = selectedImage || largestImage;

            if (finalImage) {
                const fullPath = path.join(imagesDir, finalImage);
                const buffer = fs.readFileSync(fullPath);
                return { success: true, buffer: new Uint8Array(buffer) };
            }
        }
    } catch (error) {
        console.error('Error fetching thumbnail:', error);
    }
    return null;
});

ipcMain.handle('get-library-videos', async () => {
    const outputDir = store.get('outputDirectory');
    if (!outputDir || !fs.existsSync(outputDir)) return [];

    const recordings = [];
    
    function scanDir(currentPath) {
        const files = fs.readdirSync(currentPath);
        files.forEach(file => {
            const fullPath = path.join(currentPath, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                scanDir(fullPath);
            } else if (file.endsWith('.mp3') || file.endsWith('.webm')) {
                const baseName = path.parse(fullPath).name;
                const metadataPath = path.join(currentPath, baseName + '.json');
                let metadata = {};
                if (fs.existsSync(metadataPath)) {
                    try {
                        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                    } catch (e) {
                        console.error("Error reading metadata:", e);
                    }
                }

                recordings.push({
                    name: file,
                    path: fullPath,
                    date: stat.birthtime,
                    metadata: metadata
                });
            }
        });
    }

    try {
        scanDir(outputDir);
        return recordings.sort((a, b) => b.date - a.date);
    } catch (err) {
        console.error("Error scanning library:", err);
        return [];
    }
});

ipcMain.handle('save-file', async (event, { buffer, fileName, metadata, hasVideo }) => {
    const outputDir = store.get('outputDirectory');
    if (!outputDir) return { success: false, error: 'No output directory' };

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateDir = `${year}-${month}-${day}`;
    const targetDir = path.join(outputDir, dateDir);
    
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const tempWebmPath = path.join(targetDir, `temp_${Date.now()}.webm`);
    const finalMp3Name = fileName.replace('.webm', '.mp3');
    const finalMp3Path = path.join(targetDir, finalMp3Name);
    const finalWebmPath = path.join(targetDir, fileName);

    try {
        // 1. Save temp webm file
        fs.writeFileSync(tempWebmPath, Buffer.from(buffer));
        
        // 2. Convert to mp3 using ffmpeg with metadata
        let metadataArgs = '';
        if (metadata) {
            let combinedTitle = metadata.title || 'Sem Título';
            if (metadata.note) {
                combinedTitle += ` - ${metadata.note.replace(/\r?\n/g, ' ')}`;
            }
            
            const safeTitle = combinedTitle.replace(/"/g, '\\"');
            metadataArgs += ` -metadata title="${safeTitle}"`;
            
            if (metadata.note) {
                const safeNote = metadata.note.replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
                metadataArgs += ` -metadata comment="${safeNote}"`;
            }
        }

        const ffmpegCommand = `ffmpeg -i "${tempWebmPath}" -vn -ab 128k -id3v2_version 3${metadataArgs} "${finalMp3Path}"`;
        
        return new Promise((resolve) => {
            exec(ffmpegCommand, (error) => {
                if (error) {
                    console.error('Error converting to mp3:', error);
                    if (fs.existsSync(tempWebmPath)) fs.unlinkSync(tempWebmPath);
                    resolve({ success: false, error: 'Falha na conversão para MP3. Verifique se o ffmpeg está instalado.' });
                } else {
                    // Success converting to MP3
                    
                    // If hasVideo is true, we keep the webm as well
                    if (hasVideo) {
                        fs.renameSync(tempWebmPath, finalWebmPath);
                    } else {
                        // Otherwise delete temp webm
                        if (fs.existsSync(tempWebmPath)) fs.unlinkSync(tempWebmPath);
                    }

                    // Save metadata if provided
                    if (metadata) {
                        const metadataPath = finalMp3Path.replace('.mp3', '.json');
                        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                        
                        // If it's a video, we might want a separate json or just one for both?
                        // The library currently looks for .mp3 then matches .json.
                        // If we have both, one .json is enough as they share the same base name.
                    }
                    resolve({ success: true, path: hasVideo ? finalWebmPath : finalMp3Path });
                }
            });
        });

    } catch (error) {
        console.error('Error saving/converting file:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-screenshot', async (event, { buffer, fileName, folderName }) => {
    const outputDir = store.get('outputDirectory');
    if (!outputDir) return { success: false, error: 'Diretório de saída não configurado.' };

    let imagesDir = path.join(outputDir, 'images');
    if (folderName) {
        imagesDir = path.join(imagesDir, folderName);
    }

    try {
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

        const filePath = path.join(imagesDir, fileName);
        fs.writeFileSync(filePath, Buffer.from(buffer));
        return { success: true };
    } catch (error) {
        console.error('Error saving screenshot:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('discard-meeting-screenshots', async (event, folderName) => {
    const outputDir = store.get('outputDirectory');
    if (!outputDir || !folderName) return { success: false };

    const folderPath = path.join(outputDir, 'images', folderName);
    try {
        if (fs.existsSync(folderPath)) {
            // Use recursive delete
            fs.rmSync(folderPath, { recursive: true, force: true });
            return { success: true };
        }
    } catch (error) {
        console.error('Error discarding screenshots:', error);
    }
    return { success: false };
});

function cleanupOldImages() {
    const outputDir = store.get('outputDirectory');
    if (!outputDir) return;

    const imagesDir = path.join(outputDir, 'images');
    if (!fs.existsSync(imagesDir)) return;

    try {
        const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
        const now = Date.now();

        function cleanDir(dir) {
            const items = fs.readdirSync(dir);
            items.forEach(item => {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                
                if (stats.isDirectory()) {
                    cleanDir(fullPath);
                    // Delete empty directories
                    if (fs.readdirSync(fullPath).length === 0) {
                        fs.rmdirSync(fullPath);
                    }
                } else {
                    if (now - stats.mtimeMs > MAX_AGE) {
                        fs.unlinkSync(fullPath);
                    }
                }
            });
        }

        cleanDir(imagesDir);
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}

function startDetectionLoop() {
    log('Iniciando loop de detecção automática', 'debug');
    detectionInterval = setInterval(async () => {
        try {
            const sources = await desktopCapturer.getSources({ 
                types: ['window'],
                thumbnailSize: { width: 0, height: 0 }
            });

            // Broaden the filter to include any window that might be a meeting
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
            potentialMeetingWindows.forEach(w => log(`Verificando janela: "${w.name}"`, 'debug'));

            let scriptPath = path.join(__dirname, 'detectMeetings.ps1');
            
            // If running from asar, use the unpacked version
            scriptPath = scriptPath.replace(/\bapp\.asar\b/g, 'app.asar.unpacked');

            const command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; & '${scriptPath}'"`;

            exec(command, { encoding: 'utf8' }, (error, stdout, stderr) => {
                if (error) {
                    log(`Erro ao executar PowerShell: ${error.message}`, 'error');
                    return;
                }
                if (stderr) {
                    log(`PowerShell Stderr: ${stderr}`, 'warn');
                }

                try {
                    // Try to find a JSON array first
                    let jsonMatch = stdout.match(/\[.*\]/s);
                    let meetingTitles = [];
                    
                    if (jsonMatch) {
                        try {
                            meetingTitles = JSON.parse(jsonMatch[0]);
                        } catch (e) {
                            log(`Erro ao parsear JSON: ${e.message}`, 'error');
                        }
                    } else if (stdout.trim()) {
                        // Fallback: if there's any non-empty output, try to parse it as a single string
                        try {
                            const trimmed = stdout.trim();
                            if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
                                meetingTitles = [JSON.parse(trimmed)];
                            } else if (!trimmed.includes('\n')) {
                                // Just a raw string
                                meetingTitles = [trimmed];
                            }
                        } catch (e) {
                            log(`Falha ao processar saída secundária: ${stdout}`, 'debug');
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
                    log(`Erro ao processar saída do PowerShell: ${parseError.message}`, 'error');
                    log(`Saída bruta: ${stdout}`, 'debug');
                }
            });
        } catch (error) {
            log(`Erro no loop de detecção: ${error.message}`, 'error');
        }
    }, 5000);
}
