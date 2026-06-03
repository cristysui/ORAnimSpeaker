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
  const baseTrack = createTrack("image", avatarTrackName("sequence"));
  const animationTrack = {
    ...baseTrack,
    clips: createSequenceClipsForSegments({
      trackId: baseTrack.id,
      audioStartTime: audioContext.clip.startTime,
      segments,
      idleActions: config.sequenceConfig.idle,
      speakingActions: config.sequenceConfig.speaking,
      metadata,
    }),
  };

  insertTrackBefore(project, animationTrack, audioContext.track.id);
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
    const blob = await renderActionSequence(project, action);
    const mediaItem = addGeneratedMediaItem(project, blob, `${action.name}.webm`, {
      duration,
      width: project.settings.width,
      height: project.settings.height,
    });
    extraMedia.push(mediaItem);
    overlayClip = createClip({
        mediaId: mediaItem.id,
        trackId: baseOverlayTrack.id,
        startTime,
        duration,
        transform: action.transform,
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
          metadata: params.metadata,
        }),
      );
      cursor += duration;
      remaining -= duration;
      repeatIndex += 1;
    }
  });
  return clips;
}

function createSequenceClipsForSegments(params: {
  trackId: string;
  audioStartTime: number;
  segments: AudioSegment[];
  idleActions: AvatarSequenceAction[];
  speakingActions: AvatarSequenceAction[];
  metadata: AvatarGeneratedClipMetadata;
}): Clip[] {
  const clips: Clip[] = [];
  params.segments.forEach((segment, segmentIndex) => {
    const pool = segment.state === "speaking" ? params.speakingActions : params.idleActions;
    const action = pool[segmentIndex % Math.max(1, pool.length)];
    if (!action || action.frames.length === 0) return;

    let cursor = roundClipTime(params.audioStartTime + segment.startTime);
    const segmentEnd = roundClipTime(params.audioStartTime + segment.startTime + segment.duration);
    let frameIndex = 0;
    while (segmentEnd - cursor > MIN_SEQUENCE_FRAME_DURATION_SEC) {
      const frame = action.frames[frameIndex % action.frames.length];
      const frameDuration = Math.max(
        MIN_SEQUENCE_FRAME_DURATION_SEC,
        frame.durationSec ?? action.frameDurationSec,
      );
      const nextCursor = roundClipTime(Math.min(segmentEnd, cursor + frameDuration));
      const duration = Math.max(MIN_SEQUENCE_FRAME_DURATION_SEC, nextCursor - cursor);
      clips.push(
        createClip({
          mediaId: frame.mediaId,
          trackId: params.trackId,
          startTime: cursor,
          duration,
          transform: action.transform,
          metadata: params.metadata,
        }),
      );
      cursor = nextCursor;
      frameIndex += 1;
    }
  });
  return clips;
}

function roundClipTime(value: number): number {
  return Math.round(value * 1000) / 1000;
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
  metadata: { duration: number; width: number; height: number },
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
    thumbnailUrl: null,
    waveformData: null,
    originalUrl: URL.createObjectURL(blob),
    sourceFile: {
      name,
      size: blob.size,
      lastModified: Date.now(),
    },
  };
}

async function renderActionSequence(project: Project, action: AvatarSequenceAction): Promise<Blob> {
  return recordFramePlan(project, expandActionFrames(action, getSequenceActionDuration(action)), getSequenceActionDuration(action));
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

async function recordFramePlan(
  project: Project,
  framePlan: { mediaId: string; duration: number }[],
  fallbackDuration: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = project.settings.width;
  canvas.height = project.settings.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建序列帧画布");

  const stream = canvas.captureStream(project.settings.frameRate);
  const recorder = new MediaRecorder(stream, {
    mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm",
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const mediaById = new Map(project.mediaLibrary.items.map((item) => [item.id, item]));
  try {
    recorder.start();

    const plan = framePlan.length > 0
      ? framePlan
      : [{ mediaId: "", duration: fallbackDuration }];
    for (const frame of plan) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      const media = mediaById.get(frame.mediaId);
      if (media?.blob) {
        const bitmap = await createImageBitmap(media.blob);
        drawContain(context, bitmap, canvas.width, canvas.height);
        bitmap.close();
      }
      await wait(frame.duration * 1000);
    }

    const stopped = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
    });
    recorder.stop();
    return stopped;
  } finally {
    if (recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Recorder may already be stopping after a successful render.
      }
    }
    stream.getTracks().forEach((track) => track.stop());
  }
}

function drawContain(
  context: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  width: number,
  height: number,
): void {
  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  context.drawImage(
    bitmap,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
