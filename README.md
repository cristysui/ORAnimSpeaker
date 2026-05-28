# 语音人物工具

语音驱动动漫人物序列帧桌面应用。

## 快速开始

```bash
# 安装依赖
npm install

# 启动（开发模式，带 DevTools）
npm run dev

# 正式启动
npm start
```

## 素材目录结构

```
assets/
├── config.json          ← 角色配置文件（可放到任意位置）
└── sprites/
    ├── mouth/
    │   ├── closed.png   ← 闭口
    │   ├── small.png    ← 微张
    │   ├── medium.png   ← 中张
    │   ├── large.png    ← 大张
    │   └── xlarge.png   ← 极大张
    └── idle/
        ├── blink/
        │   ├── 01.png ~ 07.png
        ├── wave/
        │   ├── 01.png ~ 08.png
        └── breathe/
            ├── 01.png ~ 05.png
```

## 配置文件说明 (config.json)

```json
{
  "character": {
    "name": "角色名",
    "width": 600,       // 画布宽度（与素材分辨率一致）
    "height": 700
  },
  "mouth": {
    "states": {
      "closed": "相对路径.png",   // 5 档口型
      "small": "...",
      "medium": "...",
      "large": "...",
      "xlarge": "..."
    },
    "thresholds": {
      "small":  0.02,   // RMS 阈值，0~1，可调整
      "medium": 0.08,
      "large":  0.18,
      "xlarge": 0.35
    }
  },
  "idle": [
    {
      "name": "动作名称",
      "fps": 24,           // 序列帧播放帧率
      "weight": 1,         // 随机权重，越大越常出现
      "frames": ["01.png", "02.png", ...]
    }
  ]
}
```

## 使用流程

1. `npm start` 启动应用
2. 点击"加载角色配置"，选择 `config.json`
3. 选择"使用麦克风"或"导入音频文件"
4. 角色会实时根据音量切换口型/待机动画

## 参数调节

| 参数 | 说明 |
|------|------|
| 静默阈值 | 低于此 RMS 值判定为静默，越小越灵敏 |
| 静默延迟 | 静默持续多少毫秒才切换到 IDLE 状态 |
| 动作间隔 | 待机动画触发的平均间隔秒数 |

## 素材建议

- PNG 带透明通道，背景透明
- 口型图整图合成（含完整角色）
- 待机动画建议 24fps，3~4 秒 = 72~96 帧
- 所有素材尺寸保持一致（与 config.json 中 width/height 对应）
