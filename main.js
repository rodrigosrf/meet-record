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
        outputDirectory: store.get('outputDirectory')
    };
});

ipcMain.handle('update-config', (event, newConfig) => {
    if (newConfig.outputDirectory !== undefined) {
        store.set('outputDirectory', newConfig.outputDirectory);
        mainWindow.webContents.send('config-updated', { outputDirectory: newConfig.outputDirectory });
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
                recordings.push({
                    name: file,
                    path: fullPath,
                    date: stat.birthtime
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

ipcMain.handle('save-file', async (event, { buffer, fileName }) => {
    const outputDir = store.get('outputDirectory');
    if (!outputDir) return { success: false, error: 'No output directory' };

    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateDir = `${month}-${day}`;
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
        
        // 2. Convert to mp3 using ffmpeg
        // -vn: no video, -ab: audio bitrate
        const ffmpegCommand = `ffmpeg -i "${tempWebmPath}" -vn -ab 128k "${finalMp3Path}"`;
        
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
                    resolve({ success: true, path: finalMp3Path });
                }
            });
        });

    } catch (error) {
        console.error('Error saving/converting file:', error);
        return { success: false, error: error.message };
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
                return (name.includes('reuni') || name.includes('meeting') || name.includes('teams') || name.includes('call') || name.includes('chamada')) &&
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
