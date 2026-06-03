const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openAudioFile: () => ipcRenderer.invoke('open-audio-file'),
  openVideoFiles: () => ipcRenderer.invoke('open-video-files'),
  openConfigFile: () => ipcRenderer.invoke('open-config-file'),
  saveConfigFile: (filePath, config) => ipcRenderer.invoke('save-config-file', filePath, config),
  loadVideoProjectConfig: () => ipcRenderer.invoke('load-video-project-config'),
  saveVideoProjectConfig: (config) => ipcRenderer.invoke('save-video-project-config', config),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  requestMicrophoneAccess: () => ipcRenderer.invoke('request-microphone-access')
})
