const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSources: () => ipcRenderer.invoke('get-sources'),
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    getConfig: () => ipcRenderer.invoke('get-config'),
    openSettings: () => ipcRenderer.send('open-settings'),
    onMeetingDetected: (callback) => ipcRenderer.on('meeting-detected', (_event, value) => callback(value)),
    onNoMeetingDetected: (callback) => ipcRenderer.on('no-meeting-detected', (_event) => callback()),
    saveFile: (data) => ipcRenderer.invoke('save-file', data),
    onConfigUpdated: (callback) => ipcRenderer.on('config-updated', (_event, value) => callback(value)),
    onTranscriptionStatus: (callback) => ipcRenderer.on('transcription-status', (_event, value) => callback(value))
});
