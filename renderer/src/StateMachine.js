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
    onStateChange = null,
    onMouthChange = null
  } = {}) {
    this.silenceThreshold = silenceThreshold
    this.silenceDelayMs = silenceDelayMs
    this._onStateChange = onStateChange
    this._onMouthChange = onMouthChange

    this.currentState = STATE.IDLE
    this._silenceTimer = null
    this._currentMouth = 'closed'

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
    if (rms > this.silenceThreshold) {
      // 有声音
      this._clearSilenceTimer()
      if (this.currentState !== STATE.SPEAKING) {
        this._transition(STATE.SPEAKING)
      }
      // 更新口型
      const mouth = this._rmsToMouth(rms)
      if (mouth !== this._currentMouth) {
        this._currentMouth = mouth
        if (this._onMouthChange) this._onMouthChange(mouth)
      }
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
  setConfig({ silenceThreshold, silenceDelayMs }) {
    if (silenceThreshold !== undefined) this.silenceThreshold = silenceThreshold
    if (silenceDelayMs !== undefined) this.silenceDelayMs = silenceDelayMs
  }

  /**
   * 更新口型档位阈值（来自 config.json）
   */
  setMouthThresholds(thresholds) {
    this.mouthThresholds = { ...this.mouthThresholds, ...thresholds }
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

  /**
   * RMS 值 → 口型状态名称
   */
  _rmsToMouth(rms) {
    const t = this.mouthThresholds
    if (rms >= t.xlarge) return 'xlarge'
    if (rms >= t.large)  return 'large'
    if (rms >= t.medium) return 'medium'
    if (rms >= t.small)  return 'small'
    return 'closed'
  }
}
