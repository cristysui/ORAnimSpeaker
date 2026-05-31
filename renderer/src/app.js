/**
 * app.js - 主入口
 * 串联：AudioAnalyzer → StateMachine → CharacterController → UI 更新
 */
import { AudioAnalyzer } from './AudioAnalyzer.js'
import { StateMachine, STATE } from './StateMachine.js'
import { CharacterController } from './CharacterController.js'

// ---- 初始化各模块 ----
const canvasArea = document.getElementById('canvas-area')
const analyzer = new AudioAnalyzer()
const stateMachine = new StateMachine({
  silenceThreshold: 0.03,
  silenceDelayMs: 300
})
const character = new CharacterController(canvasArea)

let isAudioRunning = false
let configLoaded = false
let characterTicker = null
let currentConfigPath = null
let editMode = false
let selectedLayerId = null
let dragState = null
let timelineRecording = false
let timelineEvents = []
let playbackTimelineIndex = 0
let audioStartedAt = 0

// ---- 状态机回调 ----
stateMachine._onStateChange = (newState, oldState) => {
  // 更新角色
  character.onStateChange(newState, oldState)
  // 更新 UI 状态徽章
  const badge = document.getElementById('status-badge')
  badge.textContent = newState === STATE.SPEAKING ? 'speaking' : 'idle'
  badge.className = `status-badge ${newState}`
}

stateMachine._onMouthChange = (mouthState) => {
  character.onMouthChange(mouthState)
  // 更新口型指示点
  document.querySelectorAll('.mouth-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.state === mouthState)
  })
}

// ---- 音量回调：驱动状态机 ----
analyzer.onVolume((rms) => {
  stateMachine.update(rms)
  // 更新音量条
  const pct = Math.min(rms / 0.5 * 100, 100)
  document.getElementById('volume-bar').style.width = `${pct}%`
  document.getElementById('volume-label').textContent = rms.toFixed(3)
})

// ---- UI 事件 ----

// 加载角色配置
document.getElementById('btn-load-config').addEventListener('click', async () => {
  const filePath = await window.electronAPI.openConfigFile()
  if (!filePath) return

  try {
    const response = await fetch(`file://${filePath}`)
    const config = await response.json()
    const baseDir = filePath.substring(0, filePath.lastIndexOf('/'))
    currentConfigPath = filePath

    document.getElementById('current-action').textContent = '加载中...'
    const result = await character.init(config, baseDir)

    // 如果配置有自定义口型阈值，传给状态机
    if (result.mouthThresholds) {
      stateMachine.setMouthThresholds(result.mouthThresholds)
    }

    configLoaded = true
    document.getElementById('current-action').innerHTML = '角色已加载 ✓'
    document.getElementById('btn-mic').disabled = false
    document.getElementById('btn-audio-file').disabled = false
    setActionButtonsEnabled(true)
    setEditorEnabled(true)
    setTimelineControlsEnabled(true)
    refreshLayerEditor()

    attachCharacterTicker()
  } catch (err) {
    console.error('加载配置失败:', err)
    document.getElementById('current-action').textContent = `加载失败: ${err.message}`
  }
})

// 麦克风输入
document.getElementById('btn-mic').addEventListener('click', async () => {
  if (isAudioRunning) return
  if (!configLoaded) {
    alert('请先加载角色配置文件')
    return
  }
  try {
    const hasPermission = await window.electronAPI.requestMicrophoneAccess()
    if (!hasPermission) {
      alert('麦克风权限未开启，请在系统设置中允许本应用访问麦克风')
      return
    }

    await analyzer.startMicrophone()
    startAudioClock()
    isAudioRunning = true
    document.getElementById('btn-mic').classList.add('active')
    document.getElementById('btn-mic').textContent = '🎤 麦克风监听中'
    document.getElementById('btn-stop').disabled = false
    document.getElementById('btn-audio-file').disabled = true
  } catch (err) {
    console.error('麦克风启动失败:', err)
    alert('无法访问麦克风，请检查权限')
  }
})

// 音频文件输入
document.getElementById('btn-audio-file').addEventListener('click', async () => {
  if (isAudioRunning) return
  if (!configLoaded) {
    alert('请先加载角色配置文件')
    return
  }
  const filePath = await window.electronAPI.openAudioFile()
  if (!filePath) return

  isAudioRunning = true
  startAudioClock()
  document.getElementById('btn-audio-file').classList.add('active')
  document.getElementById('btn-audio-file').textContent = '🎵 播放中...'
  document.getElementById('btn-stop').disabled = false
  document.getElementById('btn-mic').disabled = true

  // 播放完成后自动重置
  analyzer.startAudioFile(filePath).then(() => {
    resetAudioState()
  }).catch(err => {
    console.error('音频文件播放失败:', err)
    alert(`音频文件播放失败: ${err.message}`)
    resetAudioState()
  })
})

// 停止
document.getElementById('btn-stop').addEventListener('click', () => {
  analyzer.stop()
  resetAudioState()
  stateMachine.reset()
})

// 重置音频状态的 UI
function resetAudioState() {
  isAudioRunning = false
  document.getElementById('btn-mic').classList.remove('active')
  document.getElementById('btn-mic').textContent = '🎤 使用麦克风'
  document.getElementById('btn-audio-file').classList.remove('active')
  document.getElementById('btn-audio-file').textContent = '🎵 导入音频文件'
  document.getElementById('btn-stop').disabled = true
  document.getElementById('btn-mic').disabled = !configLoaded
  document.getElementById('btn-audio-file').disabled = !configLoaded
  document.getElementById('volume-bar').style.width = '0%'
  document.getElementById('volume-label').textContent = '0.00'
  document.querySelectorAll('.mouth-dot').forEach(d => d.classList.remove('active'))
  const badge = document.getElementById('status-badge')
  badge.textContent = 'idle'
  badge.className = 'status-badge idle'
  playbackTimelineIndex = 0
}

function attachCharacterTicker() {
  if (!character.app) return
  if (characterTicker) {
    character.app.ticker.remove(characterTicker)
  }

  characterTicker = () => {
    character.tick(character.app.ticker.deltaMS)
    playTimelineEvents()
  }
  character.app.ticker.add(characterTicker)
}

function triggerManualAction(actionId) {
  if (!configLoaded) return
  const triggered = character.triggerAction(actionId)
  if (!triggered) return

  const action = character.getAvailableActions().find(item => item.id === actionId)
  const actionEl = document.getElementById('current-action')
  if (actionEl && action) {
    actionEl.innerHTML = `动作: <span>${action.label}</span>`
    setTimeout(() => {
      if (configLoaded && actionEl.textContent.includes(action.label)) {
        actionEl.innerHTML = isAudioRunning ? '音频驱动中' : '待机中'
      }
    }, action.duration)
  }
  recordTimelineEvent(actionId)
}

function setActionButtonsEnabled(enabled) {
  document.querySelectorAll('.action-btn').forEach(button => {
    button.disabled = !enabled
  })
}

function setEditorEnabled(enabled) {
  document.getElementById('btn-edit-mode').disabled = !enabled
  document.getElementById('layer-select').disabled = !enabled
  document.getElementById('btn-save-config').disabled = !enabled
}

function setTimelineControlsEnabled(enabled) {
  document.getElementById('btn-record-timeline').disabled = !enabled
  document.getElementById('btn-clear-timeline').disabled = !enabled
}

function setLayerInputsEnabled(enabled) {
  ['layer-x', 'layer-y', 'layer-scale', 'layer-rotation', 'layer-z'].forEach(id => {
    document.getElementById(id).disabled = !enabled
  })
}

function refreshLayerEditor() {
  const layers = character.getEditableLayers()
  const select = document.getElementById('layer-select')
  select.innerHTML = ''

  for (const layer of layers) {
    const option = document.createElement('option')
    option.value = layer.id
    option.textContent = `${layer.label} (${layer.id})`
    select.appendChild(option)
  }

  const nextLayer = layers.find(layer => layer.id === selectedLayerId) || layers[0]
  selectedLayerId = nextLayer?.id || null
  if (selectedLayerId) {
    select.value = selectedLayerId
    character.selectLayer(editMode ? selectedLayerId : null)
    syncLayerFields(nextLayer)
  }
  setLayerInputsEnabled(Boolean(selectedLayerId))
}

function syncLayerFields(layer) {
  if (!layer) return
  document.getElementById('layer-x').value = layer.x
  document.getElementById('layer-y').value = layer.y
  document.getElementById('layer-scale').value = layer.scale
  document.getElementById('layer-rotation').value = layer.rotationDeg
  document.getElementById('layer-z').value = layer.zIndex
}

function updateSelectedLayerFromFields() {
  if (!selectedLayerId) return
  const updated = character.updateLayerTransform(selectedLayerId, {
    x: parseFloat(document.getElementById('layer-x').value),
    y: parseFloat(document.getElementById('layer-y').value),
    scale: parseFloat(document.getElementById('layer-scale').value),
    rotation: parseFloat(document.getElementById('layer-rotation').value) * Math.PI / 180,
    zIndex: parseFloat(document.getElementById('layer-z').value)
  })
  if (updated) syncLayerFields(updated)
}

async function saveCurrentConfig() {
  if (!currentConfigPath) return
  try {
    await window.electronAPI.saveConfigFile(currentConfigPath, character.exportConfig())
    document.getElementById('current-action').innerHTML = '配置已保存 ✓'
  } catch (err) {
    console.error('保存配置失败:', err)
    alert(`保存配置失败: ${err.message}`)
  }
}

function canvasPointFromEvent(event) {
  if (!character.app?.view) return null
  const rect = character.app.view.getBoundingClientRect()
  const x = (event.clientX - rect.left) * (character.app.renderer.width / rect.width)
  const y = (event.clientY - rect.top) * (character.app.renderer.height / rect.height)
  return { x, y }
}

function startAudioClock() {
  audioStartedAt = performance.now()
  playbackTimelineIndex = 0
}

function getTimelineTime() {
  if (!audioStartedAt) return 0
  return (performance.now() - audioStartedAt) / 1000
}

function recordTimelineEvent(actionId) {
  if (!timelineRecording || !isAudioRunning) return
  const action = character.getAvailableActions().find(item => item.id === actionId)
  timelineEvents.push({
    time: Number(getTimelineTime().toFixed(2)),
    type: 'action',
    id: actionId,
    label: action?.label || actionId
  })
  renderTimelineList()
}

function playTimelineEvents() {
  if (!isAudioRunning || timelineRecording || timelineEvents.length === 0) return
  const currentTime = getTimelineTime()
  while (playbackTimelineIndex < timelineEvents.length && timelineEvents[playbackTimelineIndex].time <= currentTime) {
    character.triggerAction(timelineEvents[playbackTimelineIndex].id)
    playbackTimelineIndex++
  }
}

function renderTimelineList() {
  const list = document.getElementById('timeline-list')
  if (timelineEvents.length === 0) {
    list.textContent = '暂无动作记录'
    return
  }
  list.innerHTML = timelineEvents
    .map(event => `<div>${event.time.toFixed(2)}s ${event.label}</div>`)
    .join('')
}

// 初始状态：禁用音频按钮直到角色加载完成
document.getElementById('btn-mic').disabled = true
document.getElementById('btn-audio-file').disabled = true
setActionButtonsEnabled(false)
setEditorEnabled(false)
setTimelineControlsEnabled(false)
setLayerInputsEnabled(false)

document.querySelectorAll('.action-btn').forEach(button => {
  button.addEventListener('click', () => {
    triggerManualAction(button.dataset.action)
  })
})

document.addEventListener('keydown', (event) => {
  if (event.repeat) return
  const activeTag = document.activeElement?.tagName?.toLowerCase()
  if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return

  const actionByKey = {
    1: 'nod',
    2: 'shake',
    3: 'emphasis'
  }
  const actionId = actionByKey[event.key]
  if (actionId) triggerManualAction(actionId)
})

document.getElementById('btn-edit-mode').addEventListener('click', () => {
  editMode = !editMode
  document.getElementById('btn-edit-mode').textContent = editMode ? '关闭编辑模式' : '开启编辑模式'
  character.selectLayer(editMode ? selectedLayerId : null)
})

document.getElementById('layer-select').addEventListener('change', (event) => {
  selectedLayerId = event.target.value
  const layer = character.getEditableLayers().find(item => item.id === selectedLayerId)
  character.selectLayer(editMode ? selectedLayerId : null)
  syncLayerFields(layer)
})

document.getElementById('btn-save-config').addEventListener('click', saveCurrentConfig)
;['layer-x', 'layer-y', 'layer-scale', 'layer-rotation', 'layer-z'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateSelectedLayerFromFields)
})

canvasArea.addEventListener('pointerdown', (event) => {
  if (!editMode || !character.app) return
  const point = canvasPointFromEvent(event)
  if (!point) return
  const layerId = character.pickLayerAt(point.x, point.y)
  if (!layerId) return

  selectedLayerId = layerId
  character.selectLayer(layerId)
  document.getElementById('layer-select').value = layerId
  const layer = character.getEditableLayers().find(item => item.id === layerId)
  syncLayerFields(layer)
  dragState = {
    layerId,
    offsetX: point.x - layer.x,
    offsetY: point.y - layer.y
  }
  canvasArea.setPointerCapture(event.pointerId)
})

canvasArea.addEventListener('pointermove', (event) => {
  if (!dragState) return
  const point = canvasPointFromEvent(event)
  if (!point) return
  const updated = character.updateLayerTransform(dragState.layerId, {
    x: point.x - dragState.offsetX,
    y: point.y - dragState.offsetY
  })
  if (updated) syncLayerFields(updated)
})

canvasArea.addEventListener('pointerup', (event) => {
  dragState = null
  try { canvasArea.releasePointerCapture(event.pointerId) } catch (err) {}
})

document.getElementById('btn-record-timeline').addEventListener('click', () => {
  timelineRecording = !timelineRecording
  document.getElementById('btn-record-timeline').textContent = timelineRecording ? '停止录制动作' : '开始录制动作'
  if (timelineRecording) {
    timelineEvents = []
    playbackTimelineIndex = 0
    if (!isAudioRunning) startAudioClock()
  }
  renderTimelineList()
})

document.getElementById('btn-clear-timeline').addEventListener('click', () => {
  timelineEvents = []
  playbackTimelineIndex = 0
  renderTimelineList()
})

// ---- 参数调节滑块 ----
function bindSlider(id, valId, transform, onChange) {
  const slider = document.getElementById(id)
  const valEl = document.getElementById(valId)
  slider.addEventListener('input', () => {
    const val = transform(slider.value)
    valEl.textContent = val
    onChange(val)
  })
}

bindSlider('silence-threshold', 'silence-threshold-val',
  v => (parseInt(v) / 1000).toFixed(3),
  v => stateMachine.setConfig({ silenceThreshold: parseFloat(v) })
)
// 重新绑定，显示整数
document.getElementById('silence-threshold').addEventListener('input', function() {
  document.getElementById('silence-threshold-val').textContent = this.value
  stateMachine.setConfig({ silenceThreshold: parseInt(this.value) / 1000 })
})

bindSlider('silence-delay', 'silence-delay-val',
  v => parseInt(v),
  v => stateMachine.setConfig({ silenceDelayMs: v })
)

bindSlider('mouth-hold', 'mouth-hold-val',
  v => parseFloat(v).toFixed(1),
  v => stateMachine.setConfig({ mouthHoldMs: parseFloat(v) * 1000 })
)

bindSlider('idle-interval', 'idle-interval-val',
  v => parseFloat(v),
  v => character.setIdleInterval(v * 1000)
)
