const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openAudioFile: () => ipcRenderer.invoke('open-audio-file'),
  openConfigFile: () => ipcRenderer.invoke('open-config-file'),
  saveConfigFile: (filePath, config) => ipcRenderer.invoke('save-config-file', filePath, config),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  requestMicrophoneAccess: () => ipcRenderer.invoke('request-microphone-access')
})
