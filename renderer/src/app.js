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

    // 挂载 PixiJS ticker
    character.app.ticker.add((delta) => {
      character.tick(delta * (1000 / 60)) // delta 是帧系数，转换为 ms
    })
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
  stateMachine.update(0) // 强制回到 IDLE
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
}

// 初始状态：禁用音频按钮直到角色加载完成
document.getElementById('btn-mic').disabled = true
document.getElementById('btn-audio-file').disabled = true

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

bindSlider('idle-interval', 'idle-interval-val',
  v => parseFloat(v),
  v => character.setIdleInterval(v * 1000)
)
