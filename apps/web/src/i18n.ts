import { useMemo } from "react";
import { useSettingsStore } from "./stores/settings-store";

export type AppLanguage = "zh" | "en";

type TranslationKey =
  | "app.loadingEditor"
  | "app.newProject"
  | "app.newVerticalVideo"
  | "app.newHorizontalVideo"
  | "app.newSquareVideo"
  | "toolbar.backHome"
  | "toolbar.exporting"
  | "toolbar.autoSaved"
  | "toolbar.undo"
  | "toolbar.redo"
  | "toolbar.history"
  | "toolbar.actionHistory"
  | "toolbar.lightMode"
  | "toolbar.darkMode"
  | "toolbar.language"
  | "toolbar.saved"
  | "toolbar.export"
  | "toolbar.bestMatch"
  | "toolbar.estimated"
  | "toolbar.customExport"
  | "toolbar.customExportDesc"
  | "toolbar.mediaFile"
  | "export.mp4Standard"
  | "export.mp4StandardDesc"
  | "export.4kStandard"
  | "export.4kStandardDesc"
  | "export.1080pHigh"
  | "export.1080pHighDesc"
  | "export.1080p60"
  | "export.1080p60Desc"
  | "export.audioOnly"
  | "export.audioOnlyDesc"
  | "assets.avatar"
  | "assets.avatarDesc"
  | "assets.backgrounds"
  | "assets.backgroundsDesc"
  | "assets.searchMedia"
  | "assets.noMedia"
  | "assets.dragOrImport"
  | "assets.importMedia"
  | "assets.addMedia"
  | "assets.dropFiles"
  | "assets.showOnlyMissing"
  | "assets.relinkFromFolder"
  | "assets.largeIcons"
  | "assets.smallIcons"
  | "assets.listView"
  | "assets.all"
  | "assets.solid"
  | "assets.gradient"
  | "assets.mesh"
  | "assets.pattern"
  | "assets.addToTimeline"
  | "assets.delete"
  | "assets.replaceAsset"
  | "assets.retryGeneration"
  | "assets.generating"
  | "assets.createWithKieAI"
  | "assets.generationFailed"
  | "assets.kieAIInProgress"
  | "assets.failed"
  | "assets.missing"
  | "assets.unsavedAudioTitle"
  | "assets.unsavedAudioDesc"
  | "avatar.videoConfig"
  | "avatar.sequenceConfig"
  | "avatar.videoActionList"
  | "avatar.videoActionDesc"
  | "avatar.sequenceActionList"
  | "avatar.sequenceActionDesc"
  | "avatar.videoGeneration"
  | "avatar.sequenceGeneration"
  | "avatar.frameDuration"
  | "avatar.idle"
  | "avatar.speaking"
  | "avatar.manualAction"
  | "avatar.required"
  | "avatar.bound"
  | "avatar.add"
  | "avatar.addManualAction"
  | "avatar.deleteVideo"
  | "avatar.deleteAction"
  | "avatar.deleteFrame"
  | "avatar.newActionName"
  | "avatar.importSequenceFrames"
  | "avatar.frames"
  | "avatar.perImage"
  | "avatar.ready"
  | "avatar.notReady"
  | "avatar.videoImportFailed"
  | "avatar.videoImportFailedWithReason"
  | "avatar.prepareRemoveBg"
  | "avatar.transparentReady"
  | "avatar.generationStripTitle"
  | "avatar.generateFromSequence"
  | "avatar.generateFromVideo"
  | "avatar.generatedFromSequence"
  | "avatar.generatedFromVideo"
  | "avatar.generateFailed"
  | "avatar.noGeneratedClip"
  | "avatar.noGeneratedClipDesc"
  | "avatar.overlayAdded"
  | "avatar.overlayFailed"
  | "avatar.noActions"
  | "avatar.videoActions"
  | "avatar.sequenceActions"
  | "avatar.align"
  | "avatar.referenceAction"
  | "avatar.noReference"
  | "avatar.onionSkin"
  | "avatar.applyTransform"
  | "avatar.autoAlign"
  | "avatar.aligning"
  | "avatar.currentAction"
  | "avatar.widthScale"
  | "avatar.heightScale"
  | "avatar.rotation"
  | "avatar.opacity"
  | "avatar.alignApplied"
  | "avatar.autoAlignApplied"
  | "avatar.noSubject"
  | "avatar.autoAlignFailed"
  | "inspector.noSelection"
  | "inspector.noSelectionDesc"
  | "inspector.tabs"
  | "preview.player"
  | "tab.avatarAlign"
  | "tab.transform"
  | "tab.color"
  | "tab.effects"
  | "tab.audio"
  | "tab.speed"
  | "tab.animate"
  | "tab.ai"
  | "tab.style"
  | "tab.avatarActions"
  | "engine.starting"
  | "engine.video"
  | "engine.mediaBridge"
  | "engine.playbackBridge"
  | "engine.renderBridge"
  | "engine.effectsBridge"
  | "engine.transitionBridge"
  | "engine.failed";
type WelcomeTranslationKey =
  | "welcome.title"
  | "welcome.subtitle"
  | "welcome.newProject"
  | "welcome.projectName"
  | "welcome.defaultProjectName"
  | "welcome.landscape"
  | "welcome.portrait"
  | "welcome.square"
  | "welcome.recentProjects"
  | "welcome.noRecentProjects"
  | "welcome.language"
  | "welcome.vertical"
  | "welcome.horizontal"
  | "welcome.fromIdea"
  | "welcome.inBrowser"
  | "welcome.pickFormat"
  | "welcome.startCreating"
  | "welcome.browseTemplates"
  | "welcome.openEditor"
  | "welcome.skipOnStartup"
  | "welcome.pressEsc"
  | "welcome.back"
  | "welcome.templates"
  | "welcome.loadingRecent"
  | "welcome.noRecentTitle"
  | "welcome.noRecentDesc"
  | "welcome.recentStoredLocal"
  | "welcome.removeRecent"
  | "welcome.today"
  | "welcome.yesterday"
  | "welcome.daysAgo"
  | "welcome.weeksAgo"
  | "welcome.recoverTitle"
  | "welcome.recoverDesc"
  | "welcome.lastSaved"
  | "welcome.startFresh"
  | "welcome.recoverProject"
  | "welcome.recovering"
  | "welcome.olderSaves"
  | "welcome.clearSaved"
  | "welcome.justNow"
  | "welcome.minutesAgo"
  | "welcome.hoursAgo"
  | "welcome.loadingTemplates"
  | "welcome.searchTemplates"
  | "welcome.noTemplates"
  | "welcome.noTemplatesDesc"
  | "welcome.all";

type AllTranslationKey = TranslationKey | WelcomeTranslationKey;

const translations: Record<AppLanguage, Record<AllTranslationKey, string>> = {
  zh: {
    "app.loadingEditor": "正在加载编辑器...",
    "app.newProject": "新项目",
    "app.newVerticalVideo": "新竖屏视频",
    "app.newHorizontalVideo": "新横屏视频",
    "app.newSquareVideo": "新方形视频",
    "toolbar.backHome": "返回首页",
    "toolbar.exporting": "正在导出",
    "toolbar.autoSaved": "已自动保存",
    "toolbar.undo": "撤销 (⌘Z)",
    "toolbar.redo": "重做 (⇧⌘Z)",
    "toolbar.history": "历史操作",
    "toolbar.actionHistory": "历史操作",
    "toolbar.lightMode": "切换到亮色模式",
    "toolbar.darkMode": "切换到暗色模式",
    "toolbar.language": "语言",
    "toolbar.saved": "已保存",
    "toolbar.export": "导出",
    "toolbar.bestMatch": "推荐",
    "toolbar.estimated": "预计",
    "toolbar.customExport": "自定义导出...",
    "toolbar.customExportDesc": "完整导出设置和 AI 放大",
    "toolbar.mediaFile": "媒体文件",
    "export.mp4Standard": "MP4 标准",
    "export.mp4StandardDesc": "H.264 - 网页与社交平台",
    "export.4kStandard": "4K 标准",
    "export.4kStandardDesc": "3840×2160 - YouTube 4K",
    "export.1080pHigh": "1080p 高质量",
    "export.1080pHighDesc": "1920×1080 30fps - 高码率",
    "export.1080p60": "1080p 60fps",
    "export.1080p60Desc": "1920×1080 - 流畅播放",
    "export.audioOnly": "仅音频 (WAV)",
    "export.audioOnlyDesc": "无压缩音频",
    "assets.avatar": "角色动画",
    "assets.avatarDesc": "配置人物视频或序列帧后，在音频轨上方生成角色动画。",
    "assets.backgrounds": "背景",
    "assets.backgroundsDesc": "添加纯色、渐变、网格和图案背景。",
    "assets.searchMedia": "搜索素材",
    "assets.noMedia": "还没有导入素材",
    "assets.dragOrImport": "拖入文件或点击导入",
    "assets.importMedia": "导入素材",
    "assets.addMedia": "添加素材",
    "assets.dropFiles": "松开以导入文件",
    "assets.showOnlyMissing": "只显示丢失素材",
    "assets.relinkFromFolder": "从文件夹重新链接...",
    "assets.largeIcons": "大图标",
    "assets.smallIcons": "小图标",
    "assets.listView": "列表视图",
    "assets.all": "全部",
    "assets.solid": "纯色",
    "assets.gradient": "渐变",
    "assets.mesh": "网格",
    "assets.pattern": "图案",
    "assets.addToTimeline": "添加到时间线",
    "assets.delete": "删除",
    "assets.replaceAsset": "替换素材",
    "assets.retryGeneration": "重试生成",
    "assets.generating": "生成中...",
    "assets.createWithKieAI": "用 KieAI 生成",
    "assets.generationFailed": "生成失败，点击重试",
    "assets.kieAIInProgress": "KieAI 正在生成...",
    "assets.failed": "失败",
    "assets.missing": "丢失",
    "assets.unsavedAudioTitle": "未保存音频已丢弃",
    "assets.unsavedAudioDesc": "下次请先保存到素材或下载。",
    "avatar.videoConfig": "视频配置",
    "avatar.sequenceConfig": "序列帧配置",
    "avatar.videoActionList": "视频动作列表",
    "avatar.videoActionDesc": "静止和说话为必填动作；手动动作可继续添加并重命名。",
    "avatar.sequenceActionList": "序列帧动作列表",
    "avatar.sequenceActionDesc": "每个动作可包含多张序列帧图片，支持拖拽排序、单帧删除和继续添加。",
    "avatar.videoGeneration": "视频生成",
    "avatar.sequenceGeneration": "序列帧生成",
    "avatar.frameDuration": "单图时长(秒)",
    "avatar.idle": "静止",
    "avatar.speaking": "说话",
    "avatar.manualAction": "手动动作",
    "avatar.required": "必填",
    "avatar.bound": "已绑定",
    "avatar.add": "添加",
    "avatar.addManualAction": "添加手动动作",
    "avatar.deleteVideo": "删除动作视频",
    "avatar.deleteAction": "删除动作",
    "avatar.deleteFrame": "删除序列帧",
    "avatar.newActionName": "新增动作名称",
    "avatar.importSequenceFrames": "导入该动作的序列帧",
    "avatar.frames": "帧",
    "avatar.perImage": "图",
    "avatar.ready": "已就绪",
    "avatar.notReady": "未完成",
    "avatar.videoImportFailed": "动作视频导入失败，请换一个浏览器可播放的视频格式。",
    "avatar.videoImportFailedWithReason": "动作视频导入失败：{reason}",
    "avatar.prepareRemoveBg": "准备去背景",
    "avatar.transparentReady": "已生成透明背景素材",
    "avatar.generationStripTitle": "音频驱动角色动画",
    "avatar.generateFromSequence": "从序列帧生成动画",
    "avatar.generateFromVideo": "从视频生成动画",
    "avatar.generatedFromSequence": "已从序列帧生成角色动画",
    "avatar.generatedFromVideo": "已从视频生成角色动画",
    "avatar.generateFailed": "生成角色动画失败",
    "avatar.noGeneratedClip": "请先生成一段角色动画",
    "avatar.noGeneratedClipDesc": "动作覆盖需要依附在已生成的角色动画轨道上。",
    "avatar.overlayAdded": "已添加动作覆盖片段",
    "avatar.overlayFailed": "添加动作失败",
    "avatar.noActions": "还没有配置动作。",
    "avatar.videoActions": "视频动作",
    "avatar.sequenceActions": "序列帧动作",
    "avatar.align": "动作对齐",
    "avatar.referenceAction": "参考动作",
    "avatar.noReference": "暂无可用参考",
    "avatar.onionSkin": "洋葱皮",
    "avatar.applyTransform": "套用变换",
    "avatar.autoAlign": "自动对齐",
    "avatar.aligning": "对齐中",
    "avatar.currentAction": "当前动作",
    "avatar.widthScale": "宽度缩放",
    "avatar.heightScale": "高度缩放",
    "avatar.rotation": "旋转",
    "avatar.opacity": "透明度",
    "avatar.alignApplied": "已套用参考动作的变换",
    "avatar.autoAlignApplied": "已按人物主体框自动对齐",
    "avatar.noSubject": "没有识别到清晰的人物主体",
    "avatar.autoAlignFailed": "自动对齐失败，请用洋葱皮手动微调",
    "inspector.noSelection": "未选择内容",
    "inspector.noSelectionDesc": "请选择一个片段以查看属性",
    "inspector.tabs": "属性面板标签",
    "preview.player": "播放器",
    "tab.avatarAlign": "动作对齐",
    "tab.transform": "变换",
    "tab.color": "颜色",
    "tab.effects": "效果",
    "tab.audio": "音频",
    "tab.speed": "速度",
    "tab.animate": "动画",
    "tab.ai": "AI",
    "tab.style": "样式",
    "tab.avatarActions": "手动动画",
    "engine.starting": "正在启动...",
    "engine.video": "正在初始化视频引擎...",
    "engine.mediaBridge": "正在初始化媒体桥接...",
    "engine.playbackBridge": "正在初始化播放桥接...",
    "engine.renderBridge": "正在初始化渲染桥接...",
    "engine.effectsBridge": "正在初始化效果桥接...",
    "engine.transitionBridge": "正在初始化转场桥接...",
    "engine.failed": "初始化失败",
    "welcome.title": "角色视频编辑器",
    "welcome.subtitle": "ORAnimSpeaker 项目管理和角色动画生成工作流。",
    "welcome.newProject": "新建项目",
    "welcome.projectName": "项目名称",
    "welcome.defaultProjectName": "角色视频项目",
    "welcome.landscape": "横屏 1920 x 1080",
    "welcome.portrait": "竖屏 1080 x 1920",
    "welcome.square": "方形 1080 x 1080",
    "welcome.recentProjects": "最近项目",
    "welcome.noRecentProjects": "还没有最近项目。新建项目后会显示在这里。",
    "welcome.language": "语言",
    "welcome.vertical": "竖屏",
    "welcome.horizontal": "横屏",
    "welcome.fromIdea": "从想法到导出。",
    "welcome.inBrowser": "都在浏览器里完成。",
    "welcome.pickFormat": "选择一个画幅开始创作，之后也可以随时修改。",
    "welcome.startCreating": "开始创建",
    "welcome.browseTemplates": "浏览模板",
    "welcome.openEditor": "打开编辑器",
    "welcome.skipOnStartup": "启动时跳过",
    "welcome.pressEsc": "按 Esc 跳过",
    "welcome.back": "返回",
    "welcome.templates": "模板",
    "welcome.loadingRecent": "正在加载最近项目...",
    "welcome.noRecentTitle": "没有最近项目",
    "welcome.noRecentDesc": "最近打开的项目会显示在这里。新建项目或使用模板即可开始。",
    "welcome.recentStoredLocal": "最近项目保存在当前浏览器本地",
    "welcome.removeRecent": "从最近项目中移除",
    "welcome.today": "今天",
    "welcome.yesterday": "昨天",
    "welcome.daysAgo": "{count} 天前",
    "welcome.weeksAgo": "{count} 周前",
    "welcome.recoverTitle": "恢复你的工作",
    "welcome.recoverDesc": "发现一个未保存项目",
    "welcome.lastSaved": "上次保存于",
    "welcome.startFresh": "重新开始",
    "welcome.recoverProject": "恢复项目",
    "welcome.recovering": "正在恢复...",
    "welcome.olderSaves": "{count} 个较早保存可用",
    "welcome.clearSaved": "清除所有已保存项目",
    "welcome.justNow": "刚刚",
    "welcome.minutesAgo": "{count} 分钟前",
    "welcome.hoursAgo": "{count} 小时前",
    "welcome.loadingTemplates": "正在加载模板...",
    "welcome.searchTemplates": "搜索模板...",
    "welcome.noTemplates": "没有找到模板",
    "welcome.noTemplatesDesc": "试试调整搜索词或筛选条件",
    "welcome.all": "全部",
  },
  en: {
    "app.loadingEditor": "Loading editor...",
    "app.newProject": "New Project",
    "app.newVerticalVideo": "New Vertical Video",
    "app.newHorizontalVideo": "New Horizontal Video",
    "app.newSquareVideo": "New Square Video",
    "toolbar.backHome": "Back to home",
    "toolbar.exporting": "Exporting",
    "toolbar.autoSaved": "Auto saved",
    "toolbar.undo": "Undo (⌘Z)",
    "toolbar.redo": "Redo (⇧⌘Z)",
    "toolbar.history": "Action history",
    "toolbar.actionHistory": "Action history",
    "toolbar.lightMode": "Switch to light mode",
    "toolbar.darkMode": "Switch to dark mode",
    "toolbar.language": "Language",
    "toolbar.saved": "Saved",
    "toolbar.export": "Export",
    "toolbar.bestMatch": "Best match",
    "toolbar.estimated": "Est.",
    "toolbar.customExport": "Custom export...",
    "toolbar.customExportDesc": "Full settings with AI upscaling",
    "toolbar.mediaFile": "Media file",
    "export.mp4Standard": "MP4 Standard",
    "export.mp4StandardDesc": "H.264 - Web & social",
    "export.4kStandard": "4K Standard",
    "export.4kStandardDesc": "3840×2160 - YouTube 4K",
    "export.1080pHigh": "1080p High Quality",
    "export.1080pHighDesc": "1920×1080 30fps - High bitrate",
    "export.1080p60": "1080p 60fps",
    "export.1080p60Desc": "1920×1080 - Smooth playback",
    "export.audioOnly": "Audio Only (WAV)",
    "export.audioOnlyDesc": "Uncompressed audio",
    "assets.avatar": "Avatar",
    "assets.avatarDesc": "Configure character videos or image sequences, then generate animation above the audio track.",
    "assets.backgrounds": "Backgrounds",
    "assets.backgroundsDesc": "Add generated solid, gradient, mesh, and pattern backgrounds.",
    "assets.searchMedia": "Search media",
    "assets.noMedia": "No media imported",
    "assets.dragOrImport": "Drag files here or click to import",
    "assets.importMedia": "Import Media",
    "assets.addMedia": "Add media",
    "assets.dropFiles": "Drop files to import",
    "assets.showOnlyMissing": "Show Only Missing Assets",
    "assets.relinkFromFolder": "Relink from Folder...",
    "assets.largeIcons": "Large icons",
    "assets.smallIcons": "Small icons",
    "assets.listView": "List view",
    "assets.all": "All",
    "assets.solid": "Solid",
    "assets.gradient": "Gradient",
    "assets.mesh": "Mesh",
    "assets.pattern": "Pattern",
    "assets.addToTimeline": "Add to timeline",
    "assets.delete": "Delete",
    "assets.replaceAsset": "Replace asset",
    "assets.retryGeneration": "Retry generation",
    "assets.generating": "Generating...",
    "assets.createWithKieAI": "Create with KieAI",
    "assets.generationFailed": "Generation failed, click to retry",
    "assets.kieAIInProgress": "KieAI generation in progress...",
    "assets.failed": "Failed",
    "assets.missing": "Missing",
    "assets.unsavedAudioTitle": "Unsaved audio discarded",
    "assets.unsavedAudioDesc": "Save to media or download next time to keep it.",
    "avatar.videoConfig": "Video Config",
    "avatar.sequenceConfig": "Sequence Config",
    "avatar.videoActionList": "Video Actions",
    "avatar.videoActionDesc": "Idle and speaking are required; manual actions can be added and renamed.",
    "avatar.sequenceActionList": "Sequence Actions",
    "avatar.sequenceActionDesc": "Each action can contain multiple frames. Drag to reorder, delete single frames, or add more.",
    "avatar.videoGeneration": "Video generation",
    "avatar.sequenceGeneration": "Sequence generation",
    "avatar.frameDuration": "Frame duration (seconds)",
    "avatar.idle": "Idle",
    "avatar.speaking": "Speaking",
    "avatar.manualAction": "Manual action",
    "avatar.required": "Required",
    "avatar.bound": "Bound",
    "avatar.add": "Add",
    "avatar.addManualAction": "Add manual action",
    "avatar.deleteVideo": "Delete action video",
    "avatar.deleteAction": "Delete action",
    "avatar.deleteFrame": "Delete frame",
    "avatar.newActionName": "New action name",
    "avatar.importSequenceFrames": "Import frames for this action",
    "avatar.frames": "frames",
    "avatar.perImage": "image",
    "avatar.ready": "Ready",
    "avatar.notReady": "Incomplete",
    "avatar.videoImportFailed": "Could not import the action video. Try a browser-playable video format.",
    "avatar.videoImportFailedWithReason": "Action video import failed: {reason}",
    "avatar.prepareRemoveBg": "Preparing background removal",
    "avatar.transparentReady": "Transparent background asset generated",
    "avatar.generationStripTitle": "Audio-driven avatar animation",
    "avatar.generateFromSequence": "Generate from sequence",
    "avatar.generateFromVideo": "Generate from video",
    "avatar.generatedFromSequence": "Generated avatar animation from sequence",
    "avatar.generatedFromVideo": "Generated avatar animation from video",
    "avatar.generateFailed": "Failed to generate avatar animation",
    "avatar.noGeneratedClip": "Generate an avatar animation first",
    "avatar.noGeneratedClipDesc": "Action overrides must attach to an existing generated avatar animation track.",
    "avatar.overlayAdded": "Action override added",
    "avatar.overlayFailed": "Failed to add action",
    "avatar.noActions": "No actions configured yet.",
    "avatar.videoActions": "Video actions",
    "avatar.sequenceActions": "Sequence actions",
    "avatar.align": "Action Alignment",
    "avatar.referenceAction": "Reference action",
    "avatar.noReference": "No reference available",
    "avatar.onionSkin": "Onion skin",
    "avatar.applyTransform": "Apply transform",
    "avatar.autoAlign": "Auto align",
    "avatar.aligning": "Aligning",
    "avatar.currentAction": "Current action",
    "avatar.widthScale": "Width scale",
    "avatar.heightScale": "Height scale",
    "avatar.rotation": "Rotation",
    "avatar.opacity": "Opacity",
    "avatar.alignApplied": "Applied the reference action transform",
    "avatar.autoAlignApplied": "Auto-aligned by subject box",
    "avatar.noSubject": "No clear subject detected",
    "avatar.autoAlignFailed": "Auto align failed. Use onion skin to fine tune manually.",
    "inspector.noSelection": "No selection",
    "inspector.noSelectionDesc": "Select a clip to view its properties",
    "inspector.tabs": "Inspector tabs",
    "preview.player": "Player",
    "tab.avatarAlign": "Align",
    "tab.transform": "Transform",
    "tab.color": "Color",
    "tab.effects": "Effects",
    "tab.audio": "Audio",
    "tab.speed": "Speed",
    "tab.animate": "Animate",
    "tab.ai": "AI",
    "tab.style": "Style",
    "tab.avatarActions": "Manual",
    "engine.starting": "Starting...",
    "engine.video": "Initializing video engine...",
    "engine.mediaBridge": "Initializing media bridge...",
    "engine.playbackBridge": "Initializing playback bridge...",
    "engine.renderBridge": "Initializing render bridge...",
    "engine.effectsBridge": "Initializing effects bridge...",
    "engine.transitionBridge": "Initializing transition bridge...",
    "engine.failed": "Initialization failed",
    "welcome.title": "Character Video Editor",
    "welcome.subtitle": "ORAnimSpeaker project management and avatar animation workflow.",
    "welcome.newProject": "New Project",
    "welcome.projectName": "Project name",
    "welcome.defaultProjectName": "Character Video Project",
    "welcome.landscape": "Landscape 1920 x 1080",
    "welcome.portrait": "Portrait 1080 x 1920",
    "welcome.square": "Square 1080 x 1080",
    "welcome.recentProjects": "Recent Projects",
    "welcome.noRecentProjects": "No recent projects yet. New projects will appear here.",
    "welcome.language": "Language",
    "welcome.vertical": "Vertical",
    "welcome.horizontal": "Horizontal",
    "welcome.fromIdea": "From idea to export.",
    "welcome.inBrowser": "In your browser.",
    "welcome.pickFormat": "Pick a format and start creating. You can change this anytime.",
    "welcome.startCreating": "Start creating",
    "welcome.browseTemplates": "Browse templates",
    "welcome.openEditor": "Open editor",
    "welcome.skipOnStartup": "Skip on startup",
    "welcome.pressEsc": "Press Esc to skip",
    "welcome.back": "Back",
    "welcome.templates": "Templates",
    "welcome.loadingRecent": "Loading recent projects...",
    "welcome.noRecentTitle": "No Recent Projects",
    "welcome.noRecentDesc": "Your recently opened projects will appear here. Start a new project or use a template to get started.",
    "welcome.recentStoredLocal": "Recent projects are stored locally in your browser",
    "welcome.removeRecent": "Remove from recent",
    "welcome.today": "Today",
    "welcome.yesterday": "Yesterday",
    "welcome.daysAgo": "{count} days ago",
    "welcome.weeksAgo": "{count} weeks ago",
    "welcome.recoverTitle": "Recover Your Work",
    "welcome.recoverDesc": "We found an unsaved project",
    "welcome.lastSaved": "Last saved",
    "welcome.startFresh": "Start Fresh",
    "welcome.recoverProject": "Recover Project",
    "welcome.recovering": "Recovering...",
    "welcome.olderSaves": "{count} older saves available",
    "welcome.clearSaved": "Clear all saved projects",
    "welcome.justNow": "just now",
    "welcome.minutesAgo": "{count} minutes ago",
    "welcome.hoursAgo": "{count} hours ago",
    "welcome.loadingTemplates": "Loading templates...",
    "welcome.searchTemplates": "Search templates...",
    "welcome.noTemplates": "No templates found",
    "welcome.noTemplatesDesc": "Try adjusting your search or filter",
    "welcome.all": "All",
  },
};

export function normalizeLanguage(language: string): AppLanguage {
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function translate(language: string, key: AllTranslationKey): string {
  const normalized = normalizeLanguage(language);
  return translations[normalized][key] ?? translations.en[key] ?? key;
}

export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

export function useI18n() {
  const language = useSettingsStore((state) => normalizeLanguage(state.language));
  const setLanguage = useSettingsStore((state) => state.setLanguage);

  return useMemo(() => ({
    language,
    setLanguage: (next: AppLanguage) => setLanguage(next),
    t: (key: AllTranslationKey, values?: Record<string, string | number>) => {
      const text = translate(language, key);
      return values ? interpolate(text, values) : text;
    },
  }), [language, setLanguage]);
}

export type { TranslationKey, AllTranslationKey };
