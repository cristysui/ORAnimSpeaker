const { app, BrowserWindow, ipcMain, dialog, session, systemPreferences } = require('electron')
const fs = require('fs/promises')
const path = require('path')

let mainWindow

function createWindow() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    if (permission === 'media') {
      callback(details.mediaTypes?.includes('audio') === true)
      return
    }
    callback(false)
  })

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 允许加载本地文件资源
      webSecurity: false
    },
    title: '语音人物工具'
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools()
  }
}

// IPC: 打开文件选择对话框（选音频文件）
ipcMain.handle('open-audio-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择音频文件',
    filters: [
      { name: '音频文件', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'mp4', 'mov'] }
    ],
    properties: ['openFile']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

// IPC: 请求系统麦克风权限（macOS 需要主进程触发系统授权弹窗）
ipcMain.handle('request-microphone-access', async () => {
  if (process.platform !== 'darwin') return true

  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') return true
  if (status === 'denied' || status === 'restricted') return false

  return systemPreferences.askForMediaAccess('microphone')
})

// IPC: 打开角色配置文件
ipcMain.handle('open-config-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择角色配置文件',
    filters: [
      { name: 'JSON 配置文件', extensions: ['json'] }
    ],
    properties: ['openFile']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

// IPC: 保存角色配置文件
ipcMain.handle('save-config-file', async (event, filePath, config) => {
  if (!filePath) {
    throw new Error('缺少配置文件路径')
  }

  const json = typeof config === 'string' ? config : JSON.stringify(config, null, 2)
  await fs.writeFile(filePath, `${json}\n`, 'utf8')
  return true
})

// IPC: 获取应用根目录（用于加载默认资源）
ipcMain.handle('get-app-path', () => {
  return app.getAppPath()
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
