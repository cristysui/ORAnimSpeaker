/**
 * VideoClipController.js
 * 新手友好的视频片段模式：有声时随机衔接说话视频，无声时循环静止视频。
 */
export class VideoClipController {
  constructor(container) {
    this.container = container
    this.crossfadeMs = 140
    this.frontVideo = this._createVideoElement()
    this.backVideo = this._createVideoElement()
    this.video = this.frontVideo

    this.clips = {
      idle: [],
      speaking: [],
      manualSpeaking: [],
      actions: []
    }
    this.mode = 'idle'
    this.manualMode = null
    this.currentClip = null
    this.enabled = false
    this.isAudioSpeaking = false
    this.canvas = { width: 1080, height: 1920 }
    this.renderScale = 1
    this.centerOnCanvas = false
    this._isTransitioning = false
    this._pendingClip = null
    this._transitionTimer = null

    const handleEnded = (event) => {
      if (event.currentTarget !== this.frontVideo) return
      if (this.manualMode) {
        this.manualMode = null
        this.mode = this.isAudioSpeaking ? 'speaking' : 'idle'
        this._playNextForMode()
        return
      }
      this._playNextForMode()
    }
    this.frontVideo.addEventListener('ended', handleEnded)
    this.backVideo.addEventListener('ended', handleEnded)
  }

  mount() {
    if (!this.frontVideo.parentElement) {
      this.container.appendChild(this.frontVideo)
      this.container.appendChild(this.backVideo)
    }
    this.container.querySelectorAll('canvas').forEach(canvas => {
      canvas.style.display = 'none'
    })
    this.frontVideo.style.display = 'block'
    this.backVideo.style.display = 'block'
    this.enabled = true
    this.playIdle()
  }

  hide() {
    this.enabled = false
    window.clearTimeout(this._transitionTimer)
    this._isTransitioning = false
    this._pendingClip = null
    this.frontVideo.pause()
    this.backVideo.pause()
    this.frontVideo.style.display = 'none'
    this.backVideo.style.display = 'none'
    this.container.querySelectorAll('canvas').forEach(canvas => {
      canvas.style.display = ''
    })
  }

  addClips(type, filePaths) {
    const clipType = type === 'action' ? 'actions' : type
    if (!this.clips[clipType]) return 0
    const clips = filePaths.map((filePath) => ({
      id: this._createClipId(clipType),
      name: this._fileName(filePath),
      url: this._filePathToUrl(filePath),
      filePath,
      transform: this._defaultTransform()
    }))
    this.clips[clipType].push(...clips)
    this.mount()
    return this.clips[clipType].length
  }

  setCanvasSize(width, height) {
    this.canvas = { width, height }
    this._applyClipTransform(this.currentClip)
  }

  setRenderScale(scale) {
    this.renderScale = scale || 1
    this._applyClipTransform(this.currentClip)
  }

  setCenterOnCanvas(enabled) {
    this.centerOnCanvas = Boolean(enabled)
    this._applyClipTransform(this.currentClip)
  }

  setCharacter(character) {
    const clips = character?.clips || {}
    this.clips = {
      idle: (clips.idle || []).map(clip => this._normalizeClip(clip)),
      speaking: (clips.speaking || []).map(clip => this._normalizeClip(clip)),
      manualSpeaking: (clips.manualSpeaking || []).map(clip => this._normalizeClip(clip)),
      actions: (clips.actions || []).map(clip => this._normalizeClip(clip))
    }
    if (this.hasAnyClips()) this.mount()
  }

  getAllClips() {
    return Object.values(this.clips).flat()
  }

  hasAnyClips() {
    return this.getAllClips().length > 0
  }

  getClipCounts() {
    return {
      idle: this.clips.idle.length,
      speaking: this.clips.speaking.length,
      manualSpeaking: this.clips.manualSpeaking.length,
      actions: this.clips.actions.length
    }
  }

  hasRequiredClips() {
    return this.clips.idle.length > 0 && this.clips.speaking.length > 0
  }

  setAudioSpeaking(isSpeaking) {
    this.isAudioSpeaking = isSpeaking
    if (!this.enabled || this.manualMode) return
    const nextMode = isSpeaking ? 'speaking' : 'idle'
    if (nextMode === this.mode && !this.video.paused) return

    this.mode = nextMode
    this._playNextForMode()
  }

  playIdle() {
    this.manualMode = null
    this.mode = 'idle'
    this._playNextForMode()
  }

  playSpeakingManual() {
    this.manualMode = 'manualSpeaking'
    this.mode = this.clips.manualSpeaking.length > 0 ? 'manualSpeaking' : 'speaking'
    this._playNextForMode()
  }

  playActionManual() {
    this.manualMode = 'actions'
    this.mode = 'actions'
    this._playNextForMode()
  }

  playClipById(clipId) {
    const clip = this._findClip(clipId)
    if (!clip) return false
    this.manualMode = clip.type
    this.mode = clip.type
    this._playClip(clip)
    return true
  }

  releaseManualMode() {
    this.manualMode = null
  }

  replayCurrent() {
    if (!this.currentClip) return
    this.frontVideo.currentTime = 0
    this.frontVideo.play().catch(() => {})
  }

  _playNextForMode() {
    const clips = this.clips[this.mode]
    if (!clips || clips.length === 0) {
      if (this.mode !== 'idle' && this.clips.idle.length > 0) {
        this.mode = 'idle'
        this._playNextForMode()
      }
      return
    }

    const clip = this.mode === 'speaking'
      ? this._randomClip(clips)
      : this._nextSequentialClip(clips)
    this._playClip(clip)
  }

  async _playClip(clip) {
    if (!clip) return
    if (this._isTransitioning) {
      this._pendingClip = clip
      return
    }
    const shouldLoop = this.mode === 'idle' && this.clips.idle.length === 1
    await this._prepareVideo(this.backVideo, clip, shouldLoop)
    this._ensureClipNaturalSize(clip, this.backVideo)
    this.currentClip = clip
    this._applyClipTransformTo(this.backVideo, clip)
    await this.backVideo.play().catch(() => {})
    this._crossfadeVideos()
  }

  _applyClipTransform(clip) {
    this._applyClipTransformTo(this.frontVideo, clip)
    this._applyClipTransformTo(this.backVideo, clip)
  }

  _applyClipTransformTo(video, clip) {
    if (!clip) return
    const transform = { ...this._defaultTransform(), ...(clip.transform || {}) }
    const width = transform.width || transform.naturalWidth || video.videoWidth || this.canvas.width
    const height = transform.height || transform.naturalHeight || video.videoHeight || this.canvas.height
    const scale = transform.scale ?? 1
    const anchor = transform.anchor || { x: width / 2, y: height / 2 }
    const position = this._displayPosition(transform, anchor)
    video.style.left = `${position.x * this.renderScale}px`
    video.style.top = `${position.y * this.renderScale}px`
    video.style.width = `${width * this.renderScale}px`
    video.style.height = `${height * this.renderScale}px`
    video.style.transformOrigin = `${(anchor.x || width / 2) * this.renderScale}px ${(anchor.y || height / 2) * this.renderScale}px`
    video.style.transform = `scale(${scale}) rotate(${transform.rotation || 0}deg)`
  }

  _displayPosition(transform, anchor) {
    const x = transform.x || 0
    const y = transform.y || 0
    if (!this.centerOnCanvas) return { x, y }
    return {
      x: this.canvas.width / 2 - anchor.x,
      y: this.canvas.height / 2 - anchor.y
    }
  }

  _ensureClipNaturalSize(clip, video) {
    if (!clip || !video.videoWidth || !video.videoHeight) return
    clip.transform ||= this._defaultTransform()
    if (!clip.transform.naturalWidth || !clip.transform.naturalHeight) {
      clip.transform.naturalWidth = video.videoWidth
      clip.transform.naturalHeight = video.videoHeight
    }
    if (!clip.transform.width || !clip.transform.height) {
      clip.transform.width = video.videoWidth
      clip.transform.height = video.videoHeight
    }
    clip.transform.anchor ||= {
      x: clip.transform.width / 2,
      y: clip.transform.height / 2
    }
  }

  _createVideoElement() {
    const video = document.createElement('video')
    video.className = 'character-video'
    video.playsInline = true
    video.muted = true
    video.loop = false
    video.preload = 'auto'
    video.style.position = 'absolute'
    video.style.opacity = 0
    video.style.transition = `opacity ${this.crossfadeMs}ms ease`
    return video
  }

  _prepareVideo(video, clip, shouldLoop) {
    return new Promise((resolve) => {
      const cleanup = () => {
        video.removeEventListener('loadeddata', onReady)
        video.removeEventListener('canplay', onReady)
        video.removeEventListener('error', onReady)
      }
      const onReady = () => {
        cleanup()
        try { video.currentTime = 0 } catch (err) {}
        resolve()
      }
      if (video.src !== clip.url) {
        video.addEventListener('loadeddata', onReady, { once: true })
        video.addEventListener('canplay', onReady, { once: true })
        video.addEventListener('error', onReady, { once: true })
        video.src = clip.url
        video.load()
      } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        onReady()
      } else {
        video.addEventListener('loadeddata', onReady, { once: true })
        video.addEventListener('canplay', onReady, { once: true })
        video.addEventListener('error', onReady, { once: true })
      }
      video.loop = shouldLoop
    })
  }

  _crossfadeVideos() {
    this._isTransitioning = true
    this.frontVideo.style.zIndex = 1
    this.backVideo.style.zIndex = 2
    this.backVideo.style.opacity = 1
    this.frontVideo.style.opacity = 0
    window.clearTimeout(this._transitionTimer)
    this._transitionTimer = window.setTimeout(() => {
      this.frontVideo.pause()
      const oldFront = this.frontVideo
      this.frontVideo = this.backVideo
      this.backVideo = oldFront
      this.video = this.frontVideo
      this.frontVideo.style.zIndex = 1
      this.backVideo.style.zIndex = 0
      this.backVideo.style.opacity = 0
      this._isTransitioning = false
      if (this._pendingClip) {
        const pendingClip = this._pendingClip
        this._pendingClip = null
        this._playClip(pendingClip)
      }
    }, this.crossfadeMs)
  }

  _normalizeClip(clip) {
    return {
      ...clip,
      id: clip.id || this._createClipId(clip.type || 'clip'),
      type: clip.type || this._inferClipType(clip),
      url: clip.filePath ? this._filePathToUrl(clip.filePath) : clip.url,
      transform: { ...this._defaultTransform(), ...(clip.transform || {}) }
    }
  }

  _findClip(clipId) {
    return this.getAllClips().find(clip => clip.id === clipId)
  }

  _inferClipType(clip) {
    for (const [type, clips] of Object.entries(this.clips)) {
      if (clips.includes(clip)) return type
    }
    return 'actions'
  }

  _defaultTransform() {
    return {
      x: 0,
      y: 0,
      scale: 1,
      width: null,
      height: null,
      rotation: 0,
      anchor: null
    }
  }

  _createClipId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  _randomClip(clips) {
    if (clips.length === 1) return clips[0]
    let clip = clips[Math.floor(Math.random() * clips.length)]
    if (clip === this.currentClip) {
      clip = clips[(clips.indexOf(clip) + 1) % clips.length]
    }
    return clip
  }

  _nextSequentialClip(clips) {
    if (!this.currentClip || !clips.includes(this.currentClip)) return clips[0]
    return clips[(clips.indexOf(this.currentClip) + 1) % clips.length]
  }

  _filePathToUrl(filePath) {
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

  _fileName(filePath) {
    return filePath.replace(/\\/g, '/').split('/').pop()
  }
}
