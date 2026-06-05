import React, { useMemo, useRef, useState } from "react";
import { Eraser, Film, GripVertical, ImagePlus, Plus, Trash2, Upload } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import {
  appendAvatarSequenceAction,
  appendAvatarSequenceFrames,
  appendAvatarVideoAssets,
  getAvatarConfig,
  hasSequenceConfig,
  hasVideoConfig,
  removeAvatarSequenceAction,
  removeAvatarSequenceFrame,
  removeAvatarVideoAsset,
  reorderAvatarSequenceFrames,
  updateAvatarSequenceFrameMedia,
  updateAvatarSequenceActionName,
  updateAvatarVideoAssetMedia,
  updateAvatarVideoAssetName,
} from "./avatar-project";
import {
  DEFAULT_FRAME_DURATION_SEC,
  type AvatarActionKind,
  type AvatarSequenceAction,
  type AvatarSequenceFrame,
  type AvatarVideoAsset,
  defaultAvatarTransform,
} from "./avatar-types";
import { useAvatarSelectionStore } from "./avatar-selection-store";
import { AvatarThumbnail } from "./AvatarThumbnail";
import { removeAvatarMediaBackground } from "./avatar-background-removal";

const KIND_LABELS: Record<AvatarActionKind, string> = {
  idle: "静止",
  speaking: "说话",
  action: "手动动作",
};

type RequiredActionKind = "idle" | "speaking";

const REQUIRED_KINDS: RequiredActionKind[] = ["idle", "speaking"];
const ENABLE_BACKGROUND_REMOVAL = false;
const VIDEO_ACCEPT = "video/*,.mp4,.m4v,.mov,.webm,.mkv";

const clampFrameDuration = (value: number): number => {
  return Math.min(2, Math.max(0.1, value || DEFAULT_FRAME_DURATION_SEC));
};

const parseFrameDurationInput = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.1 || parsed > 2) {
    return DEFAULT_FRAME_DURATION_SEC;
  }
  return clampFrameDuration(parsed);
};

const formatFrameDuration = (value: number): string => {
  return Number(value.toFixed(2)).toString();
};

export const AvatarPanel: React.FC = () => {
  const project = useProjectStore((state) => state.project);
  const importMedia = useProjectStore((state) => state.importMedia);
  const config = useMemo(() => getAvatarConfig(project), [project]);
  const selectedConfig = useAvatarSelectionStore((state) => state.selectedConfig);
  const selectConfig = useAvatarSelectionStore((state) => state.selectConfig);
  const clearSelection = useUIStore((state) => state.clearSelection);
  const [sequenceName, setSequenceName] = useState("手动动作");
  const [frameDurationInput, setFrameDurationInput] = useState(
    formatFrameDuration(DEFAULT_FRAME_DURATION_SEC),
  );
  const [activeTab, setActiveTab] = useState<"video" | "sequence">("video");
  const [busy, setBusy] = useState(false);
  const [backgroundRemovalTarget, setBackgroundRemovalTarget] = useState<string | null>(null);
  const [backgroundRemovalMessage, setBackgroundRemovalMessage] = useState<string | null>(null);
  const [draggedFrame, setDraggedFrame] = useState<{ actionId: string; index: number } | null>(null);

  const selectedVideoId = selectedConfig?.source === "video" ? selectedConfig.id : null;
  const selectedSequenceId = selectedConfig?.source === "sequence" ? selectedConfig.id : null;

  const selectVideo = (assetId: string) => {
    clearSelection();
    selectConfig({ source: "video", id: assetId });
  };

  const selectSequence = (actionId: string) => {
    clearSelection();
    selectConfig({ source: "sequence", id: actionId });
  };

  const importVideos = async (kind: AvatarActionKind, files: File[] | FileList | null) => {
    if (!files?.length) return;
    const fileList = Array.from(files);
    setBusy(true);
    setBackgroundRemovalMessage(null);
    const importStart = performance.now();
    console.info("[Avatar] video action import start", {
      kind,
      count: fileList.length,
      files: fileList.map((file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
      })),
    });
    try {
      const assets: AvatarVideoAsset[] = [];
      for (const file of fileList) {
        const thumbnailUrl = await createVideoFirstFrameThumbnail(file);
        const result = await importMedia(file, {
          browserVideoMetadata: true,
          thumbnailUrl,
        });
        if (!result.success || !result.actionId) {
          console.warn("[Avatar] video action import skipped", {
            file: file.name,
            error: result.error?.message,
          });
          continue;
        }
        assets.push({
          id: crypto.randomUUID(),
          mediaId: result.actionId,
          name: kind === "action" ? file.name.replace(/\.[^.]+$/, "") : file.name,
          kind,
          transform: defaultAvatarTransform(),
        });
      }
      if (assets.length > 0) appendAvatarVideoAssets(assets);
      if (assets.length === 0) {
        setBackgroundRemovalMessage("动作视频导入失败，请换一个浏览器可播放的视频格式。");
      }
      console.info("[Avatar] video action import complete", {
        kind,
        imported: assets.length,
        elapsedMs: Math.round(performance.now() - importStart),
      });
    } catch (error) {
      console.error("[Avatar] video action import failed", error);
      setBackgroundRemovalMessage(
        `动作视频导入失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const createSequenceFrames = async (
    files: FileList | null,
    durationSec: number,
  ): Promise<AvatarSequenceFrame[]> => {
    if (!files?.length) return [];
    const frames: AvatarSequenceFrame[] = [];
    for (const file of Array.from(files)) {
      const result = await importMedia(file);
      if (!result.success || !result.actionId) continue;
      frames.push({
        id: crypto.randomUUID(),
        mediaId: result.actionId,
        name: file.name,
        durationSec,
      });
    }
    return frames;
  };

  const importSequenceAction = async (
    kind: AvatarActionKind,
    files: FileList | null,
    name = KIND_LABELS[kind],
  ) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const durationSec = parseFrameDurationInput(frameDurationInput);
      setFrameDurationInput(formatFrameDuration(durationSec));
      const frames = await createSequenceFrames(files, durationSec);
      if (frames.length === 0) return;
      appendAvatarSequenceAction({
        id: crypto.randomUUID(),
        name: name.trim() || KIND_LABELS[kind],
        kind,
        frameDurationSec: durationSec,
        frames,
        transform: defaultAvatarTransform(),
      });
    } finally {
      setBusy(false);
    }
  };

  const addSequenceFrames = async (action: AvatarSequenceAction, files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const frames = await createSequenceFrames(files, action.frameDurationSec);
      appendAvatarSequenceFrames(action.id, frames);
    } finally {
      setBusy(false);
    }
  };

  const removeVideoBackground = async (asset: AvatarVideoAsset) => {
    const media = project.mediaLibrary.items.find((item) => item.id === asset.mediaId);
    if (!media) return;
    setBusy(true);
    setBackgroundRemovalTarget(`video:${asset.id}`);
    setBackgroundRemovalMessage("准备去背景");
    try {
      const file = await removeAvatarMediaBackground(media, setBackgroundRemovalMessage);
      const result = await importMedia(file);
      if (result.success && result.actionId) {
        updateAvatarVideoAssetMedia(asset.id, result.actionId);
        selectVideo(asset.id);
        setBackgroundRemovalMessage("已生成透明背景素材");
      }
    } finally {
      setBusy(false);
      setBackgroundRemovalTarget(null);
      window.setTimeout(() => setBackgroundRemovalMessage(null), 1800);
    }
  };

  const removeSequenceFrameBackground = async (actionId: string, frame: AvatarSequenceFrame) => {
    const media = project.mediaLibrary.items.find((item) => item.id === frame.mediaId);
    if (!media) return;
    setBusy(true);
    setBackgroundRemovalTarget(`frame:${frame.id}`);
    setBackgroundRemovalMessage("准备去背景");
    try {
      const file = await removeAvatarMediaBackground(media, setBackgroundRemovalMessage);
      const result = await importMedia(file);
      if (result.success && result.actionId) {
        updateAvatarSequenceFrameMedia(actionId, frame.id, result.actionId);
        selectSequence(actionId);
        setBackgroundRemovalMessage("已生成透明背景素材");
      }
    } finally {
      setBusy(false);
      setBackgroundRemovalTarget(null);
      window.setTimeout(() => setBackgroundRemovalMessage(null), 1800);
    }
  };

  return (
    <div className="h-full bg-bg-1 text-fg flex flex-col">
      <div className="flex border-b border-border bg-bg">
        <TabButton active={activeTab === "video"} onClick={() => setActiveTab("video")}>
          <Film className="h-4 w-4" />
          视频配置
        </TabButton>
        <TabButton active={activeTab === "sequence"} onClick={() => setActiveTab("sequence")}>
          <ImagePlus className="h-4 w-4" />
          序列帧配置
        </TabButton>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {activeTab === "video" ? (
          <section className="space-y-4">
            <ActionGrid
              title="视频动作列表"
              description={backgroundRemovalMessage ?? "静止和说话为必填动作；手动动作可继续添加并重命名。"}
            >
              {REQUIRED_KINDS.map((kind) => (
                <VideoActionSlot
                  key={kind}
                  kind={kind}
                  assets={config.videoConfig[kind]}
                  required
                  disabled={busy}
                  selectedId={selectedVideoId}
                  onFiles={importVideos}
                  onSelect={selectVideo}
                  onDelete={removeAvatarVideoAsset}
                  onRemoveBackground={removeVideoBackground}
                  processingId={backgroundRemovalTarget}
                />
              ))}
              {config.videoConfig.actions.map((asset) => (
                <VideoCustomActionCard
                  key={asset.id}
                  asset={asset}
                  selected={selectedVideoId === asset.id}
                  onSelect={selectVideo}
                  onDelete={removeAvatarVideoAsset}
                  onRename={updateAvatarVideoAssetName}
                  onRemoveBackground={removeVideoBackground}
                  processingId={backgroundRemovalTarget}
                />
              ))}
              <VideoAddActionCard disabled={busy} onFiles={importVideos} />
            </ActionGrid>
            <ConfigStatus ready={hasVideoConfig(config)} label="视频生成" />
          </section>
        ) : (
          <section className="space-y-4">
            <div className="rounded-lg border border-border bg-bg-2 p-3">
              <label className="text-xs text-fg-muted">
                单图时长(秒)
                <input
                  type="text"
                  inputMode="decimal"
                  value={frameDurationInput}
                  onChange={(event) => setFrameDurationInput(event.target.value)}
                  onBlur={() =>
                    setFrameDurationInput(
                      formatFrameDuration(parseFrameDurationInput(frameDurationInput)),
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-fg"
                />
              </label>
            </div>

            <ActionList
              title="序列帧动作列表"
              description={backgroundRemovalMessage ?? "每个动作可包含多张序列帧图片，支持拖拽排序、单帧删除和继续添加。"}
            >
              {REQUIRED_KINDS.map((kind) => (
                <SequenceActionSlot
                  key={kind}
                  kind={kind}
                  action={config.sequenceConfig[kind][0]}
                  required
                  disabled={busy}
                  selectedId={selectedSequenceId}
                  draggedFrame={draggedFrame}
                  onCreate={(files) => importSequenceAction(kind, files)}
                  onAddFrames={addSequenceFrames}
                  onSelect={selectSequence}
                  onDeleteAction={removeAvatarSequenceAction}
                  onDeleteFrame={removeAvatarSequenceFrame}
                  onRemoveFrameBackground={removeSequenceFrameBackground}
                  processingId={backgroundRemovalTarget}
                  onRename={updateAvatarSequenceActionName}
                  onDragFrame={setDraggedFrame}
                  onReorderFrame={reorderAvatarSequenceFrames}
                />
              ))}
              {config.sequenceConfig.actions.map((action) => (
                <SequenceActionSlot
                  key={action.id}
                  kind="action"
                  action={action}
                  disabled={busy}
                  selectedId={selectedSequenceId}
                  draggedFrame={draggedFrame}
                  onCreate={(files) => importSequenceAction("action", files, sequenceName)}
                  onAddFrames={addSequenceFrames}
                  onSelect={selectSequence}
                  onDeleteAction={removeAvatarSequenceAction}
                  onDeleteFrame={removeAvatarSequenceFrame}
                  onRemoveFrameBackground={removeSequenceFrameBackground}
                  processingId={backgroundRemovalTarget}
                  onRename={updateAvatarSequenceActionName}
                  onDragFrame={setDraggedFrame}
                  onReorderFrame={reorderAvatarSequenceFrames}
                />
              ))}
              <SequenceAddActionCard
                name={sequenceName}
                disabled={busy}
                onNameChange={setSequenceName}
                onFiles={(files) => importSequenceAction("action", files, sequenceName)}
              />
            </ActionList>
            <ConfigStatus ready={hasSequenceConfig(config)} label="序列帧生成" />
          </section>
        )}
      </div>
    </div>
  );
};

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    className={`flex flex-1 items-center justify-center gap-2 px-3 py-2 text-xs transition ${
      active ? "bg-bg-2 text-accent" : "text-fg-muted hover:text-fg"
    }`}
    onClick={onClick}
  >
    {children}
  </button>
);

const ActionGrid: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <section className="rounded-lg border border-border bg-bg-2 p-3">
    <SectionHeader title={title} description={description} />
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))" }}
    >
      {children}
    </div>
  </section>
);

const ActionList: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <section className="rounded-lg border border-border bg-bg-2 p-3">
    <SectionHeader title={title} description={description} />
    <div className="space-y-3">{children}</div>
  </section>
);

const SectionHeader: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div className="mb-3">
    <div className="text-sm font-medium">{title}</div>
    <p className="mt-1 text-xs text-fg-muted">{description}</p>
  </div>
);

const RequiredBadge: React.FC<{ required?: boolean }> = ({ required }) => (
  required ? (
    <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">必填</span>
  ) : null
);

const VideoActionSlot: React.FC<{
  kind: AvatarActionKind;
  assets: AvatarVideoAsset[];
  required?: boolean;
  disabled: boolean;
  selectedId: string | null;
  onFiles: (kind: AvatarActionKind, files: File[] | FileList | null) => void;
  onSelect: (assetId: string) => void;
  onDelete: (assetId: string) => void;
  onRemoveBackground: (asset: AvatarVideoAsset) => void;
  processingId: string | null;
}> = ({
  kind,
  assets,
  required,
  selectedId,
  onFiles,
  onSelect,
  onDelete,
  onRemoveBackground,
  processingId,
}) => {
  const inputId = `avatar-video-upload-${kind}`;
  const hasAssets = assets.length > 0;
  const pickFiles = () => {
    console.info("[Avatar] video action picker open", { kind, inputId });
    openAvatarVideoPicker({
      kind,
      inputId,
      onFiles: (files) => onFiles(kind, files),
    });
  };

  return (
    <div
      className={`flex min-h-[142px] flex-col overflow-hidden rounded-lg border bg-bg text-xs transition ${
        hasAssets ? "border-border" : "border-dashed border-border hover:border-accent"
      }`}
      data-avatar-selection-keep
    >
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5 text-fg-2">
        <span>{hasAssets ? `${KIND_LABELS[kind]}已绑定` : `添加${KIND_LABELS[kind]}`}</span>
        <RequiredBadge required={required} />
      </div>
      {hasAssets ? (
        <div className="grid flex-1 gap-2 p-2">
          {assets.map((asset) => (
            <VideoThumbButton
              key={asset.id}
              asset={asset}
              selected={selectedId === asset.id}
              onSelect={() => onSelect(asset.id)}
              onDelete={() => onDelete(asset.id)}
              onRemoveBackground={() => onRemoveBackground(asset)}
              processing={processingId === `video:${asset.id}`}
            />
          ))}
        </div>
      ) : (
        <UploadLabel onPick={pickFiles} />
      )}
    </div>
  );
};

const VideoCustomActionCard: React.FC<{
  asset: AvatarVideoAsset;
  selected: boolean;
  onSelect: (assetId: string) => void;
  onDelete: (assetId: string) => void;
  onRename: (assetId: string, name: string) => void;
  onRemoveBackground: (asset: AvatarVideoAsset) => void;
  processingId: string | null;
}> = ({ asset, selected, onSelect, onDelete, onRename, onRemoveBackground, processingId }) => (
  <div
    className={`flex min-h-[142px] flex-col overflow-hidden rounded-lg border bg-bg text-xs transition ${
      selected ? "border-accent ring-1 ring-accent" : "border-border hover:border-accent"
    }`}
    data-avatar-selection-keep
  >
    <div className="border-b border-border px-2 py-1.5">
      <input
        value={asset.name}
        onChange={(event) => onRename(asset.id, event.target.value)}
        onClick={(event) => event.stopPropagation()}
        className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-fg-2 outline-none focus:border-accent focus:bg-bg"
      />
    </div>
    <div className="flex-1 p-2">
      <VideoThumbButton
        asset={asset}
        selected={selected}
        onSelect={() => onSelect(asset.id)}
        onDelete={() => onDelete(asset.id)}
        onRemoveBackground={() => onRemoveBackground(asset)}
        processing={processingId === `video:${asset.id}`}
      />
    </div>
  </div>
);

const VideoAddActionCard: React.FC<{
  disabled: boolean;
  onFiles: (kind: AvatarActionKind, files: File[] | FileList | null) => void;
}> = ({ onFiles }) => {
  const inputId = "avatar-video-upload-custom-action";
  const pickFiles = () => {
    console.info("[Avatar] video action picker open", { kind: "action", inputId });
    openAvatarVideoPicker({
      kind: "action",
      inputId,
      onFiles: (files) => onFiles("action", files),
    });
  };
  return (
    <div className="flex min-h-[142px] flex-col overflow-hidden rounded-lg border border-dashed border-border bg-bg text-xs hover:border-accent">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5 text-fg-2">
        <span>添加手动动作</span>
        <Plus className="h-3.5 w-3.5" />
      </div>
      <UploadLabel onPick={pickFiles} />
    </div>
  );
};

const VideoThumbButton: React.FC<{
  asset: AvatarVideoAsset;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRemoveBackground: () => void;
  processing: boolean;
}> = ({ asset, selected, onSelect, onDelete, onRemoveBackground, processing }) => (
  <div
    role="button"
    tabIndex={0}
    className={`group relative min-h-[86px] overflow-hidden rounded-md border bg-bg-2 text-left transition ${
      selected ? "border-accent ring-1 ring-accent" : "border-border hover:border-accent"
    }`}
    onClick={onSelect}
    onKeyDown={(event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onSelect();
    }}
  >
    <AvatarThumbnail mediaId={asset.mediaId} className="h-full min-h-[86px] border-0" />
    <div className="absolute inset-x-0 bottom-0 bg-black/65 px-2 py-1.5">
      <div className="truncate text-[11px] text-white">
        {KIND_LABELS[asset.kind]} · {asset.name}
      </div>
    </div>
    {ENABLE_BACKGROUND_REMOVAL && (
      <RemoveBackgroundButton
        processing={processing}
        onClick={onRemoveBackground}
      />
    )}
    <DeleteButton title="删除动作视频" onDelete={onDelete} />
  </div>
);

const SequenceActionSlot: React.FC<{
  kind: AvatarActionKind;
  action?: AvatarSequenceAction;
  required?: boolean;
  disabled: boolean;
  selectedId: string | null;
  draggedFrame: { actionId: string; index: number } | null;
  onCreate: (files: FileList | null) => void;
  onAddFrames: (action: AvatarSequenceAction, files: FileList | null) => void;
  onSelect: (actionId: string) => void;
  onDeleteAction: (actionId: string) => void;
  onDeleteFrame: (actionId: string, frameId: string) => void;
  onRemoveFrameBackground: (actionId: string, frame: AvatarSequenceFrame) => void;
  processingId: string | null;
  onRename: (actionId: string, name: string) => void;
  onDragFrame: (value: { actionId: string; index: number } | null) => void;
  onReorderFrame: (actionId: string, fromIndex: number, toIndex: number) => void;
}> = ({
  kind,
  action,
  required,
  disabled,
  selectedId,
  draggedFrame,
  onCreate,
  onAddFrames,
  onSelect,
  onDeleteAction,
  onDeleteFrame,
  onRemoveFrameBackground,
  processingId,
  onRename,
  onDragFrame,
  onReorderFrame,
}) => {
  const inputId = action ? `avatar-sequence-add-${action.id}` : `avatar-sequence-create-${kind}`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selected = action ? selectedId === action.id : false;
  const pickFiles = () => {
    console.info("[Avatar] sequence picker open", {
      kind,
      inputId,
      actionId: action?.id ?? null,
    });
    inputRef.current?.click();
  };

  return (
    <div
      className={`overflow-hidden rounded-lg border bg-bg text-xs transition ${
        selected ? "border-accent ring-1 ring-accent" : "border-border"
      }`}
      data-avatar-selection-keep
      onClick={() => action && onSelect(action.id)}
    >
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        {required || !action ? (
          <div className="min-w-0 flex-1 truncate text-fg-2">{KIND_LABELS[kind]}</div>
        ) : (
          <input
            value={action.name}
            onChange={(event) => onRename(action.id, event.target.value)}
            onClick={(event) => event.stopPropagation()}
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-fg-2 outline-none focus:border-accent focus:bg-bg"
          />
        )}
        <RequiredBadge required={required} />
        {action && !required && (
          <button
            className="rounded p-1 text-fg-muted hover:bg-bg-2 hover:text-status-error"
            title="删除动作"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteAction(action.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {action ? (
        <div className="space-y-2 p-2">
          <div className="grid grid-cols-3 gap-2">
            {action.frames.map((frame, index) => (
              <FrameCard
                key={frame.id}
                actionId={action.id}
                frame={frame}
                index={index}
                dragging={draggedFrame?.actionId === action.id && draggedFrame.index === index}
                onDragFrame={onDragFrame}
                onDropFrame={(toIndex) => {
                  if (!draggedFrame || draggedFrame.actionId !== action.id) return;
                  onReorderFrame(action.id, draggedFrame.index, toIndex);
                  onDragFrame(null);
                }}
                onDelete={() => onDeleteFrame(action.id, frame.id)}
                onRemoveBackground={() => onRemoveFrameBackground(action.id, frame)}
                processing={processingId === `frame:${frame.id}`}
              />
            ))}
            <label
              htmlFor={inputId}
              className="flex aspect-square cursor-pointer items-center justify-center rounded border border-dashed border-border bg-bg-2 text-fg-muted hover:border-accent hover:text-accent"
              onClick={(event) => event.stopPropagation()}
            >
              <Plus className="h-4 w-4" />
            </label>
          </div>
          <div className="text-[10px] text-fg-muted">
            {action.frames.length} 帧 · {action.frameDurationSec}s/图
          </div>
        </div>
      ) : (
        <UploadLabel onPick={pickFiles} />
      )}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-busy={disabled ? "true" : undefined}
        onClick={() => {
          console.info("[Avatar] sequence input click", { kind, inputId });
        }}
        onChange={(event) => {
          console.info("[Avatar] sequence input change", {
            kind,
            inputId,
            count: event.target.files?.length ?? 0,
          });
          if (action) void onAddFrames(action, event.target.files);
          else void onCreate(event.target.files);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
};

const FrameCard: React.FC<{
  actionId: string;
  frame: AvatarSequenceFrame;
  index: number;
  dragging: boolean;
  onDragFrame: (value: { actionId: string; index: number } | null) => void;
  onDropFrame: (index: number) => void;
  onDelete: () => void;
  onRemoveBackground: () => void;
  processing: boolean;
}> = ({
  actionId,
  frame,
  index,
  dragging,
  onDragFrame,
  onDropFrame,
  onDelete,
  onRemoveBackground,
  processing,
}) => (
  <div
    draggable
    className={`group relative aspect-square overflow-hidden rounded border bg-bg-2 ${
      dragging ? "border-accent opacity-60" : "border-border"
    }`}
    onDragStart={(event) => {
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      onDragFrame({ actionId, index });
    }}
    onDragOver={(event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }}
    onDrop={(event) => {
      event.preventDefault();
      event.stopPropagation();
      onDropFrame(index);
    }}
    onDragEnd={() => onDragFrame(null)}
  >
    <AvatarThumbnail mediaId={frame.mediaId} className="min-h-0 border-0" />
    <div className="absolute left-1 top-1 rounded bg-black/65 px-1 py-0.5 text-[10px] text-white">
      {index + 1}
    </div>
    <div className="absolute bottom-1 left-1 rounded bg-black/65 p-1 text-white opacity-0 transition group-hover:opacity-100">
      <GripVertical className="h-3 w-3" />
    </div>
    {ENABLE_BACKGROUND_REMOVAL && (
      <RemoveBackgroundButton processing={processing} onClick={onRemoveBackground} compact />
    )}
    <DeleteButton title="删除序列帧" onDelete={onDelete} />
  </div>
);

const SequenceAddActionCard: React.FC<{
  name: string;
  disabled: boolean;
  onNameChange: (name: string) => void;
  onFiles: (files: FileList | null) => void;
}> = ({ name, disabled, onNameChange, onFiles }) => {
  const inputId = "avatar-sequence-create-custom-action";
  return (
    <div className="rounded-lg border border-dashed border-border bg-bg p-2 text-xs hover:border-accent">
      <label className="mb-2 block text-fg-muted">
        新增动作名称
        <input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          className="mt-1 w-full rounded border border-border bg-bg-2 px-2 py-1 text-fg"
        />
      </label>
      <label
        htmlFor={inputId}
        className="flex cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-border px-3 py-3 text-fg-2 hover:border-accent hover:text-accent"
      >
        <Upload className="h-4 w-4" />
        导入该动作的序列帧
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-busy={disabled ? "true" : undefined}
        onChange={(event) => {
          void onFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
};

function openAvatarVideoPicker(params: {
  kind: AvatarActionKind;
  inputId: string;
  onFiles: (files: File[] | null) => void;
}) {
  const timeline = useTimelineStore.getState();
  if (timeline.playbackState === "playing") {
    timeline.pause();
  }

  const input = document.createElement("input");
  input.type = "file";
  input.accept = VIDEO_ACCEPT;
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.top = "0";
  input.style.opacity = "0";

  let cleanupTimer: number | null = null;
  const cleanup = () => {
    if (cleanupTimer !== null) window.clearTimeout(cleanupTimer);
    input.onchange = null;
    input.onclick = null;
    input.remove();
  };

  input.onclick = () => {
    console.info("[Avatar] video action transient input click", {
      kind: params.kind,
      inputId: params.inputId,
    });
  };
  input.onchange = () => {
    console.info("[Avatar] video action transient input change", {
      kind: params.kind,
      inputId: params.inputId,
      count: input.files?.length ?? 0,
    });
    params.onFiles(input.files ? Array.from(input.files) : null);
    window.setTimeout(cleanup, 0);
  };

  document.body.appendChild(input);
  cleanupTimer = window.setTimeout(cleanup, 60000);
  input.click();
}

function createVideoFirstFrameThumbnail(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("video/") && !/\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name)) {
      resolve(null);
      return;
    }

    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };

    const finish = (thumbnailUrl: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(thumbnailUrl);
    };

    const capture = () => {
      if (
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth <= 0 ||
        video.videoHeight <= 0
      ) {
        return false;
      }

      try {
        const width = 320;
        const height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return false;
        context.drawImage(video, 0, 0, width, height);
        finish(canvas.toDataURL("image/png"));
        return true;
      } catch {
        return false;
      }
    };

    const requestCapture = () => {
      if (settled || capture()) return;
      if ("requestVideoFrameCallback" in video) {
        video.requestVideoFrameCallback(() => {
          capture();
        });
      } else {
        window.requestAnimationFrame(capture);
      }
    };

    const seekOrCapture = () => {
      if (settled) return;
      try {
        const targetTime = Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(0.05, video.duration / 2)
          : 0;
        if (targetTime > 0 && Math.abs(video.currentTime - targetTime) > 0.001) {
          video.currentTime = targetTime;
          return;
        }
      } catch {
        // Fall through to requestCapture.
      }
      requestCapture();
    };

    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      if (!capture()) finish(null);
    }, 3000);

    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadedmetadata = seekOrCapture;
    video.onloadeddata = requestCapture;
    video.oncanplay = requestCapture;
    video.onseeked = requestCapture;
    video.onerror = () => finish(null);
    video.src = url;
    video.load();

    // Some browsers only produce a drawable frame after a tiny muted play.
    window.setTimeout(() => {
      if (settled || video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
      video.play().then(() => {
        video.pause();
        requestCapture();
      }).catch(() => {});
    }, 250);
  });
}

const UploadLabel: React.FC<{ onPick: () => void }> = ({ onPick }) => (
  <button
    type="button"
    className="group flex flex-1 cursor-pointer items-center justify-center p-3"
    onClick={(event) => {
      event.stopPropagation();
      onPick();
    }}
  >
    <div className="flex h-12 w-20 items-center justify-center rounded border border-dashed border-border bg-bg-2 text-fg-muted group-hover:text-accent">
      <Upload className="h-5 w-5" />
    </div>
  </button>
);

const DeleteButton: React.FC<{ title: string; onDelete: () => void }> = ({ title, onDelete }) => (
  <span
    role="button"
    tabIndex={0}
    className="absolute right-1.5 top-1.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded bg-black/70 text-white opacity-90 transition hover:bg-status-error"
    title={title}
    onClick={(event) => {
      event.stopPropagation();
      onDelete();
    }}
    onKeyDown={(event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      onDelete();
    }}
  >
    <Trash2 className="h-3.5 w-3.5" />
  </span>
);

const RemoveBackgroundButton: React.FC<{
  processing: boolean;
  compact?: boolean;
  onClick: () => void;
}> = ({ processing, compact, onClick }) => (
  <span
    role="button"
    tabIndex={0}
    className={`absolute left-1.5 top-1.5 z-10 inline-flex items-center justify-center gap-1 rounded bg-black/70 text-white opacity-0 transition hover:bg-accent group-hover:opacity-100 ${
      compact ? "h-6 w-6" : "h-6 px-2 text-[10px]"
    }`}
    title="生成透明背景素材"
    onClick={(event) => {
      event.stopPropagation();
      if (!processing) onClick();
    }}
    onKeyDown={(event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      if (!processing) onClick();
    }}
  >
    <Eraser className={`h-3.5 w-3.5 ${processing ? "animate-pulse" : ""}`} />
    {!compact && <span>{processing ? "处理中" : "去背景"}</span>}
  </span>
);

const ConfigStatus: React.FC<{ ready: boolean; label: string }> = ({ ready, label }) => (
  <div className={`rounded px-2 py-1 text-xs ${ready ? "bg-status-success/10 text-status-success" : "bg-bg text-fg-muted"}`}>
    {ready ? `${label}已就绪` : `${label}需要同时配置静止和说话素材`}
  </div>
);

export default AvatarPanel;
