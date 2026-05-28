/**
 * CharacterController.js
 * 角色控制器：管理 PixiJS 渲染 + 状态驱动
 *
 * 职责：
 *   - 加载角色配置与纹理
 *   - 根据状态机指令切换口型帧
 *   - 调度 IDLE 随机待机动画
 */
import { AnimationPlayer } from './AnimationPlayer.js'
import { STATE } from './StateMachine.js'

export class CharacterController {
  /**
   * @param {HTMLElement} container - 渲染容器 DOM 元素
   */
  constructor(container) {
    this.container = container
    this.app = null
    this.sprite = null
    this.config = null
    this._idleTimer = null
    this._currentPlayer = null
    this._currentState = STATE.IDLE
    this._mouthTextures = {}
    this._idleAnimations = []
    this._idleInterval = 4000 // ms，随机待机动画触发间隔
    this._isLoaded = false
  }

  /**
   * 从配置 JSON 初始化角色
   * @param {object} config - 角色配置对象（见 assets/config.json）
   * @param {string} baseDir - 配置文件所在目录，用于解析相对路径
   */
  async init(config, baseDir) {
    this.config = config
    this._isLoaded = false

    // 销毁旧实例
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true })
      this.app = null
    }

    // 隐藏占位符
    document.getElementById('placeholder').style.display = 'none'

    // 初始化 PixiJS
    const charW = config.character.width || 600
    const charH = config.character.height || 700

    this.app = new PIXI.Application({
      width: charW,
      height: charH,
      backgroundColor: config.character.backgroundColor || 0x0d1117,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true
    })
    this.container.appendChild(this.app.view)

    // 构建需要加载的纹理列表（PixiJS v7 使用 PIXI.Assets）
    const resolvePath = (p) => `file://${baseDir}/${p}`

    const assetList = []

    // 口型帧
    const mouthStates = config.mouth.states
    for (const [key, path] of Object.entries(mouthStates)) {
      assetList.push({ alias: `mouth_${key}`, src: resolvePath(path) })
    }

    // IDLE 动画帧
    config.idle.forEach((anim, ai) => {
      anim.frames.forEach((framePath, fi) => {
        assetList.push({ alias: `idle_${ai}_${fi}`, src: resolvePath(framePath) })
      })
    })

    // 注册并加载所有资源
    for (const asset of assetList) {
      PIXI.Assets.add(asset)
    }
    const textures = await PIXI.Assets.load(assetList.map(a => a.alias))

    // 缓存口型纹理
    this._mouthTextures = {}
    for (const key of Object.keys(mouthStates)) {
      this._mouthTextures[key] = textures[`mouth_${key}`]
    }

    // 保存全局纹理缓存供 AnimationPlayer 使用
    this._textureCache = textures

    // 构建 IDLE 动画 player 配置
    this._idleAnimations = config.idle.map((anim, ai) => ({
      name: anim.name,
      fps: anim.fps || 24,
      weight: anim.weight || 1,
      frameKeys: anim.frames.map((_, fi) => `idle_${ai}_${fi}`),
      textureCache: this._textureCache
    }))

    // 创建 Sprite，默认显示闭口帧
    const initTexture = this._mouthTextures['closed'] || Object.values(this._mouthTextures)[0]
    this.sprite = new PIXI.Sprite(initTexture)
    this.sprite.width = charW
    this.sprite.height = charH
    this.app.stage.addChild(this.sprite)

    // 更新口型阈值到状态机（如果 config 有自定义）
    if (config.mouth.thresholds) {
      this._mouthThresholds = config.mouth.thresholds
    }

    this._isLoaded = true
    this._startIdleScheduler()

    return {
      mouthThresholds: config.mouth.thresholds || null
    }
  }

  /**
   * 状态机回调：状态改变
   */
  onStateChange(newState, oldState) {
    this._currentState = newState
    if (newState === STATE.IDLE) {
      // 切换到 IDLE：停止当前动画，显示闭口
      if (this._currentPlayer) {
        this._currentPlayer.stop()
        this._currentPlayer = null
      }
      this._showMouth('closed')
      this._startIdleScheduler()
    } else if (newState === STATE.SPEAKING) {
      // 切换到 SPEAKING：停止 IDLE 动画
      this._stopIdleScheduler()
      if (this._currentPlayer) {
        this._currentPlayer.stop()
        this._currentPlayer = null
      }
    }
  }

  /**
   * 状态机回调：口型改变（SPEAKING 时）
   */
  onMouthChange(mouthState) {
    if (this._currentState !== STATE.SPEAKING) return
    this._showMouth(mouthState)
  }

  /**
   * 设置待机动画间隔
   */
  setIdleInterval(ms) {
    this._idleInterval = ms
    if (this._currentState === STATE.IDLE) {
      this._startIdleScheduler()
    }
  }

  /**
   * PixiJS 主循环 tick（在 app.ticker 中调用）
   */
  tick(deltaMs) {
    if (this._currentPlayer) {
      this._currentPlayer.tick(deltaMs)
    }
  }

  destroy() {
    this._stopIdleScheduler()
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true })
      this.app = null
    }
    this._isLoaded = false
  }

  // ---- 内部方法 ----

  _showMouth(state) {
    if (!this.sprite || !this._mouthTextures[state]) return
    this.sprite.texture = this._mouthTextures[state]
  }

  _startIdleScheduler() {
    this._stopIdleScheduler()
    if (!this._isLoaded || this._idleAnimations.length === 0) return
    this._scheduleNextIdle()
  }

  _scheduleNextIdle() {
    // 随机间隔：[interval * 0.5, interval * 1.5]
    const jitter = this._idleInterval * 0.5
    const delay = this._idleInterval - jitter + Math.random() * jitter * 2

    this._idleTimer = setTimeout(() => {
      if (this._currentState !== STATE.IDLE) return
      this._playRandomIdle()
    }, delay)
  }

  _playRandomIdle() {
    if (!this._isLoaded || this._currentState !== STATE.IDLE) return

    const anim = this._weightedRandom(this._idleAnimations)
    if (!anim) return

    // 更新当前动作显示
    const actionEl = document.getElementById('current-action')
    if (actionEl) actionEl.innerHTML = `动作: <span>${anim.name}</span>`

    this._currentPlayer = new AnimationPlayer({
      sprite: this.sprite,
      frames: anim.frameKeys,
      fps: anim.fps,
      loop: false,
      textureCache: anim.textureCache,
      onEnd: () => {
        this._currentPlayer = null
        this._showMouth('closed')
        const actionEl = document.getElementById('current-action')
        if (actionEl) actionEl.innerHTML = `待机中`
        // 动画结束后再安排下一个
        if (this._currentState === STATE.IDLE) {
          this._scheduleNextIdle()
        }
      }
    })
    this._currentPlayer.play()
  }

  _stopIdleScheduler() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer)
      this._idleTimer = null
    }
  }

  /**
   * 按权重随机选择动画
   */
  _weightedRandom(anims) {
    if (!anims || anims.length === 0) return null
    const totalWeight = anims.reduce((s, a) => s + a.weight, 0)
    let rand = Math.random() * totalWeight
    for (const anim of anims) {
      rand -= anim.weight
      if (rand <= 0) return anim
    }
    return anims[anims.length - 1]
  }
}
