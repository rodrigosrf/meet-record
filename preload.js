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
    onTranscriptionStatus: (callback) => ipcRenderer.on('transcription-status', (event, data) => callback(data)),
    getLibraryVideos: () => ipcRenderer.invoke('get-library-videos'),
    requestTranscription: (filePath) => ipcRenderer.invoke('request-transcription', filePath),
    cancelTranscription: (filePath) => ipcRenderer.invoke('cancel-transcription', filePath),
    updateConfig: (config) => ipcRenderer.invoke('update-config', config),
    openOutputDirectory: () => ipcRenderer.invoke('open-output-directory')
});
