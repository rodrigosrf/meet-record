import { app, BrowserWindow, ipcMain, desktopCapturer, dialog, shell, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import fs from 'fs';
import Store from 'electron-store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new Store({
    defaults: {
        screenshotInterval: 60, // seconds
        smartCapture: true
    }
});

let mainWindow;
let settingsWindow;
let detectionInterval;
const activeProcesses = new Map();
const transcriptionQueue = [];
let isProcessingQueue = false;
let tray = null;
let isQuitting = false;

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
        screenshotInterval: store.get('screenshotInterval'),
        smartCapture: store.get('smartCapture')
    };
});

ipcMain.handle('update-config', (event, newConfig) => {
    if (newConfig.outputDirectory !== undefined) {
        store.set('outputDirectory', newConfig.outputDirectory);
    }
    if (newConfig.screenshotInterval !== undefined) {
        store.set('screenshotInterval', newConfig.screenshotInterval);
    }
    if (newConfig.smartCapture !== undefined) {
        store.set('smartCapture', newConfig.smartCapture);
    }
    
    const updatedConfig = {
        outputDirectory: store.get('outputDirectory'),
        screenshotInterval: store.get('screenshotInterval'),
        smartCapture: store.get('smartCapture')
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
            fs.unlinkSync(filePath);
            
            // Also try to delete metadata json
            const metadataPath = filePath.replace('.mp3', '.json');
            if (fs.existsSync(metadataPath)) {
                fs.unlinkSync(metadataPath);
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
            const files = fs.readdirSync(imagesDir);
            const firstImage = files.find(f => f.endsWith('.jpg') || f.endsWith('.png'));
            if (firstImage) {
                const fullPath = path.join(imagesDir, firstImage);
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
            } else if (file.endsWith('.mp3')) {
                const metadataPath = fullPath.replace('.mp3', '.json');
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

ipcMain.handle('save-file', async (event, { buffer, fileName, metadata }) => {
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
            
            // Keep the comment for other players, but focus on Title for Windows
            if (metadata.note) {
                const safeNote = metadata.note.replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
                metadataArgs += ` -metadata comment="${safeNote}"`;
            }
        }

        const ffmpegCommand = `ffmpeg -i "${tempWebmPath}" -vn -ab 128k -id3v2_version 3${metadataArgs} "${finalMp3Path}"`;
        
        return new Promise((resolve) => {
            exec(ffmpegCommand, (error) => {
                // Delete temp file regardless of error
                if (fs.existsSync(tempWebmPath)) {
                    fs.unlinkSync(tempWebmPath);
                }

                if (error) {
                    console.error('Error converting to mp3:', error);
                    resolve({ success: false, error: 'Falha na conversão para MP3. Verifique se o ffmpeg está instalado.' });
                } else {
                    // Save metadata if provided
                    if (metadata) {
                        const metadataPath = finalMp3Path.replace('.mp3', '.json');
                        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                    }
                    resolve({ success: true, path: finalMp3Path });
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
    detectionInterval = setInterval(async () => {
        try {
            const sources = await desktopCapturer.getSources({ 
                types: ['window'],
                thumbnailSize: { width: 0, height: 0 }
            });

            // Broaden the filter to include any window that might belong to Teams
            const potentialMeetingWindows = sources.filter(source => {
                const name = source.name.toLowerCase();
                // If it mentions Teams or meeting-related keywords, we check deeper
                return name.includes('teams') || 
                       name.includes('reuni') || 
                       name.includes('meeting') || 
                       name.includes('chamada') || 
                       name.includes('call');
            });

            if (potentialMeetingWindows.length === 0) {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('no-meeting-detected');
                }
                return;
            }

            const scriptPath = path.join(__dirname, 'detectMeetings.ps1');
            // Use -NoProfile and -ExecutionPolicy Bypass for faster/safer execution
            // We use [Console]::OutputEncoding to match the script's setting
            const command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; & '${scriptPath}'"`;

            exec(command, { encoding: 'utf8' }, (error, stdout, stderr) => {
                if (error) {
                    console.error('PowerShell error:', error);
                    return;
                }

                try {
                    // Improved regex to find the JSON array even if there's other output
                    const jsonMatch = stdout.match(/\[.*\]/s);
                    if (!jsonMatch) {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('no-meeting-detected');
                        }
                        return;
                    }

                    const meetingTitles = JSON.parse(jsonMatch[0]);
                    const titlesArray = Array.isArray(meetingTitles) ? meetingTitles : [meetingTitles];

                    if (titlesArray.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('meeting-detected', titlesArray);
                    } else if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('no-meeting-detected');
                    }
                } catch (parseError) {
                    console.error('Error parsing PowerShell output:', parseError, stdout);
                }
            });
        } catch (error) {
            console.error('Detection loop error:', error);
        }
    }, 5000);
}
