/**
 * AnimationPlayer.js
 * 序列帧动画播放器
 * 支持：
 *   - 按 fps 播放帧序列
 *   - loop / once 模式
 *   - 播放完成回调
 */
export class AnimationPlayer {
  /**
   * @param {object} options
   * @param {PIXI.Sprite} options.sprite    - PixiJS Sprite 对象
   * @param {string[]}    options.frames    - 纹理 key 数组（已加载到 PIXI.Loader）
   * @param {number}      options.fps       - 播放帧率
   * @param {boolean}     options.loop      - 是否循环
   * @param {function}    options.onEnd     - 播放完成回调（loop=false 时触发）
   */
  constructor({ sprite, frames = [], fps = 24, loop = false, onEnd = null, textureCache = null }) {
    this.sprite = sprite
    this.frames = frames
    this.fps = fps
    this.loop = loop
    this.onEnd = onEnd
    this.textureCache = textureCache  // PixiJS v7: 外部传入纹理缓存

    this._currentFrame = 0
    this._elapsed = 0
    this._playing = false
    this._frameInterval = 1000 / fps
  }

  play() {
    this._currentFrame = 0
    this._elapsed = 0
    this._playing = true
    this._applyFrame()
  }

  stop() {
    this._playing = false
  }

  isPlaying() {
    return this._playing
  }

  /**
   * 主循环中每帧调用
   * @param {number} deltaMs - 距上帧毫秒数
   */
  tick(deltaMs) {
    if (!this._playing || this.frames.length === 0) return

    this._elapsed += deltaMs
    if (this._elapsed >= this._frameInterval) {
      this._elapsed -= this._frameInterval
      this._currentFrame++

      if (this._currentFrame >= this.frames.length) {
        if (this.loop) {
          this._currentFrame = 0
        } else {
          this._currentFrame = this.frames.length - 1
          this._playing = false
          if (this.onEnd) this.onEnd()
          return
        }
      }
      this._applyFrame()
    }
  }

  _applyFrame() {
    if (this.frames.length === 0) return
    const key = this.frames[this._currentFrame]
    const texture = this.textureCache
      ? this.textureCache[key]
      : (PIXI.utils?.TextureCache?.[key])
    if (texture && this.sprite) {
      this.sprite.texture = texture
    }
  }
}
