import type { Transform } from "@openreel/core";

export type AvatarSource = "video" | "sequence";

export type AvatarActionKind = "idle" | "speaking" | "action";

export interface AvatarVideoAsset {
  id: string;
  mediaId: string;
  name: string;
  kind: AvatarActionKind;
  transform: Transform;
}

export interface AvatarSequenceFrame {
  id: string;
  mediaId: string;
  name: string;
  durationSec?: number;
}

export interface AvatarSequenceAction {
  id: string;
  name: string;
  kind: AvatarActionKind;
  frameDurationSec: number;
  frames: AvatarSequenceFrame[];
  transform: Transform;
}

export interface AvatarConfig {
  videoConfig: {
    idle: AvatarVideoAsset[];
    speaking: AvatarVideoAsset[];
    actions: AvatarVideoAsset[];
  };
  sequenceConfig: {
    idle: AvatarSequenceAction[];
    speaking: AvatarSequenceAction[];
    actions: AvatarSequenceAction[];
  };
}

export interface AvatarGeneratedClipMetadata {
  kind: "avatar-generated";
  source: AvatarSource;
  audioClipId: string;
  characterId: string;
  [key: string]: unknown;
}

export interface AvatarActionOverlayMetadata {
  kind: "avatar-action-overlay";
  source: AvatarSource;
  parentGeneratedClipId: string;
  actionId: string;
  [key: string]: unknown;
}

export const AVATAR_CHARACTER_ID = "default-avatar";

export const DEFAULT_FRAME_DURATION_SEC = 0.4;

export const defaultAvatarTransform = (): Transform => ({
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
  fitMode: "none",
});
