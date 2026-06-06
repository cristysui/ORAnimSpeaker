import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaItem, Transform } from "@openreel/core";
import { Move } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import {
  getAvatarConfig,
  updateAvatarSequenceActionTransform,
  updateAvatarSequenceFrameTransform,
  updateAvatarVideoAssetTransform,
} from "./avatar-project";
import { useAvatarSelectionStore } from "./avatar-selection-store";
import { useAvatarAlignmentStore } from "./avatar-alignment-store";
import type {
  AvatarActionKind,
  AvatarSequenceAction,
  AvatarVideoAsset,
} from "./avatar-types";
import { defaultAvatarTransform } from "./avatar-types";

export const AVATAR_KIND_LABELS: Record<AvatarActionKind, string> = {
  idle: "静止",
  speaking: "说话",
  action: "手动动作",
};

interface DragState {
  startX: number;
  startY: number;
  transform: Transform;
  mode: "move" | "scale";
}

export interface AvatarConfigItem {
  id: string;
  source: "video" | "sequence" | "sequence-frame";
  actionId?: string;
  name: string;
  kind: AvatarActionKind;
  mediaId?: string;
  transform: Transform;
  previewTransform: Transform;
}

export interface SubjectBox {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

export const AvatarConfigStageOverlay: React.FC<{
  frameWidth: number;
  frameHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}> = ({ frameWidth, frameHeight, canvasWidth, canvasHeight }) => {
  const project = useProjectStore((state) => state.project);
  const selectedClipIds = useUIStore((state) => state.getSelectedClipIds());
  const selectedConfig = useAvatarSelectionStore((state) => state.selectedConfig);
  const config = useMemo(() => getAvatarConfig(project), [project]);
  const dragRef = useRef<DragState | null>(null);
  const referenceKey = useAvatarAlignmentStore((state) => state.referenceKey);
  const setReferenceKey = useAvatarAlignmentStore((state) => state.setReferenceKey);
  const showOnionSkin = useAvatarAlignmentStore((state) => state.showOnionSkin);
  const referenceOpacity = useAvatarAlignmentStore((state) => state.referenceOpacity);

  const allItems = useMemo(() => {
    return [
      ...config.videoConfig.idle.map((item) => videoItemToConfig(item)),
      ...config.videoConfig.speaking.map((item) => videoItemToConfig(item)),
      ...config.videoConfig.actions.map((item) => videoItemToConfig(item)),
      ...config.sequenceConfig.idle.map((item) => sequenceItemToConfig(item)),
      ...config.sequenceConfig.speaking.map((item) => sequenceItemToConfig(item)),
      ...config.sequenceConfig.actions.map((item) => sequenceItemToConfig(item)),
      ...config.sequenceConfig.idle.flatMap((item) => sequenceFrameItemsToConfig(item)),
      ...config.sequenceConfig.speaking.flatMap((item) => sequenceFrameItemsToConfig(item)),
      ...config.sequenceConfig.actions.flatMap((item) => sequenceFrameItemsToConfig(item)),
    ];
  }, [config]);

  const selectedItem = useMemo(() => {
    if (!selectedConfig) return null;
    return allItems.find((item) => {
      if (item.source !== selectedConfig.source || item.id !== selectedConfig.id) return false;
      if (selectedConfig.source !== "sequence-frame") return true;
      return item.actionId === selectedConfig.actionId;
    }) ?? null;
  }, [allItems, selectedConfig]);

  const selectedKey = selectedItem ? itemKey(selectedItem) : "";
  const referenceItems = useMemo(() => {
    return allItems.filter((item) => item.mediaId && itemKey(item) !== selectedKey);
  }, [allItems, selectedKey]);

  useEffect(() => {
    if (referenceItems.length === 0) {
      setReferenceKey("");
      return;
    }
    if (referenceItems.some((item) => itemKey(item) === referenceKey)) return;

    const preferred =
      selectedItem?.kind === "idle"
        ? referenceItems.find((item) => item.kind === "speaking")
        : referenceItems.find((item) => item.kind === "idle");
    setReferenceKey(itemKey(preferred ?? referenceItems[0]));
  }, [referenceItems, referenceKey, selectedItem?.kind]);

  const referenceItem = useMemo(() => {
    return referenceItems.find((item) => itemKey(item) === referenceKey) ?? null;
  }, [referenceItems, referenceKey]);

  const media = useMemo(
    () => project.mediaLibrary.items.find((item) => item.id === selectedItem?.mediaId),
    [project.mediaLibrary.items, selectedItem?.mediaId],
  );

  const referenceMedia = useMemo(
    () => project.mediaLibrary.items.find((item) => item.id === referenceItem?.mediaId),
    [project.mediaLibrary.items, referenceItem?.mediaId],
  );

  const transform = selectedItem?.transform;
  const previewTransform = selectedItem?.previewTransform;
  const stageScale = Math.min(frameWidth / canvasWidth, frameHeight / canvasHeight);

  const updateTransform = useCallback((nextTransform: Transform) => {
    if (!selectedConfig) return;
    if (selectedConfig.source === "video") {
      updateAvatarVideoAssetTransform(selectedConfig.id, nextTransform);
    } else if (selectedConfig.source === "sequence") {
      updateAvatarSequenceActionTransform(selectedConfig.id, nextTransform);
    } else {
      updateAvatarSequenceFrameTransform(
        selectedConfig.actionId,
        selectedConfig.id,
        nextTransform,
      );
    }
  }, [selectedConfig]);

  const beginDrag = (event: React.MouseEvent, mode: DragState["mode"]) => {
    if (!transform) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      transform: structuredClone(transform),
      mode,
    };
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", endDrag, { once: true });
  };

  const onDrag = (event: MouseEvent) => {
    const drag = dragRef.current;
    if (!drag || !media) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (drag.mode === "move") {
      updateTransform({
        ...drag.transform,
        position: {
          x: drag.transform.position.x + dx / stageScale,
          y: drag.transform.position.y + dy / stageScale,
        },
      });
      return;
    }

    const naturalWidth = media.metadata.width || canvasWidth * 0.35;
    const naturalHeight = media.metadata.height || canvasHeight * 0.35;
    const displayWidth = naturalWidth * stageScale * drag.transform.scale.x;
    const displayHeight = naturalHeight * stageScale * drag.transform.scale.y;
    const scaleDelta = Math.max(dx, dy) / Math.max(80, Math.min(displayWidth, displayHeight));
    const nextScale = Math.max(0.05, drag.transform.scale.x + scaleDelta);
    updateTransform({
      ...drag.transform,
      scale: { x: nextScale, y: nextScale },
    });
  };

  const endDrag = () => {
    dragRef.current = null;
    window.removeEventListener("mousemove", onDrag);
  };

  if (
    selectedClipIds.length > 0 ||
    !selectedConfig ||
    !selectedItem ||
    !media ||
    !transform ||
    !previewTransform ||
    frameWidth <= 0 ||
    frameHeight <= 0
  ) {
    return null;
  }

  const currentLayout = layoutForMedia(media, previewTransform, stageScale, frameWidth, frameHeight, canvasWidth, canvasHeight);
  const referenceLayout = referenceMedia && referenceItem
    ? layoutForMedia(referenceMedia, referenceItem.previewTransform, stageScale, frameWidth, frameHeight, canvasWidth, canvasHeight)
    : null;

  return (
    <div className="absolute inset-0 z-40 pointer-events-none">
      <div
        data-avatar-selection-keep
        className="absolute pointer-events-auto"
        style={{
          left: currentLayout.left,
          top: currentLayout.top,
          width: currentLayout.width,
          height: currentLayout.height,
          opacity: transform.opacity,
          transform: `rotate(${previewTransform.rotation}deg)`,
          transformOrigin: "center",
        }}
      >
        <div className="relative h-full w-full border-2 border-accent bg-black/20">
          <MediaPreview media={media} name={selectedItem.name} />
          <button
            className="absolute left-1/2 top-1/2 z-30 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-white shadow"
            onMouseDown={(event) => beginDrag(event, "move")}
            title="拖动调整默认位置"
          >
            <Move className="h-4 w-4" />
          </button>
          <button
            className="absolute -bottom-2 -right-2 z-30 h-4 w-4 rounded-sm border-2 border-white bg-accent shadow"
            onMouseDown={(event) => beginDrag(event, "scale")}
            title="拖动调整默认尺寸"
          />
        </div>
      </div>

      {showOnionSkin && referenceItem && referenceMedia && referenceLayout && (
        <div
          className="absolute z-20 border border-dashed border-accent/80 bg-accent/10 pointer-events-none mix-blend-normal"
          style={{
            left: referenceLayout.left,
            top: referenceLayout.top,
            width: referenceLayout.width,
            height: referenceLayout.height,
            opacity: referenceOpacity,
            transform: `rotate(${referenceItem.previewTransform.rotation}deg)`,
            transformOrigin: "center",
          }}
        >
          <MediaPreview media={referenceMedia} name={referenceItem.name} />
        </div>
      )}
    </div>
  );
};

const MediaPreview: React.FC<{ media: MediaItem; name: string }> = ({ media, name }) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!media.blob) {
      setObjectUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(media.blob);
    setObjectUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [media.blob]);

  const url = media.originalUrl || objectUrl;
  if (!url) return null;
  return media.type === "video" ? (
    <video src={url} muted playsInline loop autoPlay className="h-full w-full object-contain" />
  ) : (
    <img src={url} alt={name} className="h-full w-full object-contain" />
  );
};

export function videoItemToConfig(item: AvatarVideoAsset): AvatarConfigItem {
  return {
    id: item.id,
    source: "video",
    name: item.name,
    kind: item.kind,
    mediaId: item.mediaId,
    transform: item.transform,
    previewTransform: item.transform,
  };
}

export function sequenceItemToConfig(item: AvatarSequenceAction): AvatarConfigItem {
  return {
    id: item.id,
    source: "sequence",
    name: item.name,
    kind: item.kind,
    mediaId: item.frames[0]?.mediaId,
    transform: item.transform,
    previewTransform: item.transform,
  };
}

export function sequenceFrameItemsToConfig(item: AvatarSequenceAction): AvatarConfigItem[] {
  return item.frames.map((frame, index) => {
    const relativeTransform = frame.transform ?? defaultAvatarTransform();
    return {
      id: frame.id,
      actionId: item.id,
      source: "sequence-frame",
      name: `${item.name} #${index + 1}`,
      kind: item.kind,
      mediaId: frame.mediaId,
      transform: relativeTransform,
      previewTransform: combineAvatarTransforms(item.transform, relativeTransform),
    };
  });
}

export function combineAvatarTransforms(
  base: Transform,
  relative: Transform,
): Transform {
  return {
    ...base,
    position: {
      x: base.position.x + relative.position.x,
      y: base.position.y + relative.position.y,
    },
    scale: {
      x: base.scale.x * relative.scale.x,
      y: base.scale.y * relative.scale.y,
    },
    rotation: base.rotation + relative.rotation,
    anchor: relative.anchor ?? base.anchor,
    opacity: base.opacity * relative.opacity,
    fitMode: relative.fitMode ?? base.fitMode,
    crop: relative.crop ?? base.crop,
  };
}

export function itemKey(item: Pick<AvatarConfigItem, "source" | "id" | "actionId">): string {
  return item.source === "sequence-frame"
    ? `${item.source}:${item.actionId}:${item.id}`
    : `${item.source}:${item.id}`;
}

function layoutForMedia(
  media: MediaItem,
  transform: Transform,
  stageScale: number,
  frameWidth: number,
  frameHeight: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  const naturalWidth = media.metadata.width || canvasWidth * 0.35;
  const naturalHeight = media.metadata.height || canvasHeight * 0.35;
  const width = naturalWidth * stageScale * transform.scale.x;
  const height = naturalHeight * stageScale * transform.scale.y;
  return {
    width,
    height,
    left: frameWidth / 2 + transform.position.x * stageScale - width / 2,
    top: frameHeight / 2 + transform.position.y * stageScale - height / 2,
  };
}

export function subjectCenterOnCanvas(box: SubjectBox, transform: Transform, canvasWidth: number, canvasHeight: number) {
  return {
    x: canvasWidth / 2 + transform.position.x + transform.scale.x * (box.x + box.width / 2 - box.sourceWidth * (transform.anchor?.x ?? 0.5)),
    y: canvasHeight / 2 + transform.position.y + transform.scale.y * (box.y + box.height / 2 - box.sourceHeight * (transform.anchor?.y ?? 0.5)),
  };
}

export async function detectSubjectBox(media: MediaItem): Promise<SubjectBox | null> {
  if (!media.blob) return null;
  const canvas = await renderMediaFirstFrame(media);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return findSubjectBox(imageData, canvas.width, canvas.height);
}

async function renderMediaFirstFrame(media: MediaItem): Promise<HTMLCanvasElement> {
  if (!media.blob) throw new Error("Media blob is missing");
  if (media.type === "video") {
    return renderVideoFirstFrame(media.blob);
  }
  const bitmap = await createImageBitmap(media.blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create canvas context");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

function renderVideoFirstFrame(blob: Blob): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(blob);
    let settled = false;

    const cleanup = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };

    const finish = () => {
      if (settled || video.videoWidth <= 0 || video.videoHeight <= 0) return;
      settled = true;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        cleanup();
        reject(new Error("Unable to create canvas context"));
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      cleanup();
      resolve(canvas);
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadeddata = finish;
    video.onseeked = finish;
    video.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Unable to read video frame"));
    };
    video.src = url;
    video.load();
  });
}

function findSubjectBox(imageData: ImageData, width: number, height: number): SubjectBox | null {
  const data = imageData.data;
  const border = estimateBorderColor(data, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;

  const stride = 2;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      if (alpha < 24) continue;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const colorDistance = Math.hypot(r - border.r, g - border.g, b - border.b);
      const brightNeutral = r > 235 && g > 235 && b > 235 && Math.max(r, g, b) - Math.min(r, g, b) < 18;
      if (colorDistance < 34 || brightNeutral) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;
    }
  }

  const minPixels = Math.max(16, (width * height) / 2000);
  if (count < minPixels || maxX <= minX || maxY <= minY) return null;

  const padding = 3;
  return {
    x: Math.max(0, minX - padding),
    y: Math.max(0, minY - padding),
    width: Math.min(width - minX, maxX - minX + padding * 2),
    height: Math.min(height - minY, maxY - minY + padding * 2),
    sourceWidth: width,
    sourceHeight: height,
  };
}

function estimateBorderColor(data: Uint8ClampedArray, width: number, height: number) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const sample = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 24) return;
    r += data[index];
    g += data[index + 1];
    b += data[index + 2];
    count += 1;
  };
  const step = Math.max(1, Math.floor(Math.min(width, height) / 80));
  for (let x = 0; x < width; x += step) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    sample(0, y);
    sample(width - 1, y);
  }
  if (count === 0) return { r: 255, g: 255, b: 255 };
  return { r: r / count, g: g / count, b: b / count };
}

export default AvatarConfigStageOverlay;
