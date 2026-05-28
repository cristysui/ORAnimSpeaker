const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openAudioFile: () => ipcRenderer.invoke('open-audio-file'),
  openConfigFile: () => ipcRenderer.invoke('open-config-file'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  requestMicrophoneAccess: () => ipcRenderer.invoke('request-microphone-access')
})
