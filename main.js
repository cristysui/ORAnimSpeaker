const { app, BrowserWindow, ipcMain, dialog, session, systemPreferences } = require('electron')
const fs = require('fs/promises')
const path = require('path')

let mainWindow

function createDefaultVideoProjectConfig() {
  return {
    characters: [
      {
        id: 'default',
        name: '默认角色',
        clips: {
          speaking: [],
          manualSpeaking: [],
          idle: [],
          actions: []
        }
      }
    ],
    lastCanvas: { width: 1080, height: 1920 }
  }
}

function getVideoProjectConfigPath() {
  return path.join(app.getPath('userData'), 'video-project-config.json')
}

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
    title: 'ORAnimSpeaker'
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

// IPC: 打开文件选择对话框（选视频片段，可多选）
ipcMain.handle('open-video-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频片段',
    filters: [
      { name: '视频文件', extensions: ['mp4', 'mov', 'webm', 'm4v'] }
    ],
    properties: ['openFile', 'multiSelections']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths
  }
  return []
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

// IPC: 读取视频片段工作流配置（保存到本机应用数据目录）
ipcMain.handle('load-video-project-config', async () => {
  const configPath = getVideoProjectConfigPath()
  try {
    const text = await fs.readFile(configPath, 'utf8')
    return JSON.parse(text)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    const config = createDefaultVideoProjectConfig()
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    return config
  }
})

// IPC: 保存视频片段工作流配置
ipcMain.handle('save-video-project-config', async (event, config) => {
  const configPath = getVideoProjectConfigPath()
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
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
