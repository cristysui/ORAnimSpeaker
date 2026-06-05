import type { Clip, MediaItem, Project, Track, Transform } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { analyzeAudioBlob, type AudioSegment } from "./audio-analysis";
import {
  AVATAR_CHARACTER_ID,
  type AvatarActionOverlayMetadata,
  type AvatarGeneratedClipMetadata,
  type AvatarSequenceAction,
  type AvatarSource,
  type AvatarVideoAsset,
  defaultAvatarTransform,
} from "./avatar-types";
import { getAvatarConfig } from "./avatar-project";

const makeId = (prefix: string): string => {
  return `${prefix}-${crypto.randomUUID()}`;
};

const STARTUP_SPEAKING_GRACE_SEC = 2;
const MIN_VIDEO_SEGMENT_DURATION_SEC = 0.35;
const MIN_SEQUENCE_FRAME_DURATION_SEC = 0.001;

const avatarTrackName = (source: AvatarSource): string => {
  return source === "video" ? "人物视频动画" : "人物序列帧动画";
};

const overlayTrackName = (source: AvatarSource): string => {
  return source === "video" ? "人物视频动作覆盖" : "人物序列帧动作覆盖";
};

const createTrack = (type: Track["type"], name: string): Track => ({
  id: makeId("track"),
  type,
  name,
  clips: [],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
});

const createClip = (params: {
  mediaId: string;
  trackId: string;
  startTime: number;
  duration: number;
  inPoint?: number;
  transform?: Transform;
  metadata?: Clip["metadata"];
}): Clip => ({
  id: makeId("clip"),
  mediaId: params.mediaId,
  trackId: params.trackId,
  startTime: params.startTime,
  duration: params.duration,
  inPoint: params.inPoint ?? 0,
  outPoint: (params.inPoint ?? 0) + params.duration,
  effects: [],
  audioEffects: [],
  transform: normalizeAvatarClipTransform(params.transform),
  volume: 1,
  keyframes: [],
  metadata: params.metadata,
});

const normalizeAvatarClipTransform = (transform?: Transform): Transform => ({
  ...defaultAvatarTransform(),
  ...(transform ?? {}),
  position: transform?.position ?? defaultAvatarTransform().position,
  scale: transform?.scale ?? defaultAvatarTransform().scale,
  anchor: transform?.anchor ?? defaultAvatarTransform().anchor,
  opacity: transform?.opacity ?? defaultAvatarTransform().opacity,
  fitMode: "none",
});

export async function generateAvatarFromVideo(audioClipId: string): Promise<void> {
  const state = useProjectStore.getState();
  const project = state.project;
  const audioContext = findClipContext(project, audioClipId);
  if (!audioContext) throw new Error("找不到音频片段");

  const config = getAvatarConfig(project);
  const segments = await getAudioSegments(audioContext.clip, project);
  const metadata: AvatarGeneratedClipMetadata = {
    kind: "avatar-generated",
    source: "video",
    audioClipId,
    characterId: AVATAR_CHARACTER_ID,
  };
  const baseTrack = createTrack("video", avatarTrackName("video"));
  const animationTrack = {
    ...baseTrack,
    clips: createVideoClipsForSegments({
    trackId: baseTrack.id,
    audioStartTime: audioContext.clip.startTime,
    segments,
    idleAssets: config.videoConfig.idle,
    speakingAssets: config.videoConfig.speaking,
    metadata,
    project,
    }),
  };

  insertTrackBefore(project, animationTrack, audioContext.track.id);
}

export async function generateAvatarFromSequence(audioClipId: string): Promise<void> {
  const state = useProjectStore.getState();
  const project = state.project;
  const audioContext = findClipContext(project, audioClipId);
  if (!audioContext) throw new Error("找不到音频片段");

  const config = getAvatarConfig(project);
  const segments = await getAudioSegments(audioContext.clip, project);
  const metadata: AvatarGeneratedClipMetadata = {
    kind: "avatar-generated",
    source: "sequence",
    audioClipId,
    characterId: AVATAR_CHARACTER_ID,
  };
  const baseTrack = createTrack("video", avatarTrackName("sequence"));
  const prepared = await prepareSequenceActionsAsVideoAssets(project, [
    ...config.sequenceConfig.idle,
    ...config.sequenceConfig.speaking,
  ]);
  const idleAssets = config.sequenceConfig.idle
    .map((action) => prepared.assets.get(action.id))
    .filter((asset): asset is AvatarVideoAsset => Boolean(asset));
  const speakingAssets = config.sequenceConfig.speaking
    .map((action) => prepared.assets.get(action.id))
    .filter((asset): asset is AvatarVideoAsset => Boolean(asset));
  const animationTrack = {
    ...baseTrack,
    clips: createVideoClipsForSegments({
      trackId: baseTrack.id,
      audioStartTime: audioContext.clip.startTime,
      segments,
      idleAssets,
      speakingAssets,
      metadata,
      project: {
        ...project,
        mediaLibrary: {
          ...project.mediaLibrary,
          items: [...project.mediaLibrary.items, ...prepared.mediaItems],
        },
      },
    }),
  };

  insertTrackBefore(project, animationTrack, audioContext.track.id, prepared.mediaItems);
}

export async function addAvatarActionOverlay(
  parentClipId: string,
  source: AvatarSource,
  actionId: string,
  options: { startTime?: number } = {},
): Promise<void> {
  const state = useProjectStore.getState();
  const project = state.project;
  const parentContext = findClipContext(project, parentClipId);
  if (!parentContext) throw new Error("找不到角色动画片段");

  const config = getAvatarConfig(project);
  const playhead = options.startTime ?? useTimelineStore.getState().playheadPosition;
  const parentStartTime = parentContext.clip.startTime;
  const parentEndTime = parentContext.clip.startTime + parentContext.clip.duration;
  const startTime = clampTime(playhead, parentStartTime, parentEndTime);
  if (startTime >= parentEndTime) {
    throw new Error("当前播放位置已经超出角色动画片段");
  }
  const metadata: AvatarActionOverlayMetadata = {
    kind: "avatar-action-overlay",
    source,
    parentGeneratedClipId: parentClipId,
    actionId,
  };

  const overlayName = overlayTrackName(source);
  const baseOverlayTrack = createTrack("video", overlayName);
  let overlayClip: Clip | null = null;
  const extraMedia: MediaItem[] = [];
  if (source === "video") {
    const action = config.videoConfig.actions.find((item) => item.id === actionId);
    if (!action) throw new Error("尚未配置该动作视频");
    const mediaItem = project.mediaLibrary.items.find((item) => item.id === action.mediaId);
    const duration = normalizeActionDuration(
      mediaItem?.metadata.duration,
      parentContext.clip.duration,
    );
    overlayClip = createClip({
        mediaId: action.mediaId,
        trackId: baseOverlayTrack.id,
        startTime,
        duration,
        transform: action.transform,
        metadata,
      });
  } else {
    const action = config.sequenceConfig.actions.find((item) => item.id === actionId);
    if (!action) throw new Error("尚未配置该序列帧动作");
    const duration = normalizeActionDuration(
      getSequenceActionDuration(action),
      parentContext.clip.duration,
    );
    const blob = await renderActionSequence(project, action, duration);
    const thumbnailUrl = await createSequenceActionThumbnail(project, action);
    const mediaItem = addGeneratedMediaItem(project, blob, `${action.name}.webm`, {
      duration,
      width: project.settings.width,
      height: project.settings.height,
      thumbnailUrl,
    });
    extraMedia.push(mediaItem);
    overlayClip = createClip({
        mediaId: mediaItem.id,
        trackId: baseOverlayTrack.id,
        startTime,
        duration,
        transform: defaultAvatarTransform(),
        metadata,
      });
  }

  if (!overlayClip) return;
  appendClipToOverlayTrack(project, {
    overlayName,
    baseTrack: baseOverlayTrack,
    targetTrackId: parentContext.track.id,
    clip: overlayClip,
    extraMediaItems: extraMedia,
  });
}

function clampTime(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeActionDuration(value: number | undefined, fallback: number): number {
  const duration = Number.isFinite(value) && value && value > 0 ? value : fallback;
  return Math.max(0.001, duration);
}

async function getAudioSegments(audioClip: Clip, project: Project): Promise<AudioSegment[]> {
  const audioMedia = project.mediaLibrary.items.find((item) => item.id === audioClip.mediaId);
  const segments = await analyzeAudioBlob(audioMedia?.blob, {
    fallbackDuration: audioClip.duration,
    startTime: audioClip.inPoint,
    duration: audioClip.duration,
  });
  return clampSegmentsToDuration(
    normalizeAvatarSegments(normalizeStartupSpeakingSegments(segments)),
    audioClip.duration,
  );
}

function clampSegmentsToDuration(segments: AudioSegment[], duration: number): AudioSegment[] {
  const clamped: AudioSegment[] = [];
  for (const segment of segments) {
    if (segment.startTime >= duration) continue;
    const endTime = Math.min(duration, segment.startTime + segment.duration);
    if (endTime <= segment.startTime) continue;
    clamped.push({
      ...segment,
      duration: endTime - segment.startTime,
    });
  }
  return clamped.length > 0 ? clamped : [{ startTime: 0, duration, state: "speaking" }];
}

function normalizeStartupSpeakingSegments(segments: AudioSegment[]): AudioSegment[] {
  const [first, second, ...rest] = segments;
  if (
    first?.state === "idle" &&
    second?.state === "speaking" &&
    second.startTime <= STARTUP_SPEAKING_GRACE_SEC
  ) {
    return [
      {
        ...second,
        startTime: first.startTime,
        duration: second.startTime + second.duration - first.startTime,
      },
      ...rest,
    ];
  }
  return segments;
}

function normalizeAvatarSegments(segments: AudioSegment[]): AudioSegment[] {
  const merged: AudioSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous?.state === segment.state) {
      previous.duration = segment.startTime + segment.duration - previous.startTime;
      continue;
    }
    if (previous && segment.duration < MIN_VIDEO_SEGMENT_DURATION_SEC) {
      previous.duration = segment.startTime + segment.duration - previous.startTime;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

function createVideoClipsForSegments(params: {
  trackId: string;
  audioStartTime: number;
  segments: AudioSegment[];
  idleAssets: AvatarVideoAsset[];
  speakingAssets: AvatarVideoAsset[];
  metadata: AvatarGeneratedClipMetadata;
  project: Project;
}): Clip[] {
  const clips: Clip[] = [];
  params.segments.forEach((segment, segmentIndex) => {
    const pool = segment.state === "speaking" ? params.speakingAssets : params.idleAssets;
    if (pool.length === 0) return;

    let remaining = segment.duration;
    let cursor = params.audioStartTime + segment.startTime;
    let repeatIndex = 0;
    while (remaining > 0.01) {
      const asset = pool[(segmentIndex + repeatIndex) % pool.length];
      const mediaItem = params.project.mediaLibrary.items.find((item) => item.id === asset.mediaId);
      const sourceDuration = mediaItem?.metadata.duration || remaining;
      const duration = Math.min(remaining, sourceDuration || remaining);
      clips.push(
        createClip({
          mediaId: asset.mediaId,
          trackId: params.trackId,
          startTime: cursor,
          duration,
          transform: asset.transform,
          metadata: {
            ...params.metadata,
            actionName: asset.name,
            actionKind: asset.kind,
            ...(params.metadata.source === "sequence" && asset.id.startsWith("sequence-video-")
              ? { sequenceActionId: asset.id.slice("sequence-video-".length) }
              : {}),
          },
        }),
      );
      cursor += duration;
      remaining -= duration;
      repeatIndex += 1;
    }
  });
  return clips;
}

async function prepareSequenceActionsAsVideoAssets(
  project: Project,
  actions: AvatarSequenceAction[],
): Promise<{ assets: Map<string, AvatarVideoAsset>; mediaItems: MediaItem[] }> {
  const assets = new Map<string, AvatarVideoAsset>();
  const mediaItems: MediaItem[] = [];
  const uniqueActions = Array.from(new Map(actions.map((action) => [action.id, action])).values());

  for (const action of uniqueActions) {
    if (!action || action.frames.length === 0) continue;

    const duration = 5;
    const framePlan = expandActionFrames(action, duration);
    const blob = await encodeFramePlanVideo(project, framePlan, duration, action.transform);
    const thumbnailUrl = await createSequenceActionThumbnail(project, action);
    const mediaItem = addGeneratedMediaItem(
      project,
      blob,
      `${action.name}-sequence-action.webm`,
      {
        duration,
        width: project.settings.width,
        height: project.settings.height,
        thumbnailUrl,
      },
    );
    mediaItems.push(mediaItem);
    assets.set(action.id, {
      id: `sequence-video-${action.id}`,
      mediaId: mediaItem.id,
      name: action.name,
      kind: action.kind,
      transform: defaultAvatarTransform(),
    });
  }

  return { assets, mediaItems };
}

function findClipContext(project: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

function insertTrackBefore(
  project: Project,
  newTrack: Track,
  targetTrackId: string,
  extraMediaItems: MediaItem[] = [],
): void {
  const targetIndex = project.timeline.tracks.findIndex((track) => track.id === targetTrackId);
  const nextTracks = [...project.timeline.tracks];
  nextTracks.splice(Math.max(0, targetIndex), 0, newTrack);
  const timelineDuration = Math.max(
    project.timeline.duration,
    ...nextTracks.flatMap((track) => track.clips.map((clip) => clip.startTime + clip.duration)),
    0,
  );

  useProjectStore.setState({
    project: {
      ...project,
      mediaLibrary: {
        ...project.mediaLibrary,
        items: [...project.mediaLibrary.items, ...extraMediaItems],
      },
      timeline: {
        ...project.timeline,
        tracks: nextTracks,
        duration: timelineDuration,
      },
      modifiedAt: Date.now(),
    },
  });
}

function appendClipToOverlayTrack(
  project: Project,
  params: {
    overlayName: string;
    baseTrack: Track;
    targetTrackId: string;
    clip: Clip;
    extraMediaItems: MediaItem[];
  },
): void {
  const existingTrack = project.timeline.tracks.find((track) => {
    return (
      track.name === params.overlayName ||
      track.clips.some((clip) => clip.metadata?.kind === "avatar-action-overlay")
    );
  });
  const targetTrackId = existingTrack?.id ?? params.baseTrack.id;
  const nextClip = { ...params.clip, trackId: targetTrackId };
  let nextTracks: Track[];

  if (existingTrack) {
    nextTracks = project.timeline.tracks.map((track) =>
      track.id === existingTrack.id
        ? { ...track, clips: [...track.clips, nextClip] }
        : track,
    );
  } else {
    const newTrack = {
      ...params.baseTrack,
      clips: [nextClip],
    };
    const targetIndex = project.timeline.tracks.findIndex(
      (track) => track.id === params.targetTrackId,
    );
    nextTracks = [...project.timeline.tracks];
    nextTracks.splice(Math.max(0, targetIndex), 0, newTrack);
  }

  const timelineDuration = Math.max(
    project.timeline.duration,
    ...nextTracks.flatMap((track) => track.clips.map((clip) => clip.startTime + clip.duration)),
    0,
  );

  useProjectStore.setState({
    project: {
      ...project,
      mediaLibrary: {
        ...project.mediaLibrary,
        items: [...project.mediaLibrary.items, ...params.extraMediaItems],
      },
      timeline: {
        ...project.timeline,
        tracks: nextTracks,
        duration: timelineDuration,
      },
      modifiedAt: Date.now(),
    },
  });
}

function addGeneratedMediaItem(
  project: Project,
  blob: Blob,
  name: string,
  metadata: { duration: number; width: number; height: number; thumbnailUrl?: string | null },
): MediaItem {
  return {
    id: makeId("media"),
    name,
    type: "video",
    fileHandle: null,
    blob,
    metadata: {
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      frameRate: project.settings.frameRate,
      codec: "webm",
      sampleRate: project.settings.sampleRate,
      channels: project.settings.channels,
      fileSize: blob.size,
    },
    thumbnailUrl: metadata.thumbnailUrl ?? null,
    waveformData: null,
    originalUrl: URL.createObjectURL(blob),
    sourceFile: {
      name,
      size: blob.size,
      lastModified: Date.now(),
    },
  };
}

async function renderActionSequence(
  project: Project,
  action: AvatarSequenceAction,
  duration: number,
): Promise<Blob> {
  return encodeFramePlanVideo(project, expandActionFrames(action, duration), duration, action.transform);
}

function expandActionFrames(action: AvatarSequenceAction, targetDuration: number): { mediaId: string; duration: number }[] {
  const frames = action.frames;
  if (frames.length === 0) return [];
  const plan: { mediaId: string; duration: number }[] = [];
  let cursor = 0;
  let index = 0;
  while (cursor < targetDuration - 0.001) {
    const frame = frames[index % frames.length];
    const duration = Math.min(frame.durationSec ?? action.frameDurationSec, targetDuration - cursor);
    plan.push({ mediaId: frame.mediaId, duration });
    cursor += duration;
    index += 1;
  }
  return plan;
}

function getSequenceActionDuration(action: AvatarSequenceAction): number {
  return action.frames.reduce(
    (total, frame) => total + (frame.durationSec ?? action.frameDurationSec),
    0,
  );
}

function drawFrameWithTransform(
  context: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  transform: Transform,
  canvasWidth: number,
  canvasHeight: number,
): void {
  context.save();
  context.globalAlpha = transform.opacity ?? 1;
  context.translate(
    canvasWidth / 2 + (transform.position?.x ?? 0),
    canvasHeight / 2 + (transform.position?.y ?? 0),
  );
  context.rotate(((transform.rotation ?? 0) * Math.PI) / 180);
  context.scale(transform.scale?.x ?? 1, transform.scale?.y ?? 1);

  const anchor = transform.anchor ?? { x: 0.5, y: 0.5 };
  const drawX = -bitmap.width * anchor.x;
  const drawY = -bitmap.height * anchor.y;
  context.drawImage(bitmap, drawX, drawY, bitmap.width, bitmap.height);
  context.restore();
}

async function createSequenceActionThumbnail(
  project: Project,
  action: AvatarSequenceAction,
): Promise<string | null> {
  const firstFrame = action.frames[0];
  if (!firstFrame) return null;
  const media = project.mediaLibrary.items.find((item) => item.id === firstFrame.mediaId);
  if (!media?.blob) return null;

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = project.settings.width;
  sourceCanvas.height = project.settings.height;
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) return null;

  const thumbnailCanvas = document.createElement("canvas");
  thumbnailCanvas.width = 320;
  thumbnailCanvas.height = Math.max(
    1,
    Math.round((project.settings.height / project.settings.width) * thumbnailCanvas.width),
  );
  const thumbnailContext = thumbnailCanvas.getContext("2d");
  if (!thumbnailContext) return null;

  try {
    const bitmap = await createImageBitmap(media.blob);
    sourceContext.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    drawFrameWithTransform(
      sourceContext,
      bitmap,
      action.transform,
      sourceCanvas.width,
      sourceCanvas.height,
    );
    thumbnailContext.clearRect(0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
    thumbnailContext.drawImage(
      sourceCanvas,
      0,
      0,
      thumbnailCanvas.width,
      thumbnailCanvas.height,
    );
    bitmap.close();
    return thumbnailCanvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

async function encodeFramePlanVideo(
  project: Project,
  framePlan: { mediaId: string; duration: number }[],
  fallbackDuration: number,
  transform: Transform = defaultAvatarTransform(),
): Promise<Blob> {
  const mediabunny = await import("mediabunny");
  const {
    Output,
    WebMOutputFormat,
    BufferTarget,
    CanvasSource,
    getFirstEncodableVideoCodec,
    QUALITY_MEDIUM,
  } = mediabunny;

  const canvas = document.createElement("canvas");
  canvas.width = project.settings.width;
  canvas.height = project.settings.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建序列帧画布");

  const outputFormat = new WebMOutputFormat();
  const output = new Output({
    format: outputFormat,
    target: new BufferTarget(),
  });
  const videoCodec = await getFirstEncodableVideoCodec(
    outputFormat.getSupportedVideoCodecs(),
    { width: canvas.width, height: canvas.height },
  );
  if (!videoCodec) {
    throw new Error("当前浏览器不支持序列帧视频编码");
  }
  const videoSource = new CanvasSource(canvas, {
    codec: videoCodec,
    bitrate: QUALITY_MEDIUM,
    alpha: "keep",
  });
  output.addVideoTrack(videoSource, {
    frameRate: Math.max(1, project.settings.frameRate || 30),
  });

  await output.start();

  const mediaById = new Map(project.mediaLibrary.items.map((item) => [item.id, item]));
  const plan = framePlan.length > 0
    ? framePlan
    : [{ mediaId: "", duration: fallbackDuration }];
  let timestamp = 0;

  for (const frame of plan) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const media = mediaById.get(frame.mediaId);
    if (media?.blob) {
      const bitmap = await createImageBitmap(media.blob);
      drawFrameWithTransform(context, bitmap, transform, canvas.width, canvas.height);
      bitmap.close();
    }

    const duration = Math.max(MIN_SEQUENCE_FRAME_DURATION_SEC, frame.duration);
    await videoSource.add(timestamp, duration);
    timestamp += duration;
  }

  videoSource.close();
  await output.finalize();
  if (!output.target.buffer) {
    throw new Error("序列帧视频编码失败");
  }
  return new Blob([output.target.buffer], { type: "video/webm" });
}
