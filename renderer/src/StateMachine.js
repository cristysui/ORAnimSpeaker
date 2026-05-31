/**
 * StateMachine.js
 * 角色状态机：IDLE ↔ SPEAKING
 *
 * States:
 *   IDLE     - 静止，随机播放待机动画
 *   SPEAKING - 说话中，口型跟随音量
 */
export const STATE = {
  IDLE: 'idle',
  SPEAKING: 'speaking'
}

export class StateMachine {
  /**
   * @param {object} options
   * @param {number} options.silenceThreshold  - 判定为静默的 RMS 阈值（0~1）
   * @param {number} options.silenceDelayMs    - 持续静默多少 ms 才切换到 IDLE
   * @param {function} options.onStateChange   - (newState, oldState) => void
   * @param {function} options.onMouthChange   - (mouthState: string) => void
   */
  constructor({
    silenceThreshold = 0.03,
    silenceDelayMs = 300,
    mouthHoldMs = 70,
    rmsAttack = 0.45,
    rmsRelease = 0.18,
    hysteresisRatio = 0.82,
    onStateChange = null,
    onMouthChange = null
  } = {}) {
    this.silenceThreshold = silenceThreshold
    this.silenceDelayMs = silenceDelayMs
    this.mouthHoldMs = mouthHoldMs
    this.rmsAttack = rmsAttack
    this.rmsRelease = rmsRelease
    this.hysteresisRatio = hysteresisRatio
    this._onStateChange = onStateChange
    this._onMouthChange = onMouthChange

    this.currentState = STATE.IDLE
    this._silenceTimer = null
    this._currentMouth = 'closed'
    this._smoothedRms = 0
    this._lastMouthChangeAt = 0

    // 口型档位阈值（对应标准5档）
    this.mouthThresholds = {
      small:  0.02,
      medium: 0.08,
      large:  0.18,
      xlarge: 0.35
    }
  }

  /**
   * 外部调用：更新音量（每帧调用）
   * @param {number} rms - 0~1
   */
  update(rms) {
    const smoothedRms = this._smoothRms(rms)

    if (smoothedRms > this.silenceThreshold) {
      // 有声音
      this._clearSilenceTimer()
      if (this.currentState !== STATE.SPEAKING) {
        this._transition(STATE.SPEAKING)
      }
      // 更新口型
      this._updateMouth(smoothedRms)
    } else {
      // 静默：延迟切换到 IDLE
      if (this.currentState === STATE.SPEAKING && !this._silenceTimer) {
        this._silenceTimer = setTimeout(() => {
          this._transition(STATE.IDLE)
          this._currentMouth = 'closed'
          if (this._onMouthChange) this._onMouthChange('closed')
          this._silenceTimer = null
        }, this.silenceDelayMs)
      }
    }
  }

  /**
   * 更新配置参数（UI滑块实时调节）
   */
  setConfig({ silenceThreshold, silenceDelayMs, mouthHoldMs }) {
    if (silenceThreshold !== undefined) this.silenceThreshold = silenceThreshold
    if (silenceDelayMs !== undefined) this.silenceDelayMs = silenceDelayMs
    if (mouthHoldMs !== undefined) this.mouthHoldMs = mouthHoldMs
  }

  /**
   * 更新口型档位阈值（来自 config.json）
   */
  setMouthThresholds(thresholds) {
    this.mouthThresholds = { ...this.mouthThresholds, ...thresholds }
  }

  /**
   * 停止音频或重新加载时重置内部平滑状态。
   */
  reset() {
    this._clearSilenceTimer()
    const oldState = this.currentState
    this.currentState = STATE.IDLE
    this._currentMouth = 'closed'
    this._smoothedRms = 0
    this._lastMouthChangeAt = 0
    if (oldState !== STATE.IDLE && this._onStateChange) this._onStateChange(STATE.IDLE, oldState)
    if (this._onMouthChange) this._onMouthChange('closed')
  }

  // ---- 内部方法 ----

  _transition(newState) {
    const old = this.currentState
    this.currentState = newState
    if (this._onStateChange) this._onStateChange(newState, old)
  }

  _clearSilenceTimer() {
    if (this._silenceTimer) {
      clearTimeout(this._silenceTimer)
      this._silenceTimer = null
    }
  }

  _smoothRms(rms) {
    const alpha = rms > this._smoothedRms ? this.rmsAttack : this.rmsRelease
    this._smoothedRms = this._smoothedRms + (rms - this._smoothedRms) * alpha
    return this._smoothedRms
  }

  _updateMouth(rms) {
    const now = performance.now()
    const mouth = this._rmsToMouth(rms)
    if (mouth === this._currentMouth) return

    const currentLevel = this._mouthLevel(this._currentMouth)
    const nextLevel = this._mouthLevel(mouth)
    const canChangeFast = nextLevel > currentLevel
    if (!canChangeFast && now - this._lastMouthChangeAt < this.mouthHoldMs) return

    this._currentMouth = mouth
    this._lastMouthChangeAt = now
    if (this._onMouthChange) this._onMouthChange(mouth)
  }

  /**
   * RMS 值 → 口型状态名称
   */
  _rmsToMouth(rms) {
    const t = this.mouthThresholds
    const currentLevel = this._mouthLevel(this._currentMouth)
    if (rms >= this._thresholdForLevel(4, currentLevel)) return 'xlarge'
    if (rms >= this._thresholdForLevel(3, currentLevel)) return 'large'
    if (rms >= this._thresholdForLevel(2, currentLevel)) return 'medium'
    if (rms >= this._thresholdForLevel(1, currentLevel)) return 'small'
    return 'closed'
  }

  _thresholdForLevel(level, currentLevel) {
    const thresholds = [0, this.mouthThresholds.small, this.mouthThresholds.medium, this.mouthThresholds.large, this.mouthThresholds.xlarge]
    const threshold = thresholds[level]
    return currentLevel >= level ? threshold * this.hysteresisRatio : threshold
  }

  _mouthLevel(mouth) {
    const levels = {
      closed: 0,
      small: 1,
      medium: 2,
      large: 3,
      xlarge: 4
    }
    return levels[mouth] ?? 0
  }
}
