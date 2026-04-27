import { app, BrowserWindow, ipcMain, desktopCapturer, dialog } from 'electron';
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
        backgroundColor: '#0f172a' // Dark slate
    });

    mainWindow.loadFile('index.html');
}

function createSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 500,
        height: 400,
        title: 'Settings',
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
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    return sources;
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

ipcMain.on('open-settings', () => {
    createSettingsWindow();
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
                
                // Check if any transcription files exist (.txt, .vtt, .srt, .json, .tsv)
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
        // Sort by date descending
        return videos.sort((a, b) => b.date - a.date);
    } catch (err) {
        console.error("Error scanning library:", err);
        return [];
    }
});

ipcMain.handle('request-transcription', async (event, filePath) => {
    if (fs.existsSync(filePath)) {
        runTranscription(filePath);
        return { success: true };
    }
    return { success: false, error: 'File not found' };
});

ipcMain.handle('cancel-transcription', async (event, filePath) => {
    const childProcess = activeProcesses.get(filePath);
    if (childProcess) {
        childProcess.kill();
        activeProcesses.delete(filePath);
        
        // Clean up partial files
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

ipcMain.handle('save-file', async (event, { buffer, fileName }) => {
    const outputDir = store.get('outputDirectory');
    if (!outputDir) return { success: false, error: 'No output directory' };

    // Get current date in MM-dd format
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateDir = `${month}-${day}`;
    
    const targetDir = path.join(outputDir, dateDir);
    const filePath = path.join(targetDir, fileName);

    try {
        // Create directory if it doesn't exist
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        fs.writeFileSync(filePath, Buffer.from(buffer));
        
        // Trigger Whisper transcription
        runTranscription(filePath);

        return { success: true, path: filePath };
    } catch (error) {
        console.error('Error saving file:', error);
        return { success: false, error: error.message };
    }
});

function runTranscription(filePath) {
    console.log(`Starting transcription for: ${filePath}`);
    if (mainWindow) {
        mainWindow.webContents.send('transcription-status', { 
            status: 'started', 
            file: path.basename(filePath),
            fullPath: filePath 
        });
    }

    // whisper "path" --model medium --language Portuguese
    const command = `whisper "${filePath}" --model medium --language Portuguese --output_dir "${path.dirname(filePath)}"`;
    
    const childProcess = exec(command, (error, stdout, stderr) => {
        activeProcesses.delete(filePath);
        
        if (error) {
            if (childProcess.killed) return; // Ignore errors if we killed it intentionally
            
            console.error(`Transcription error: ${error.message}`);
            if (mainWindow) {
                mainWindow.webContents.send('transcription-status', { 
                    status: 'error', 
                    message: error.message,
                    file: path.basename(filePath),
                    fullPath: filePath
                });
            }
            return;
        }
        
        console.log(`Transcription finished: ${stdout}`);
        if (mainWindow) {
            mainWindow.webContents.send('transcription-status', { 
                status: 'finished', 
                file: path.basename(filePath),
                fullPath: filePath
            });
        }
    });

    activeProcesses.set(filePath, childProcess);
}

// Detection Logic
function startDetectionLoop() {
    detectionInterval = setInterval(async () => {
        try {
            // First, get basic window titles as a fast check
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

            // If we have potential windows, use the robust PowerShell check
            const scriptPath = path.join(__dirname, 'detectMeetings.ps1');
            const command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; & '${scriptPath}'"`;

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error('Detection script error:', error);
                    return;
                }

                try {
                    // Extract the JSON part from the output (handles cases with profile/shell errors)
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
                } catch (parseError) {
                    console.error('Failed to parse detection output:', stdout);
                }
            });
        } catch (error) {
            console.error('Detection error:', error);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('no-meeting-detected');
            }
        }
    }, 5000); // Check every 5 seconds (increased from 3s for performance)
}
