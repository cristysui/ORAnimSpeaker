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
    this._mouthSprite = null
    this.config = null
    this._idleTimer = null
    this._currentPlayer = null
    this._currentState = STATE.IDLE
    this._mouthTextures = {}
    this._layers = new Map()
    this._idleAnimations = []
    this._idleInterval = 4000 // ms，随机待机动画触发间隔
    this._isLoaded = false
    this._pendingMouth = 'closed'
    this._appliedMouth = null
    this._assetScope = 'character'
    this._activeAction = null
    this._actionTargets = []
    this._selectedLayerId = null
    this._selectionFrame = null
    this._mouthBlendSprite = null
    this._mouthTransition = null
    this._mouthTransitionMs = 70
  }

  /**
   * 从配置 JSON 初始化角色
   * @param {object} config - 角色配置对象（见 assets/config.json）
   * @param {string} baseDir - 配置文件所在目录，用于解析相对路径
   */
  async init(config, baseDir) {
    this.config = config
    this._isLoaded = false
    this._stopIdleScheduler()

    // 销毁旧实例
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true })
      this.app = null
    }
    this.container.querySelectorAll('canvas').forEach(canvas => canvas.remove())
    this.sprite = null
    this._mouthSprite = null
    this._layers.clear()
    this._mouthTextures = {}
    this._idleAnimations = []
    this._pendingMouth = 'closed'
    this._appliedMouth = null
    this._assetScope = `character_${Date.now()}_${Math.random().toString(36).slice(2)}`
    this._activeAction = null
    this._actionTargets = []
    this._selectedLayerId = null
    this._selectionFrame = null
    this._mouthBlendSprite = null
    this._mouthTransition = null

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
      autoDensity: true,
      roundPixels: true
    })
    this.app.stage.sortableChildren = true
    this.container.appendChild(this.app.view)
    this._selectionFrame = new PIXI.Graphics()
    this._selectionFrame.zIndex = 9999
    this._selectionFrame.visible = false
    this.app.stage.addChild(this._selectionFrame)

    if (Array.isArray(config.layers) && config.layers.length > 0) {
      await this._initLayeredCharacter(config, baseDir)
    } else {
      await this._initLegacyCharacter(config, baseDir, charW, charH)
    }

    this._isLoaded = true
    this._captureActionTargets()
    this._startIdleScheduler()

    return {
      mouthThresholds: config.mouth?.thresholds || config.mouthThresholds || null
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
      this._queueMouth('closed')
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
    this._queueMouth(mouthState)
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
   * 手动触发一个角色动作。内置动作可用于旧整图配置和新分层配置。
   */
  triggerAction(actionId) {
    if (!this._isLoaded || this._actionTargets.length === 0) return false

    const action = this._getBuiltInAction(actionId)
    if (!action) return false

    if (this._activeAction) this._restoreActionTargets()
    this._activeAction = {
      ...action,
      elapsed: 0
    }
    return true
  }

  getAvailableActions() {
    return [
      { id: 'nod', label: '点头', key: '1', duration: 520 },
      { id: 'shake', label: '摇头', key: '2', duration: 620 },
      { id: 'emphasis', label: '强调', key: '3', duration: 420 }
    ]
  }

  getEditableLayers() {
    return [...this._layers.entries()]
      .filter(([, layer]) => layer.config.editable !== false)
      .map(([id, layer]) => this._serializeLayer(id, layer))
  }

  selectLayer(layerId) {
    if (layerId && !this._layers.has(layerId)) return false
    this._selectedLayerId = layerId || null
    this._drawSelectionFrame()
    return true
  }

  pickLayerAt(x, y) {
    const layers = [...this._layers.entries()]
      .filter(([, layer]) => layer.config.editable !== false && layer.sprite.visible)
      .sort((a, b) => (b[1].sprite.zIndex || 0) - (a[1].sprite.zIndex || 0))

    for (const [id, layer] of layers) {
      if (layer.sprite.getBounds().contains(x, y)) return id
    }
    return null
  }

  updateLayerTransform(layerId, transform) {
    const layer = this._layers.get(layerId)
    if (!layer) return null

    const { sprite, config } = layer
    if (transform.x !== undefined) sprite.x = Number(transform.x)
    if (transform.y !== undefined) sprite.y = Number(transform.y)
    if (transform.rotation !== undefined) sprite.rotation = Number(transform.rotation)
    if (transform.zIndex !== undefined) sprite.zIndex = Number(transform.zIndex)
    if (transform.visible !== undefined) sprite.visible = Boolean(transform.visible)

    if (transform.scale !== undefined) {
      const scale = Number(transform.scale)
      sprite.scale.set(scale)
    }
    if (transform.anchorX !== undefined || transform.anchorY !== undefined) {
      sprite.anchor.set(
        transform.anchorX !== undefined ? Number(transform.anchorX) : sprite.anchor.x,
        transform.anchorY !== undefined ? Number(transform.anchorY) : sprite.anchor.y
      )
    }

    config.x = sprite.x
    config.y = sprite.y
    config.rotation = sprite.rotation
    config.zIndex = sprite.zIndex
    config.visible = sprite.visible
    config.scale = sprite.scale.x === sprite.scale.y
      ? sprite.scale.x
      : { x: sprite.scale.x, y: sprite.scale.y }
    config.anchor = { x: sprite.anchor.x, y: sprite.anchor.y }
    if (config.type === 'mouth' && this._mouthBlendSprite) {
      this._copySpriteTransform(sprite, this._mouthBlendSprite)
      this._mouthBlendSprite.zIndex = (sprite.zIndex || 0) + 0.1
    }

    this._captureActionTargets()
    this._drawSelectionFrame()
    return this._serializeLayer(layerId, layer)
  }

  exportConfig() {
    const config = this._cloneConfig(this.config)
    if (!Array.isArray(config.layers)) return config

    config.layers = config.layers.map(layerConfig => {
      const layer = this._layers.get(layerConfig.id)
      return layer ? { ...layerConfig, ...layer.config } : layerConfig
    })
    return config
  }

  /**
   * PixiJS 主循环 tick（在 app.ticker 中调用）
   */
  tick(deltaMs) {
    this._applyPendingMouth()
    this._tickMouthTransition(deltaMs)
    if (this._currentPlayer) {
      this._currentPlayer.tick(deltaMs)
    }
    this._tickManualAction(deltaMs)
    this._drawSelectionFrame()
  }

  destroy() {
    this._stopIdleScheduler()
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true })
      this.app = null
    }
    this.container.querySelectorAll('canvas').forEach(canvas => canvas.remove())
    this._layers.clear()
    this._activeAction = null
    this._actionTargets = []
    this._selectionFrame = null
    this._mouthBlendSprite = null
    this._mouthTransition = null
    this._isLoaded = false
  }

  // ---- 内部方法 ----

  async _initLegacyCharacter(config, baseDir, charW, charH) {
    // 构建需要加载的纹理列表（PixiJS v7 使用 PIXI.Assets）
    const resolvePath = (p) => this._resolvePath(baseDir, p)

    const assetList = []

    // 口型帧
    const mouthStates = config.mouth.states
    for (const [key, path] of Object.entries(mouthStates)) {
      assetList.push({ alias: this._legacyMouthAlias(key), src: resolvePath(path) })
    }

    // IDLE 动画帧
    config.idle.forEach((anim, ai) => {
      anim.frames.forEach((framePath, fi) => {
        assetList.push({ alias: this._legacyIdleAlias(ai, fi), src: resolvePath(framePath) })
      })
    })

    // 注册并加载所有资源
    for (const asset of assetList) {
      PIXI.Assets.add(asset)
    }
    const textures = await PIXI.Assets.load(assetList.map(a => a.alias))
    this._warmTextures(textures)

    // 缓存口型纹理
    this._mouthTextures = {}
    for (const key of Object.keys(mouthStates)) {
      this._mouthTextures[key] = textures[this._legacyMouthAlias(key)]
    }

    // 保存全局纹理缓存供 AnimationPlayer 使用
    this._textureCache = textures

    // 构建 IDLE 动画 player 配置
    this._idleAnimations = config.idle.map((anim, ai) => ({
      name: anim.name,
      fps: anim.fps || 24,
      weight: anim.weight || 1,
      frameKeys: anim.frames.map((_, fi) => this._legacyIdleAlias(ai, fi)),
      textureCache: this._textureCache
    }))

    // 创建 Sprite，默认显示闭口帧
    const initTexture = this._mouthTextures['closed'] || Object.values(this._mouthTextures)[0]
    this.sprite = new PIXI.Sprite(initTexture)
    this.sprite.roundPixels = true
    this.sprite.anchor.set(0.5, 0.5)
    this.sprite.x = charW / 2
    this.sprite.y = charH / 2
    this.sprite.width = charW
    this.sprite.height = charH
    this._mouthSprite = this.sprite
    this.app.stage.addChild(this.sprite)
  }

  async _initLayeredCharacter(config, baseDir) {
    const assetList = []
    const layers = [...config.layers].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))

    for (const layer of layers) {
      if (layer.type === 'mouth') {
        for (const [state, src] of Object.entries(layer.states || {})) {
          assetList.push({ alias: this._layerStateAlias(layer.id, state), src: this._resolvePath(baseDir, src) })
        }
      } else if (layer.states) {
        for (const [state, src] of Object.entries(layer.states)) {
          assetList.push({ alias: this._layerStateAlias(layer.id, state), src: this._resolvePath(baseDir, src) })
        }
      } else if (layer.src) {
        assetList.push({ alias: this._layerAlias(layer.id), src: this._resolvePath(baseDir, layer.src) })
      }
    }

    for (const asset of assetList) {
      PIXI.Assets.add(asset)
    }
    const textures = await PIXI.Assets.load(assetList.map(a => a.alias))
    this._textureCache = textures
    this._warmTextures(textures)

    for (const layer of layers) {
      const sprite = this._createLayerSprite(layer, textures)
      if (!sprite) continue

      this._layers.set(layer.id, { config: layer, sprite })
      this.app.stage.addChild(sprite)

      if (layer.type === 'mouth') {
        this._mouthSprite = sprite
        this.sprite = sprite
        this._mouthTextures = {}
        for (const state of Object.keys(layer.states || {})) {
          this._mouthTextures[state] = textures[this._layerStateAlias(layer.id, state)]
        }
        this._mouthBlendSprite = this._createLayerSprite(layer, textures)
        if (this._mouthBlendSprite) {
          this._mouthBlendSprite.visible = false
          this._mouthBlendSprite.alpha = 0
          this._mouthBlendSprite.zIndex = (sprite.zIndex || 0) + 0.1
          this.app.stage.addChild(this._mouthBlendSprite)
        }
      }
    }
  }

  _createLayerSprite(layer, textures) {
    const initialState = layer.defaultState || (layer.type === 'mouth' ? 'closed' : null)
    const texture = initialState && layer.states
      ? textures[this._layerStateAlias(layer.id, initialState)]
      : textures[this._layerAlias(layer.id)]

    if (!texture) return null

    const sprite = new PIXI.Sprite(texture)
    sprite.roundPixels = true
    sprite.x = layer.x || 0
    sprite.y = layer.y || 0
    sprite.rotation = layer.rotation || 0
    sprite.zIndex = layer.zIndex || 0
    sprite.visible = layer.visible !== false

    const anchor = layer.anchor || { x: 0, y: 0 }
    sprite.anchor.set(anchor.x || 0, anchor.y || 0)

    if (typeof layer.scale === 'number') {
      sprite.scale.set(layer.scale)
    } else if (layer.scale) {
      sprite.scale.set(layer.scale.x ?? 1, layer.scale.y ?? 1)
    }

    if (layer.width) sprite.width = layer.width
    if (layer.height) sprite.height = layer.height

    return sprite
  }

  _serializeLayer(id, layer) {
    const { sprite, config } = layer
    return {
      id,
      label: config.label || id,
      type: config.type || 'image',
      x: Number(sprite.x.toFixed(2)),
      y: Number(sprite.y.toFixed(2)),
      scale: Number(sprite.scale.x.toFixed(3)),
      rotation: Number(sprite.rotation.toFixed(3)),
      rotationDeg: Number((sprite.rotation * 180 / Math.PI).toFixed(1)),
      anchorX: Number(sprite.anchor.x.toFixed(3)),
      anchorY: Number(sprite.anchor.y.toFixed(3)),
      zIndex: sprite.zIndex || 0,
      visible: sprite.visible,
      editable: config.editable !== false,
      selected: id === this._selectedLayerId
    }
  }

  _drawSelectionFrame() {
    if (!this._selectionFrame) return
    this._selectionFrame.clear()
    const layer = this._selectedLayerId ? this._layers.get(this._selectedLayerId) : null
    if (!layer || !layer.sprite.visible) {
      this._selectionFrame.visible = false
      return
    }

    const bounds = layer.sprite.getBounds()
    this._selectionFrame.visible = true
    this._selectionFrame.lineStyle(2, 0x60a5fa, 1)
    this._selectionFrame.drawRect(bounds.x, bounds.y, bounds.width, bounds.height)
    this._selectionFrame.beginFill(0x60a5fa, 1)
    this._selectionFrame.drawCircle(layer.sprite.x, layer.sprite.y, 4)
    this._selectionFrame.endFill()
  }

  _queueMouth(state) {
    this._pendingMouth = state
  }

  _applyPendingMouth() {
    if (this._pendingMouth === this._appliedMouth) return
    this._showMouth(this._pendingMouth)
  }

  _showMouth(state) {
    if (!this._mouthSprite || !this._mouthTextures[state]) return
    if (this._mouthBlendSprite && this._appliedMouth && state !== this._appliedMouth) {
      this._copySpriteTransform(this._mouthSprite, this._mouthBlendSprite)
      this._mouthBlendSprite.texture = this._mouthTextures[state]
      this._mouthBlendSprite.visible = true
      this._mouthBlendSprite.alpha = 0
      this._mouthSprite.alpha = 1
      this._mouthTransition = {
        state,
        elapsed: 0,
        duration: this._mouthTransitionMs
      }
      return
    }

    this._mouthSprite.texture = this._mouthTextures[state]
    this._mouthSprite.alpha = 1
    if (this._mouthBlendSprite) {
      this._mouthBlendSprite.visible = false
      this._mouthBlendSprite.alpha = 0
    }
    this._appliedMouth = state
  }

  _tickMouthTransition(deltaMs) {
    if (!this._mouthTransition || !this._mouthBlendSprite || !this._mouthSprite) return

    this._copySpriteTransform(this._mouthSprite, this._mouthBlendSprite)
    const transition = this._mouthTransition
    transition.elapsed += deltaMs
    const progress = Math.min(transition.elapsed / transition.duration, 1)
    this._mouthSprite.alpha = 1 - progress
    this._mouthBlendSprite.alpha = progress

    if (progress >= 1) {
      this._mouthSprite.texture = this._mouthBlendSprite.texture
      this._mouthSprite.alpha = 1
      this._mouthBlendSprite.visible = false
      this._mouthBlendSprite.alpha = 0
      this._appliedMouth = transition.state
      this._mouthTransition = null
    }
  }

  _captureActionTargets() {
    const preferredLayer = this._layers.get('head')
    const sprites = preferredLayer
      ? [preferredLayer.sprite]
      : (this._layers.size > 0 ? [...this._layers.values()].map(layer => layer.sprite) : [this.sprite])

    this._actionTargets = sprites.filter(Boolean).map(sprite => ({
      sprite,
      x: sprite.x,
      y: sprite.y,
      scaleX: sprite.scale.x,
      scaleY: sprite.scale.y,
      rotation: sprite.rotation
    }))
  }

  _tickManualAction(deltaMs) {
    if (!this._activeAction) return

    this._activeAction.elapsed += deltaMs
    const progress = Math.min(this._activeAction.elapsed / this._activeAction.duration, 1)
    const eased = this._easeInOutSine(progress)

    for (const target of this._actionTargets) {
      this._applyActionPose(target, this._activeAction.id, eased)
    }

    if (progress >= 1) {
      this._restoreActionTargets()
      this._activeAction = null
    }
  }

  _applyActionPose(target, actionId, progress) {
    const sprite = target.sprite
    if (!sprite) return

    if (actionId === 'nod') {
      const wave = Math.sin(progress * Math.PI)
      sprite.y = target.y + wave * 10
      sprite.rotation = target.rotation + wave * 0.035
    } else if (actionId === 'shake') {
      const wave = Math.sin(progress * Math.PI * 4)
      sprite.x = target.x + wave * 8
      sprite.rotation = target.rotation + wave * 0.025
    } else if (actionId === 'emphasis') {
      const wave = Math.sin(progress * Math.PI)
      const scale = 1 + wave * 0.04
      sprite.y = target.y - wave * 10
      sprite.scale.set(target.scaleX * scale, target.scaleY * scale)
    }
  }

  _restoreActionTargets() {
    for (const target of this._actionTargets) {
      const sprite = target.sprite
      if (!sprite) continue
      sprite.x = target.x
      sprite.y = target.y
      sprite.scale.set(target.scaleX, target.scaleY)
      sprite.rotation = target.rotation
    }
  }

  _copySpriteTransform(from, to) {
    to.x = from.x
    to.y = from.y
    to.scale.set(from.scale.x, from.scale.y)
    to.rotation = from.rotation
    to.anchor.set(from.anchor.x, from.anchor.y)
    to.width = from.width
    to.height = from.height
  }

  _getBuiltInAction(actionId) {
    const actions = {
      nod: { id: 'nod', duration: 520 },
      shake: { id: 'shake', duration: 620 },
      emphasis: { id: 'emphasis', duration: 420 }
    }
    return actions[actionId] || null
  }

  _easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) / 2
  }

  _cloneConfig(config) {
    return JSON.parse(JSON.stringify(config))
  }

  _resolvePath(baseDir, relativePath) {
    const path = `${baseDir}/${relativePath}`.replace(/\\/g, '/')
    const encodedPath = path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    return `file://${encodedPath}`
  }

  _warmTextures(textures) {
    const textureList = Object.values(textures).filter(Boolean)
    if (this.app?.renderer?.prepare && textureList.length > 0) {
      this.app.renderer.prepare.upload(textureList)
    }
  }

  _layerAlias(layerId) {
    return `${this._assetScope}_layer_${layerId}`
  }

  _layerStateAlias(layerId, state) {
    return `${this._assetScope}_layer_${layerId}_${state}`
  }

  _legacyMouthAlias(state) {
    return `${this._assetScope}_mouth_${state}`
  }

  _legacyIdleAlias(animationIndex, frameIndex) {
    return `${this._assetScope}_idle_${animationIndex}_${frameIndex}`
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
