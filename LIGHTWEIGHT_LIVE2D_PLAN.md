# 轻量分层类 Live2D 方案

## 目标定位
将当前“整张人物图切换”的音频驱动动画升级为轻量分层角色系统：底图稳定，嘴巴由音频自动驱动，表情和动作由人工触发，整体效果接近简化版 Live2D，但不引入完整骨骼和 Cubism 模型。

本阶段不做完整骨骼绑定编辑器。先做图层、控制点、动作片段和时间轴，保证工具能服务口播视频生产。

## 新架构
角色由多个 Pixi 图层组成：

- `body`：身体基础层，通常不变。
- `head`：头部层，可做轻微点头、转头。
- `eyes`：睁眼、眨眼、看向不同方向。
- `mouth`：闭口、小口、中口、大口等，由音频自动驱动。
- `expression`：开心、惊讶、认真等表情覆盖层。
- `arms`：待机、挥手、指向、托腮等手势层。
- `props`：可选道具或强调元素。

## 配置方向
`assets/config.json` 从 `mouth + idle` 序列帧升级为 `layers + actions`：

```json
{
  "character": {
    "name": "我的角色",
    "width": 600,
    "height": 700,
    "backgroundColor": "0x0d1117"
  },
  "layers": [
    {
      "id": "body",
      "type": "image",
      "src": "sprites/body/base.png",
      "x": 0,
      "y": 0,
      "scale": 1,
      "rotation": 0,
      "zIndex": 0
    },
    {
      "id": "mouth",
      "type": "mouth",
      "states": {
        "closed": "sprites/mouth/closed.png",
        "small": "sprites/mouth/small.png",
        "medium": "sprites/mouth/medium.png",
        "large": "sprites/mouth/large.png",
        "xlarge": "sprites/mouth/xlarge.png"
      },
      "x": 278,
      "y": 365,
      "anchor": { "x": 0.5, "y": 0.5 },
      "zIndex": 20
    }
  ],
  "actions": {
    "nod": {
      "label": "点头",
      "duration": 500,
      "tracks": [
        { "layer": "head", "property": "rotation", "keys": [[0, 0], [180, 0.08], [500, 0]] }
      ]
    }
  }
}
```

第一版需要兼容旧配置：如果没有 `layers`，仍按当前整图方式加载，避免现有素材立即失效。

## 优先落地
第一阶段实现最小闭环：

- 分层配置兼容旧配置。
- `CharacterController` 管理多个 Pixi sprite。
- 嘴部图层独立切换，不再整张人物图跳变。
- 音频嘴型控制加入 RMS 平滑、迟滞阈值和最短保持。
- 控制面板支持基础人工动作按钮和快捷键。

后续扩展：

- 可视化图层编辑器，优先支持嘴巴位置拖拽和保存。
- 动作时间轴录制与回放。
- 简化控制点和关键帧动作。
- 完整骨骼绑定和 Live2D Cubism SDK 暂不进入当前阶段。
