/**
 * AudioAnalyzer.js
 * 实时音频分析：麦克风输入 / 音频文件输入
 * 输出：RMS 响度（0~1），用于驱动口型状态
 */
export class AudioAnalyzer {
  constructor() {
    this.audioContext = null
    this.analyser = null
    this.source = null
    this._audioElement = null
    this.dataArray = null
    this.isRunning = false
    this._onVolume = null // 回调：(rms: number) => void
    this._finishPlayback = null
  }

  /**
   * 绑定音量回调
   * @param {function} fn - (rms: number) => void
   */
  onVolume(fn) {
    this._onVolume = fn
  }

  /**
   * 启动麦克风输入
   */
  async startMicrophone() {
    await this._initContext()
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    this.source = this.audioContext.createMediaStreamSource(stream)
    this._stream = stream
    this.source.connect(this.analyser)
    this.isRunning = true
    this._startLoop()
  }

  /**
   * 启动音频文件输入（通过 file:// 路径）
   * @param {string} filePath - 本地文件路径
   */
  async startAudioFile(filePath) {
    await this._initContext()

    const audio = new Audio()
    audio.preload = 'auto'
    audio.src = this._filePathToUrl(filePath)
    this._audioElement = audio

    this.source = this.audioContext.createMediaElementSource(audio)
    this.source.connect(this.analyser)
    this.analyser.connect(this.audioContext.destination) // 同时播放

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        audio.removeEventListener('canplay', onCanPlay)
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
        this._finishPlayback = null
      }

      const finish = (err = null) => {
        cleanup()
        this.stop()
        if (err) reject(err)
        else resolve()
      }

      const onCanPlay = async () => {
        try {
          await this.audioContext.resume()
          await audio.play()
          this.isRunning = true
          this._startLoop()
        } catch (err) {
          finish(err)
        }
      }

      const onEnded = () => finish()
      const onError = () => {
        const mediaError = audio.error
        const message = mediaError
          ? `无法播放该音频文件（媒体错误 ${mediaError.code}）`
          : '无法播放该音频文件'
        finish(new Error(message))
      }

      this._finishPlayback = finish
      audio.addEventListener('canplay', onCanPlay, { once: true })
      audio.addEventListener('ended', onEnded, { once: true })
      audio.addEventListener('error', onError, { once: true })
      audio.load()
    })
  }

  /**
   * 停止分析
   */
  stop() {
    this.isRunning = false
    const finishPlayback = this._finishPlayback
    this._finishPlayback = null
    if (finishPlayback) finishPlayback()
    if (this._animFrameId) cancelAnimationFrame(this._animFrameId)
    if (this._audioElement) {
      try {
        this._audioElement.pause()
        this._audioElement.removeAttribute('src')
        this._audioElement.load()
      } catch (e) {}
      this._audioElement = null
    }
    if (this.source) {
      try { this.source.disconnect() } catch (e) {}
      if (this.source.stop) {
        try { this.source.stop() } catch (e) {}
      }
    }
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop())
      this._stream = null
    }
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
  }

  // ---- 内部方法 ----

  async _initContext() {
    if (this.audioContext) this.audioContext.close()
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    this.audioContext = new AudioContextCtor()
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = 512
    this.analyser.smoothingTimeConstant = 0.6 // 适度平滑，响应不迟钝
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount)
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

  _startLoop() {
    const tick = () => {
      if (!this.isRunning) return
      this._animFrameId = requestAnimationFrame(tick)
      this.analyser.getByteTimeDomainData(this.dataArray)
      const rms = this._calcRMS(this.dataArray)
      if (this._onVolume) this._onVolume(rms)
    }
    tick()
  }

  /**
   * 计算 RMS 响度（归一化到 0~1）
   */
  _calcRMS(buffer) {
    let sum = 0
    for (let i = 0; i < buffer.length; i++) {
      const val = (buffer[i] - 128) / 128 // 转换为 -1 ~ 1
      sum += val * val
    }
    return Math.sqrt(sum / buffer.length)
  }
}
