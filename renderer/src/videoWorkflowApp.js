import { AudioAnalyzer } from './AudioAnalyzer.js'
import { StateMachine, STATE } from './StateMachine.js'
import { VideoClipController } from './VideoClipController.js'

const CLIP_TYPES = [
  { id: 'speaking', label: '自动说话' },
  { id: 'manualSpeaking', label: '手动说话' },
  { id: 'idle', label: '静止动作' },
  { id: 'actions', label: '其他动作' }
]

const CANVAS_PRESETS = [
  { label: '横屏 1920 x 1080', width: 1920, height: 1080 },
  { label: '竖屏 1080 x 1920', width: 1080, height: 1920 },
  { label: '横屏 1280 x 720', width: 1280, height: 720 }
]

const analyzer = new AudioAnalyzer()
const stateMachine = new StateMachine({
  silenceThreshold: 0.03,
  silenceDelayMs: 300
})

let projectConfig = null
let activeCharacterId = 'default'
let activeView = 'home'
let currentCanvas = { width: 1080, height: 1920 }
let videoClips = null
let isAudioRunning = false
let onionTargetId = null
let onionDrag = null
let onionCameraZoom = 0.5
let onionResize = null
let onionAnchorDrag = null

stateMachine._onStateChange = (newState) => {
  videoClips?.setAudioSpeaking(newState === STATE.SPEAKING)
  updateStatusBadge(newState)
}

analyzer.onVolume((rms) => {
  stateMachine.update(rms)
  const pct = Math.min(rms / 0.5 * 100, 100)
  const bar = document.getElementById('volume-bar')
  const label = document.getElementById('volume-label')
  if (bar) bar.style.width = `${pct}%`
  if (label) label.textContent = rms.toFixed(3)
})

boot()

async function boot() {
  projectConfig = await window.electronAPI.loadVideoProjectConfig()
  ensureProjectShape()
  currentCanvas = projectConfig.lastCanvas || currentCanvas
  renderShell()
  showView('home')
}

function renderShell() {
  document.body.innerHTML = `
    <div id="titlebar">
      <h1>视频片段角色工具</h1>
      <div class="status-badge idle" id="status-badge">idle</div>
    </div>
    <main id="app-root">
      <section class="view" id="home-view">
        <div class="home-card" id="entry-character">
          <h2>人物动画配置</h2>
          <p>上传并管理静止、说话、手动说话和其他动作视频。配置会自动保存，下次打开继续使用。</p>
          <button class="btn btn-primary">进入配置</button>
        </div>
        <div class="home-card" id="entry-create">
          <h2>创建视频</h2>
          <p>选择画布大小后进入稿件编辑和预览界面，用音频驱动视频片段自动衔接。</p>
          <button class="btn btn-primary">创建稿件</button>
        </div>
      </section>

      <section class="view hidden" id="config-view">
        <div class="topbar">
          <button class="btn btn-secondary" id="back-home-from-config">返回首页</button>
          <h2>人物动画配置</h2>
          <button class="btn btn-primary" id="save-character-config">保存配置</button>
        </div>
        <div class="config-layout">
          <div class="clip-config-panel">
            <div class="setting-row">
              <label>角色名</label>
              <input type="text" id="character-name">
            </div>
            <div id="clip-sections"></div>
          </div>
          <div class="onion-panel">
            <h3>洋葱皮对齐</h3>
            <div class="setting-row">
              <label>参考视频</label>
              <select id="onion-reference"></select>
            </div>
            <div class="setting-row">
              <label>调整视频</label>
              <select id="onion-target"></select>
            </div>
            <div class="onion-stage" id="onion-stage">
              <div class="onion-camera" id="onion-camera">
                <video id="onion-reference-video" muted loop playsinline></video>
                <video id="onion-target-video" muted loop playsinline></video>
                <div class="onion-box hidden" id="onion-transform-box">
                  <div class="resize-handle nw" data-resize="nw"></div>
                  <div class="resize-handle ne" data-resize="ne"></div>
                  <div class="resize-handle sw" data-resize="sw"></div>
                  <div class="resize-handle se" data-resize="se"></div>
                  <div class="anchor-handle" id="anchor-handle"></div>
                </div>
              </div>
            </div>
            <div class="setting-row">
              <label>预览缩放</label>
              <input type="range" id="onion-zoom" min="0.1" max="2" step="0.05" value="${onionCameraZoom}">
            </div>
            <button class="btn btn-secondary" id="onion-fit">适配完整画布</button>
            <button class="btn btn-secondary" id="onion-align-anchor">按锚点对齐参考视频</button>
            <div class="setting-row">
              <label>透明度</label>
              <input type="range" id="onion-opacity" min="0.1" max="1" step="0.05" value="0.45">
            </div>
            <div class="grid-fields">
              <label>X <input type="number" id="clip-x" step="1"></label>
              <label>Y <input type="number" id="clip-y" step="1"></label>
              <label>宽 <input type="number" id="clip-width" step="1"></label>
              <label>高 <input type="number" id="clip-height" step="1"></label>
              <label>缩放 <input type="number" id="clip-scale" step="0.05"></label>
              <label>旋转 <input type="number" id="clip-rotation" step="1"></label>
            </div>
            <p class="hint">拖动上层半透明视频调整位置，拖蓝色角点等比缩放，拖橙色锚点标记人物对齐点。调整会实时保存到当前角色配置。</p>
          </div>
        </div>
      </section>

      <section class="view hidden" id="editor-view">
        <div class="topbar">
          <button class="btn btn-secondary" id="back-home-from-editor">返回首页</button>
          <h2>稿件编辑与预览</h2>
          <div class="canvas-label" id="canvas-label"></div>
        </div>
        <div class="editor-layout">
          <div class="preview-wrap">
            <div class="preview-stage" id="editor-preview-stage"></div>
          </div>
          <aside class="editor-panel">
            <div class="panel-section">
              <h3>音频输入</h3>
              <button class="btn btn-secondary" id="btn-mic">使用麦克风</button>
              <button class="btn btn-secondary" id="btn-audio-file">导入音频文件</button>
              <button class="btn btn-danger" id="btn-stop" disabled>停止</button>
            </div>
            <div class="panel-section">
              <h3>手动片段</h3>
              <button class="btn btn-secondary" id="manual-idle">静止</button>
              <button class="btn btn-secondary" id="manual-speaking">手动说话</button>
              <button class="btn btn-secondary" id="manual-action">其他动作</button>
              <button class="btn btn-secondary" id="manual-replay">回放当前片段</button>
            </div>
            <div class="panel-section">
              <h3>实时音量</h3>
              <div id="volume-bar-container"><div id="volume-bar"></div></div>
              <div id="volume-label">0.00</div>
            </div>
            <div class="panel-section">
              <h3>参数</h3>
              <div class="setting-row">
                <label>静默阈值</label>
                <input type="range" id="silence-threshold" min="1" max="20" value="3" step="1">
              </div>
              <div class="setting-row">
                <label>静默延迟(ms)</label>
                <input type="range" id="silence-delay" min="100" max="1000" value="300" step="50">
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>

    <div class="modal hidden" id="canvas-modal">
      <div class="modal-card">
        <h2>选择画布大小</h2>
        <div id="canvas-presets"></div>
        <div class="grid-fields">
          <label>宽 <input type="number" id="custom-width" value="${currentCanvas.width}"></label>
          <label>高 <input type="number" id="custom-height" value="${currentCanvas.height}"></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="cancel-canvas">取消</button>
          <button class="btn btn-primary" id="confirm-custom-canvas">使用自定义</button>
        </div>
      </div>
    </div>
  `
  injectWorkflowStyles()
  bindShellEvents()
}

function injectWorkflowStyles() {
  const style = document.createElement('style')
  style.textContent = `
    #app-root { flex: 1; min-height: 0; }
    .hidden { display: none !important; }
    .view { height: calc(100vh - 38px); padding: 24px; overflow: auto; }
    #home-view { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: stretch; }
    .home-card { background: #0d1b33; border: 1px solid #0f3460; border-radius: 18px; padding: 28px; display: flex; flex-direction: column; justify-content: space-between; }
    .home-card h2, .topbar h2, .modal-card h2 { color: #e0e7ff; margin-bottom: 12px; }
    .home-card p, .hint { color: #8090b0; line-height: 1.6; font-size: 13px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
    .config-layout { display: grid; grid-template-columns: 360px 1fr; gap: 18px; }
    .clip-config-panel, .onion-panel, .editor-panel, .preview-wrap, .modal-card { background: #0d1b33; border: 1px solid #0f3460; border-radius: 14px; padding: 16px; }
    .clip-card { background: #0a1225; border: 1px solid #203552; border-radius: 10px; padding: 10px; margin: 8px 0; }
    .clip-row { display: grid; grid-template-columns: 1fr auto auto; gap: 6px; align-items: center; margin-top: 6px; }
    .clip-row input { min-width: 0; }
    .onion-stage { position: relative; height: 520px; background: #020617; border-radius: 10px; overflow: auto; margin: 12px 0; }
    .onion-camera { position: relative; width: 1080px; height: 1920px; transform-origin: top left; }
    .onion-stage video, .preview-stage video { position: absolute; object-fit: fill; background: #020617; }
    #onion-reference-video { opacity: 1; pointer-events: none; }
    #onion-target-video { opacity: 0.45; cursor: move; }
    .onion-box { position: absolute; border: 2px solid #60a5fa; pointer-events: none; transform-origin: top left; }
    .resize-handle { position: absolute; width: 12px; height: 12px; background: #60a5fa; border: 2px solid #dbeafe; border-radius: 50%; pointer-events: auto; }
    .resize-handle.nw { left: -7px; top: -7px; cursor: nwse-resize; }
    .resize-handle.ne { right: -7px; top: -7px; cursor: nesw-resize; }
    .resize-handle.sw { left: -7px; bottom: -7px; cursor: nesw-resize; }
    .resize-handle.se { right: -7px; bottom: -7px; cursor: nwse-resize; }
    .anchor-handle { position: absolute; width: 14px; height: 14px; margin-left: -7px; margin-top: -7px; background: #f97316; border: 2px solid #fff7ed; border-radius: 50%; pointer-events: auto; cursor: crosshair; }
    .grid-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .grid-fields label { color: #8090b0; font-size: 12px; display: grid; gap: 4px; }
    input, select { padding: 6px 8px; border: 1px solid #2d3f60; border-radius: 6px; background: #0a1225; color: #dbeafe; }
    .editor-layout { display: grid; grid-template-columns: 1fr 300px; gap: 18px; height: calc(100% - 56px); }
    .preview-wrap { display: flex; align-items: center; justify-content: center; min-height: 0; }
    .preview-stage { position: relative; background: #020617; overflow: hidden; border-radius: 12px; }
    .preview-stage .character-video { max-width: none; max-height: none; border-radius: 0; object-fit: fill; }
    .modal { position: fixed; inset: 0; background: rgba(2, 6, 23, 0.72); display: flex; align-items: center; justify-content: center; z-index: 100; }
    .modal-card { width: 420px; }
    .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
    .canvas-label { color: #8090b0; font-size: 12px; }
  `
  document.head.appendChild(style)
}

function bindShellEvents() {
  document.getElementById('entry-character').addEventListener('click', () => {
    renderCharacterConfig()
    showView('config')
  })
  document.getElementById('entry-create').addEventListener('click', openCanvasDialog)
  document.getElementById('back-home-from-config').addEventListener('click', () => showView('home'))
  document.getElementById('back-home-from-editor').addEventListener('click', () => {
    stopAudio()
    showView('home')
  })
  document.getElementById('save-character-config').addEventListener('click', saveProject)
  document.getElementById('cancel-canvas').addEventListener('click', closeCanvasDialog)
  document.getElementById('confirm-custom-canvas').addEventListener('click', () => {
    const width = parseInt(document.getElementById('custom-width').value, 10)
    const height = parseInt(document.getElementById('custom-height').value, 10)
    startEditor({ width, height })
  })
  bindEditorEvents()
  bindOnionEvents()
}

function showView(view) {
  activeView = view
  document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'))
  document.getElementById(`${view}-view`).classList.remove('hidden')
}

function ensureProjectShape() {
  if (!projectConfig.characters?.length) {
    projectConfig.characters = [{ id: 'default', name: '默认角色', clips: {} }]
  }
  const character = getCharacter()
  character.clips ||= {}
  for (const type of CLIP_TYPES) character.clips[type.id] ||= []
  projectConfig.lastCanvas ||= { width: 1080, height: 1920 }
}

function getCharacter() {
  return projectConfig.characters.find(item => item.id === activeCharacterId) || projectConfig.characters[0]
}

async function saveProject() {
  ensureProjectShape()
  await window.electronAPI.saveVideoProjectConfig(projectConfig)
}

function renderCharacterConfig() {
  const character = getCharacter()
  document.getElementById('character-name').value = character.name || '默认角色'
  document.getElementById('character-name').oninput = (event) => {
    character.name = event.target.value
    saveProject()
  }

  const container = document.getElementById('clip-sections')
  container.innerHTML = CLIP_TYPES.map(type => renderClipSection(type, character.clips[type.id] || [])).join('')
  container.querySelectorAll('[data-upload-type]').forEach(button => {
    button.addEventListener('click', () => uploadClips(button.dataset.uploadType))
  })
  container.querySelectorAll('[data-rename-clip]').forEach(input => {
    input.addEventListener('input', () => renameClip(input.dataset.renameClip, input.value))
  })
  container.querySelectorAll('[data-delete-clip]').forEach(button => {
    button.addEventListener('click', () => deleteClip(button.dataset.deleteClip))
  })
  refreshOnionSelectors()
  updateOnionCamera()
}

function renderClipSection(type, clips) {
  const rows = clips.map(clip => `
    <div class="clip-row">
      <input data-rename-clip="${clip.id}" value="${escapeHtml(clip.name || type.label)}">
      <button class="btn btn-secondary" data-delete-clip="${clip.id}">删除</button>
    </div>
  `).join('')
  return `
    <div class="clip-card">
      <h3>${type.label}</h3>
      <button class="btn btn-secondary" data-upload-type="${type.id}">上传${type.label}视频</button>
      ${rows || '<p class="hint">还没有视频</p>'}
    </div>
  `
}

async function uploadClips(type) {
  const files = await window.electronAPI.openVideoFiles()
  if (!files?.length) return
  const character = getCharacter()
  character.clips[type].push(...files.map((filePath, index) => createClip(type, filePath, index)))
  await saveProject()
  renderCharacterConfig()
}

function createClip(type, filePath, index = 0) {
  const typeLabel = CLIP_TYPES.find(item => item.id === type)?.label || '动作'
  return {
    id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    name: `${typeLabel}${index + 1}`,
    filePath,
    transform: {
      x: 0,
      y: 0,
      scale: 1,
      width: null,
      height: null,
      rotation: 0
    }
  }
}

function renameClip(clipId, name) {
  const clip = findClip(clipId)
  if (!clip) return
  clip.name = name
  saveProject()
  refreshOnionSelectors()
}

function deleteClip(clipId) {
  const character = getCharacter()
  for (const type of CLIP_TYPES) {
    character.clips[type.id] = character.clips[type.id].filter(clip => clip.id !== clipId)
  }
  saveProject()
  renderCharacterConfig()
}

function findClip(clipId) {
  return Object.values(getCharacter().clips).flat().find(clip => clip.id === clipId)
}

function refreshOnionSelectors() {
  const clips = Object.values(getCharacter().clips).flat()
  const options = clips.map(clip => `<option value="${clip.id}">${escapeHtml(clip.name)}</option>`).join('')
  document.getElementById('onion-reference').innerHTML = options
  document.getElementById('onion-target').innerHTML = options
  onionTargetId ||= clips[0]?.id || null
  if (onionTargetId) document.getElementById('onion-target').value = onionTargetId
  loadOnionVideos()
}

function loadOnionVideos() {
  const reference = findClip(document.getElementById('onion-reference').value)
  const target = findClip(document.getElementById('onion-target').value)
  onionTargetId = target?.id || null
  setupOnionVideo('onion-reference-video', reference, 1)
  setupOnionVideo('onion-target-video', target, parseFloat(document.getElementById('onion-opacity').value))
  syncTransformFields(target)
  updateOnionCamera()
}

function setupOnionVideo(id, clip, opacity) {
  const video = document.getElementById(id)
  if (!clip) {
    video.removeAttribute('src')
    return
  }
  video.src = filePathToUrl(clip.filePath)
  video.style.opacity = opacity
  video.onloadedmetadata = () => {
    ensureNaturalClipSize(clip, video)
    applyClipStyle(video, clip.transform || {})
    if (id === 'onion-target-video') syncTransformFields(clip)
    updateTransformBox()
  }
  applyClipStyle(video, clip.transform || {})
  if (id === 'onion-target-video') updateTransformBox()
  video.play().catch(() => {})
}

function syncTransformFields(clip) {
  if (!clip) return
  const t = normalizeTransform(clip.transform)
  document.getElementById('clip-x').value = t.x
  document.getElementById('clip-y').value = t.y
  document.getElementById('clip-width').value = t.width
  document.getElementById('clip-height').value = t.height
  document.getElementById('clip-scale').value = t.scale
  document.getElementById('clip-rotation').value = t.rotation
}

function updateTargetTransformFromFields() {
  const clip = findClip(onionTargetId)
  if (!clip) return
  const previous = normalizeTransform(clip.transform)
  clip.transform = {
    x: parseFloat(document.getElementById('clip-x').value) || 0,
    y: parseFloat(document.getElementById('clip-y').value) || 0,
    width: parseFloat(document.getElementById('clip-width').value) || currentCanvas.width,
    height: parseFloat(document.getElementById('clip-height').value) || currentCanvas.height,
    scale: parseFloat(document.getElementById('clip-scale').value) || 1,
    rotation: parseFloat(document.getElementById('clip-rotation').value) || 0,
    anchor: previous.anchor
  }
  setupOnionVideo('onion-target-video', clip, parseFloat(document.getElementById('onion-opacity').value))
  updateTransformBox()
  saveProject()
}

function bindOnionEvents() {
  document.getElementById('onion-reference').addEventListener('change', loadOnionVideos)
  document.getElementById('onion-target').addEventListener('change', loadOnionVideos)
  document.getElementById('onion-zoom').addEventListener('input', (event) => {
    onionCameraZoom = parseFloat(event.target.value)
    updateOnionCamera()
  })
  document.getElementById('onion-fit').addEventListener('click', fitOnionCamera)
  document.getElementById('onion-align-anchor').addEventListener('click', alignTargetAnchorToReference)
  document.getElementById('onion-opacity').addEventListener('input', (event) => {
    document.getElementById('onion-target-video').style.opacity = event.target.value
  })
  ;['clip-x', 'clip-y', 'clip-width', 'clip-height', 'clip-scale', 'clip-rotation'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateTargetTransformFromFields)
  })
  const targetVideo = document.getElementById('onion-target-video')
  targetVideo.addEventListener('pointerdown', (event) => {
    const clip = findClip(onionTargetId)
    if (!clip) return
    const t = normalizeTransform(clip.transform)
    onionDrag = { startX: event.clientX, startY: event.clientY, x: t.x, y: t.y }
    targetVideo.setPointerCapture(event.pointerId)
  })
  targetVideo.addEventListener('pointermove', (event) => {
    if (!onionDrag) return
    const clip = findClip(onionTargetId)
    if (!clip) return
    clip.transform = normalizeTransform(clip.transform)
    clip.transform.x = onionDrag.x + (event.clientX - onionDrag.startX) / onionCameraZoom
    clip.transform.y = onionDrag.y + (event.clientY - onionDrag.startY) / onionCameraZoom
    syncTransformFields(clip)
    setupOnionVideo('onion-target-video', clip, parseFloat(document.getElementById('onion-opacity').value))
    updateTransformBox()
  })
  targetVideo.addEventListener('pointerup', (event) => {
    onionDrag = null
    try { targetVideo.releasePointerCapture(event.pointerId) } catch (err) {}
    saveProject()
  })
  document.querySelectorAll('[data-resize]').forEach(handle => {
    handle.addEventListener('pointerdown', (event) => {
      const clip = findClip(onionTargetId)
      if (!clip) return
      event.stopPropagation()
      const t = normalizeTransform(clip.transform)
      onionResize = {
        corner: handle.dataset.resize,
        startX: event.clientX,
        startY: event.clientY,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        ratio: t.width / t.height
      }
      handle.setPointerCapture(event.pointerId)
    })
    handle.addEventListener('pointermove', (event) => {
      if (!onionResize) return
      const clip = findClip(onionTargetId)
      if (!clip) return
      const dx = (event.clientX - onionResize.startX) / onionCameraZoom
      const dy = (event.clientY - onionResize.startY) / onionCameraZoom
      const directionX = onionResize.corner.includes('w') ? -1 : 1
      const directionY = onionResize.corner.includes('n') ? -1 : 1
      let width = Math.max(20, onionResize.width + dx * directionX)
      let height = Math.max(20, width / onionResize.ratio)
      if (event.shiftKey) {
        height = Math.max(20, onionResize.height + dy * directionY)
        width = height * onionResize.ratio
      }
      clip.transform = normalizeTransform(clip.transform)
      if (onionResize.corner.includes('w')) clip.transform.x = onionResize.x + (onionResize.width - width)
      if (onionResize.corner.includes('n')) clip.transform.y = onionResize.y + (onionResize.height - height)
      clip.transform.width = width
      clip.transform.height = height
      clip.transform.anchor = scaleAnchor(clip.transform.anchor, onionResize.width, onionResize.height, width, height)
      syncTransformFields(clip)
      setupOnionVideo('onion-target-video', clip, parseFloat(document.getElementById('onion-opacity').value))
      updateTransformBox()
    })
    handle.addEventListener('pointerup', (event) => {
      onionResize = null
      try { handle.releasePointerCapture(event.pointerId) } catch (err) {}
      saveProject()
    })
  })
  const anchorHandle = document.getElementById('anchor-handle')
  anchorHandle.addEventListener('pointerdown', (event) => {
    const clip = findClip(onionTargetId)
    if (!clip) return
    event.stopPropagation()
    const t = normalizeTransform(clip.transform)
    onionAnchorDrag = {
      startX: event.clientX,
      startY: event.clientY,
      anchorX: t.anchor.x,
      anchorY: t.anchor.y
    }
    anchorHandle.setPointerCapture(event.pointerId)
  })
  anchorHandle.addEventListener('pointermove', (event) => {
    if (!onionAnchorDrag) return
    const clip = findClip(onionTargetId)
    if (!clip) return
    const t = normalizeTransform(clip.transform)
    const anchorX = onionAnchorDrag.anchorX + (event.clientX - onionAnchorDrag.startX) / onionCameraZoom
    const anchorY = onionAnchorDrag.anchorY + (event.clientY - onionAnchorDrag.startY) / onionCameraZoom
    clip.transform = {
      ...t,
      anchor: {
        x: Math.max(0, Math.min(t.width, anchorX)),
        y: Math.max(0, Math.min(t.height, anchorY))
      }
    }
    updateTransformBox()
    setupOnionVideo('onion-target-video', clip, parseFloat(document.getElementById('onion-opacity').value))
  })
  anchorHandle.addEventListener('pointerup', (event) => {
    onionAnchorDrag = null
    try { anchorHandle.releasePointerCapture(event.pointerId) } catch (err) {}
    saveProject()
  })
}

function updateOnionCamera() {
  const camera = document.getElementById('onion-camera')
  const zoomInput = document.getElementById('onion-zoom')
  if (!camera) return
  camera.style.width = `${currentCanvas.width}px`
  camera.style.height = `${currentCanvas.height}px`
  camera.style.transform = `scale(${onionCameraZoom})`
  camera.style.marginRight = `${Math.max(currentCanvas.width * onionCameraZoom - currentCanvas.width, 0)}px`
  camera.style.marginBottom = `${Math.max(currentCanvas.height * onionCameraZoom - currentCanvas.height, 0)}px`
  if (zoomInput) zoomInput.value = onionCameraZoom
  updateTransformBox()
}

function fitOnionCamera() {
  const stage = document.getElementById('onion-stage')
  if (!stage) return
  const padding = 24
  const zoomX = (stage.clientWidth - padding) / currentCanvas.width
  const zoomY = (stage.clientHeight - padding) / currentCanvas.height
  onionCameraZoom = Math.max(0.1, Math.min(2, zoomX, zoomY))
  updateOnionCamera()
}

function updateTransformBox() {
  const box = document.getElementById('onion-transform-box')
  const clip = findClip(onionTargetId)
  if (!box || !clip) {
    if (box) box.classList.add('hidden')
    return
  }
  const t = normalizeTransform(clip.transform)
  box.classList.remove('hidden')
  box.style.left = `${t.x}px`
  box.style.top = `${t.y}px`
  box.style.width = `${t.width}px`
  box.style.height = `${t.height}px`
  box.style.transform = `scale(${t.scale}) rotate(${t.rotation}deg)`
  const anchor = t.anchor || { x: t.width / 2, y: t.height / 2 }
  const anchorHandle = document.getElementById('anchor-handle')
  anchorHandle.style.left = `${anchor.x}px`
  anchorHandle.style.top = `${anchor.y}px`
}

function alignTargetAnchorToReference() {
  const reference = findClip(document.getElementById('onion-reference').value)
  const target = findClip(onionTargetId)
  if (!reference || !target || reference.id === target.id) return
  const referenceTransform = normalizeTransform(reference.transform)
  const targetTransform = normalizeTransform(target.transform)
  target.transform = {
    ...targetTransform,
    x: referenceTransform.x + referenceTransform.anchor.x - targetTransform.anchor.x,
    y: referenceTransform.y + referenceTransform.anchor.y - targetTransform.anchor.y
  }
  syncTransformFields(target)
  setupOnionVideo('onion-target-video', target, parseFloat(document.getElementById('onion-opacity').value))
  updateTransformBox()
  saveProject()
}

function scaleAnchor(anchor, oldWidth, oldHeight, newWidth, newHeight) {
  const baseAnchor = anchor || { x: oldWidth / 2, y: oldHeight / 2 }
  return {
    x: baseAnchor.x * newWidth / oldWidth,
    y: baseAnchor.y * newHeight / oldHeight
  }
}

function openCanvasDialog() {
  document.getElementById('canvas-modal').classList.remove('hidden')
  document.getElementById('canvas-presets').innerHTML = CANVAS_PRESETS.map((preset, index) => (
    `<button class="btn btn-secondary" data-canvas-preset="${index}">${preset.label}</button>`
  )).join('')
  document.querySelectorAll('[data-canvas-preset]').forEach(button => {
    button.addEventListener('click', () => startEditor(CANVAS_PRESETS[Number(button.dataset.canvasPreset)]))
  })
}

function closeCanvasDialog() {
  document.getElementById('canvas-modal').classList.add('hidden')
}

async function startEditor(canvas) {
  currentCanvas = { width: canvas.width, height: canvas.height }
  projectConfig.lastCanvas = currentCanvas
  await saveProject()
  closeCanvasDialog()
  showView('editor')
  setupEditorPreview()
}

function setupEditorPreview() {
  const stage = document.getElementById('editor-preview-stage')
  const maxH = Math.max(window.innerHeight - 160, 360)
  const scale = Math.min(720 / currentCanvas.width, maxH / currentCanvas.height, 1)
  stage.style.width = `${Math.round(currentCanvas.width * scale)}px`
  stage.style.height = `${Math.round(currentCanvas.height * scale)}px`
  document.getElementById('canvas-label').textContent = `${currentCanvas.width} x ${currentCanvas.height}`
  videoClips = new VideoClipController(stage)
  videoClips.setCanvasSize(currentCanvas.width, currentCanvas.height)
  videoClips.setRenderScale(scale)
  videoClips.setCenterOnCanvas(true)
  videoClips.setCharacter(getCharacter())
}

function bindEditorEvents() {
  document.getElementById('btn-mic').addEventListener('click', startMic)
  document.getElementById('btn-audio-file').addEventListener('click', startAudioFile)
  document.getElementById('btn-stop').addEventListener('click', stopAudio)
  document.getElementById('manual-idle').addEventListener('click', () => videoClips?.playIdle())
  document.getElementById('manual-speaking').addEventListener('click', () => videoClips?.playSpeakingManual())
  document.getElementById('manual-action').addEventListener('click', () => videoClips?.playActionManual())
  document.getElementById('manual-replay').addEventListener('click', () => videoClips?.replayCurrent())
  document.getElementById('silence-threshold').addEventListener('input', (event) => {
    stateMachine.setConfig({ silenceThreshold: parseInt(event.target.value, 10) / 1000 })
  })
  document.getElementById('silence-delay').addEventListener('input', (event) => {
    stateMachine.setConfig({ silenceDelayMs: parseInt(event.target.value, 10) })
  })
}

async function startMic() {
  const hasPermission = await window.electronAPI.requestMicrophoneAccess()
  if (!hasPermission) {
    alert('麦克风权限未开启，请在系统设置中允许本应用访问麦克风')
    return
  }
  await analyzer.startMicrophone()
  setAudioRunning(true)
}

async function startAudioFile() {
  const filePath = await window.electronAPI.openAudioFile()
  if (!filePath) return
  setAudioRunning(true)
  analyzer.startAudioFile(filePath).finally(() => {
    stateMachine.reset()
    videoClips?.playIdle()
    setAudioRunning(false)
  })
}

function stopAudio() {
  analyzer.stop()
  stateMachine.reset()
  videoClips?.playIdle()
  setAudioRunning(false)
}

function setAudioRunning(running) {
  isAudioRunning = running
  document.getElementById('btn-stop').disabled = !running
  document.getElementById('btn-mic').disabled = running
  document.getElementById('btn-audio-file').disabled = running
}

function updateStatusBadge(state) {
  const badge = document.getElementById('status-badge')
  if (!badge) return
  badge.textContent = state === STATE.SPEAKING ? 'speaking' : 'idle'
  badge.className = `status-badge ${state}`
}

function applyClipStyle(element, transform) {
  const t = normalizeTransform(transform)
  element.style.left = `${t.x}px`
  element.style.top = `${t.y}px`
  element.style.width = `${t.width}px`
  element.style.height = `${t.height}px`
  element.style.transformOrigin = `${t.anchor.x}px ${t.anchor.y}px`
  element.style.transform = `scale(${t.scale}) rotate(${t.rotation}deg)`
}

function normalizeTransform(transform = {}) {
  const width = transform.width || transform.naturalWidth || currentCanvas.width
  const height = transform.height || transform.naturalHeight || currentCanvas.height
  return {
    x: transform.x ?? 0,
    y: transform.y ?? 0,
    width,
    height,
    scale: transform.scale ?? 1,
    rotation: transform.rotation ?? 0,
    anchor: transform.anchor || { x: width / 2, y: height / 2 }
  }
}

function ensureNaturalClipSize(clip, video) {
  if (!clip || !video.videoWidth || !video.videoHeight) return
  clip.transform ||= {}
  if (!clip.transform.naturalWidth || !clip.transform.naturalHeight) {
    clip.transform.naturalWidth = video.videoWidth
    clip.transform.naturalHeight = video.videoHeight
  }
  if (!clip.transform.width || !clip.transform.height || clip.transform.width === currentCanvas.width && clip.transform.height === currentCanvas.height) {
    clip.transform.width = video.videoWidth
    clip.transform.height = video.videoHeight
    saveProject()
  }
}

function filePathToUrl(filePath) {
  const normalized = filePath.replace(/\\/g, '/')
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///'
  const encodedPath = normalized
    .split('/')
    .map((segment, index) => {
      if (index === 0 && /^[A-Za-z]:$/.test(segment)) return segment
      return encodeURIComponent(segment)
    })
    .join('/')
  return `${prefix}${encodedPath}`
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
