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
    getRecordingThumbnail: (folderName, recPath) => ipcRenderer.invoke('get-recording-thumbnail', folderName, recPath),
    updateConfig: (config) => ipcRenderer.invoke('update-config', config),
    openOutputDirectory: () => ipcRenderer.invoke('open-output-directory'),
    openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
    openFileLocation: (filePath) => ipcRenderer.invoke('open-file-location', filePath),
    getFileBuffer: (filePath) => ipcRenderer.invoke('get-file-buffer', filePath),
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
    renameRecording: (data) => ipcRenderer.invoke('rename-recording', data),
    saveScreenshot: (data) => ipcRenderer.invoke('save-screenshot', data),
    discardMeetingScreenshots: (folderName) => ipcRenderer.invoke('discard-meeting-screenshots', folderName),
    onStartManualRecording: (callback) => ipcRenderer.on('start-manual-recording', () => callback()),
    onStopRecording: (callback) => ipcRenderer.on('stop-recording', () => callback()),
    onTriggerManualScreenshot: (callback) => ipcRenderer.on('trigger-manual-screenshot', () => callback()),
    
    // Overlay Methods
    onOverlayUpdate: (callback) => ipcRenderer.on('overlay-update', (_event, data) => callback(data)),
    sendOverlayAction: (action) => ipcRenderer.send('overlay-action', action),
    syncOverlay: (data) => ipcRenderer.send('sync-overlay', data),
    
    showOverlay: () => ipcRenderer.send('show-overlay'),
    hideOverlay: () => ipcRenderer.send('hide-overlay'),
    onTogglePause: (callback) => ipcRenderer.on('toggle-pause', () => callback()),

    // Organization Config
    getOrganizationConfig: () => ipcRenderer.invoke('get-organization-config'),
    updateOrganizationConfig: (config) => ipcRenderer.invoke('update-organization-config', config),
    previewOrganizationPath: (data) => ipcRenderer.invoke('preview-organization-path', data),
    archiveRecordings: (data) => ipcRenderer.invoke('archive-recordings', data),
    reorganizeFiles: (data) => ipcRenderer.invoke('reorganize-files', data),

    // Tagging System
    updateRecordingTags: (data) => ipcRenderer.invoke('update-recording-tags', data),
    getTagCategories: () => ipcRenderer.invoke('get-tag-categories'),
    updateTagCategories: (categories) => ipcRenderer.invoke('update-tag-categories', categories),
});