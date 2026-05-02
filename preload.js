const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSources: () => ipcRenderer.invoke('get-sources'),
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    getConfig: () => ipcRenderer.invoke('get-config'),
    openSettings: () => ipcRenderer.send('open-settings'),
    onMeetingDetected: (callback) => ipcRenderer.on('meeting-detected', (_event, value) => callback(value)),
    onNoMeetingDetected: (callback) => ipcRenderer.on('no-meeting-detected', (_event) => callback()),
    saveFile: (data) => ipcRenderer.invoke('save-file', data),
    onConfigUpdated: (callback) => ipcRenderer.on('config-updated', (event, config) => callback(config)),
    getLibraryVideos: () => ipcRenderer.invoke('get-library-videos'),
    updateConfig: (config) => ipcRenderer.invoke('update-config', config),
    openOutputDirectory: () => ipcRenderer.invoke('open-output-directory'),
    openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
    getFileBuffer: (filePath) => ipcRenderer.invoke('get-file-buffer', filePath)
});
