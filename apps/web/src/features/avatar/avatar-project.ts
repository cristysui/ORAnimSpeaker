import type { Project, Transform } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useAvatarSelectionStore } from "./avatar-selection-store";
import {
  type AvatarConfig,
  type AvatarSequenceAction,
  type AvatarSequenceFrame,
  type AvatarVideoAsset,
} from "./avatar-types";

type ProjectWithAvatar = Project & {
  metadata?: {
    avatar?: AvatarConfig;
    [key: string]: unknown;
  };
};

export const createEmptyAvatarConfig = (): AvatarConfig => ({
  videoConfig: {
    idle: [],
    speaking: [],
    actions: [],
  },
  sequenceConfig: {
    idle: [],
    speaking: [],
    actions: [],
  },
});

export const getAvatarConfig = (project: Project): AvatarConfig => {
  return (project as ProjectWithAvatar).metadata?.avatar ?? createEmptyAvatarConfig();
};

export const hasVideoConfig = (config: AvatarConfig): boolean => {
  return config.videoConfig.idle.length > 0 && config.videoConfig.speaking.length > 0;
};

export const hasSequenceConfig = (config: AvatarConfig): boolean => {
  return (
    config.sequenceConfig.idle.some((action) => action.frames.length > 0) &&
    config.sequenceConfig.speaking.some((action) => action.frames.length > 0)
  );
};

export const getAvatarActions = (config: AvatarConfig) => {
  return {
    video: config.videoConfig.actions,
    sequence: config.sequenceConfig.actions,
  };
};

export const saveAvatarConfig = (nextConfig: AvatarConfig): void => {
  const { actionHistory, project } = useProjectStore.getState();
  const projectWithAvatar = project as ProjectWithAvatar;
  const previousMetadata = projectWithAvatar.metadata;
  const nextMetadata = {
    ...(previousMetadata ?? {}),
    avatar: nextConfig,
  };

  actionHistory.push(
    {
      type: "project/updateMetadata",
      id: `avatar-config-${crypto.randomUUID()}`,
      timestamp: Date.now(),
      params: { metadata: nextMetadata },
    },
    {
      type: "project/updateMetadata",
      id: `inverse-avatar-config-${crypto.randomUUID()}`,
      timestamp: Date.now(),
      params: { metadata: previousMetadata },
    },
  );

  useProjectStore.setState({
    project: {
      ...project,
      metadata: nextMetadata,
      modifiedAt: Date.now(),
    } as Project,
  });
};

export const appendAvatarVideoAssets = (
  assets: AvatarVideoAsset[],
): AvatarConfig => {
  const config = getAvatarConfig(useProjectStore.getState().project);
  const nextConfig = structuredClone(config);
  for (const asset of assets) {
    nextConfig.videoConfig[asset.kind === "action" ? "actions" : asset.kind].push(asset);
  }
  saveAvatarConfig(nextConfig);
  return nextConfig;
};

export const appendAvatarSequenceAction = (
  action: AvatarSequenceAction,
): AvatarConfig => {
  const config = getAvatarConfig(useProjectStore.getState().project);
  const nextConfig = structuredClone(config);
  nextConfig.sequenceConfig[action.kind === "action" ? "actions" : action.kind].push(action);
  saveAvatarConfig(nextConfig);
  return nextConfig;
};

export const removeAvatarVideoAsset = (assetId: string): void => {
  const config = getAvatarConfig(useProjectStore.getState().project);
  const nextConfig = structuredClone(config);
  nextConfig.videoConfig.idle = nextConfig.videoConfig.idle.filter((item) => item.id !== assetId);
  nextConfig.videoConfig.speaking = nextConfig.videoConfig.speaking.filter(
    (item) => item.id !== assetId,
  );
  nextConfig.videoConfig.actions = nextConfig.videoConfig.actions.filter(
    (item) => item.id !== assetId,
  );
  saveAvatarConfig(nextConfig);
  const selection = useAvatarSelectionStore.getState().selectedConfig;
  if (selection?.source === "video" && selection.id === assetId) {
    useAvatarSelectionStore.getState().clearConfigSelection();
  }
};

export const removeAvatarSequenceAction = (actionId: string): void => {
  const config = getAvatarConfig(useProjectStore.getState().project);
  const nextConfig = structuredClone(config);
  nextConfig.sequenceConfig.idle = nextConfig.sequenceConfig.idle.filter(
    (item) => item.id !== actionId,
  );
  nextConfig.sequenceConfig.speaking = nextConfig.sequenceConfig.speaking.filter(
    (item) => item.id !== actionId,
  );
  nextConfig.sequenceConfig.actions = nextConfig.sequenceConfig.actions.filter(
    (item) => item.id !== actionId,
  );
  saveAvatarConfig(nextConfig);
  const selection = useAvatarSelectionStore.getState().selectedConfig;
  if (selection?.source === "sequence" && selection.id === actionId) {
    useAvatarSelectionStore.getState().clearConfigSelection();
  }
};

export const updateAvatarVideoAssetName = (
  assetId: string,
  name: string,
): void => {
  const config = getAvatarConfig(useProjectStore.getState().project);
  const nextConfig = structuredClone(config);
  const update = (items: AvatarVideoAsset[]) =>
    items.map((item) => (item.id === assetId ? { ...item, name } : item));
  nextConfig.videoConfig.idle = update(nextConfig.videoConfig.idle);
  nextConfig.videoConfig.speaking = update(nextConfig.videoConfig.speaking);
  nextConfig.videoConfig.actions = update(nextConfig.videoConfig.actions);
  saveAvatarConfig(nextConfig);
};

export const updateAvatarSequenceActionName = (
  actionId: string,
  name: string,
): void => {
  const config = getAvatarConfig(useProjectStore.getState().project);
  const nextConfig = structuredClone(config);
  const update = (items: AvatarSequenceAction[]) =>
    items.map((item) => (item.id === actionId ? { ...item, name } : item));
  nextConfig.sequenceConfig.idle = update(nextConfig.sequenceConfig.idle);
  nextConfig.sequenceConfig.speaking = update(nextConfig.sequenceConfig.speaking);
  nextConfig.sequenceConfig.actions = update(nextConfig.sequenceConfig.actions);
  saveAvatarConfig(nextConfig);
};

export const appendAvatarSequenceFrames = (
  actionId: string,
  frames: AvatarSequenceFrame[],
): void => {
  if (frames.length === 0) return;
  const config = getAvatarConfig(useProjectStore.getState().project);
  const nextConfig = structuredClone(config);
  const update = (items: AvatarSequenceAction[]) =>
    items.map((item) =>
      item.id === actionId ? { ...item, frames: [...item.frames, ...frames] } : item,
    );
  nextConfig.sequenceConfig.idle = update(nextConfig.sequenceConfig.idle);
  nextConfig.sequenceConfig.speaking = update(nextConfig.sequenceConfig.speaking);
  nextConfig.sequenceConfig.actions = update(nextConfig.sequenceConfig.actions);
  saveAvatarConfig(nextConfig);
};

export const removeAvatarSequenceFrame = (
  actionId: string,
  frameId: string,
): void => {
  const config = getAvatarConfig(useProjectStore.getState().project);
  const nextConfig = structuredClone(config);
  const update = (items: AvatarSequenceAction[]) =>
    items.map((item) =>
      item.id === actionId
        ? { ...item, frames: item.frames.filter((frame) => frame.id !== frameId) }
        : item,
    );
  nextConfig.sequenceConfig.idle = update(nextConfig.sequenceConfig.idle);
  nextConfig.sequenceConfig.speaking = update(nextConfig.sequenceConfig.speaking);
  nextConfig.sequenceConfig.actions = update(nextConfig.sequenceConfig.actions);
  saveAvatarConfig(nextConfig);
};

export const reorderAvatarSequenceFrames = (
  actionId: string,
  fromIndex: number,
  toIndex: number,
): void => {
  if (fromIndex === toIndex) return;
  const config = getAvatarConfig(useProjectStore.getState().project);
  const nextConfig = structuredClone(config);
  const update = (items: AvatarSequenceAction[]) =>
    items.map((item) => {
      if (item.id !== actionId) return item;
      const frames = [...item.frames];
      const [moved] = frames.splice(fromIndex, 1);
      if (!moved) return item;
      frames.splice(Math.max(0, Math.min(toIndex, frames.length)), 0, moved);
      return { ...item, frames };
    });
  nextConfig.sequenceConfig.idle = update(nextConfig.sequenceConfig.idle);
  nextConfig.sequenceConfig.speaking = update(nextConfig.sequenceConfig.speaking);
  nextConfig.sequenceConfig.actions = update(nextConfig.sequenceConfig.actions);
  saveAvatarConfig(nextConfig);
};

export const findAvatarVideoAsset = (config: AvatarConfig, assetId: string) => {
  return [
    ...config.videoConfig.idle,
    ...config.videoConfig.speaking,
    ...config.videoConfig.actions,
  ].find((item) => item.id === assetId) ?? null;
};

export const findAvatarSequenceAction = (config: AvatarConfig, actionId: string) => {
  return [
    ...config.sequenceConfig.idle,
    ...config.sequenceConfig.speaking,
    ...config.sequenceConfig.actions,
  ].find((item) => item.id === actionId) ?? null;
};

export const updateAvatarVideoAssetTransform = (
  assetId: string,
  transform: Transform,
): void => {
  const config = getAvatarConfig(useProjectStore.getState().project);
  const nextConfig = structuredClone(config);
  const update = (items: AvatarVideoAsset[]) =>
    items.map((item) => (item.id === assetId ? { ...item, transform } : item));
  nextConfig.videoConfig.idle = update(nextConfig.videoConfig.idle);
  nextConfig.videoConfig.speaking = update(nextConfig.videoConfig.speaking);
  nextConfig.videoConfig.actions = update(nextConfig.videoConfig.actions);
  saveAvatarConfig(nextConfig);
};

export const updateAvatarSequenceActionTransform = (
  actionId: string,
  transform: Transform,
): void => {
  const config = getAvatarConfig(useProjectStore.getState().project);
  const nextConfig = structuredClone(config);
  const update = (items: AvatarSequenceAction[]) =>
    items.map((item) => (item.id === actionId ? { ...item, transform } : item));
  nextConfig.sequenceConfig.idle = update(nextConfig.sequenceConfig.idle);
  nextConfig.sequenceConfig.speaking = update(nextConfig.sequenceConfig.speaking);
  nextConfig.sequenceConfig.actions = update(nextConfig.sequenceConfig.actions);
  saveAvatarConfig(nextConfig);
};

export const updateAvatarVideoAssetMedia = (
  assetId: string,
  mediaId: string,
): void => {
  const config = getAvatarConfig(useProjectStore.getState().project);
  const nextConfig = structuredClone(config);
  const update = (items: AvatarVideoAsset[]) =>
    items.map((item) => (item.id === assetId ? { ...item, mediaId } : item));
  nextConfig.videoConfig.idle = update(nextConfig.videoConfig.idle);
  nextConfig.videoConfig.speaking = update(nextConfig.videoConfig.speaking);
  nextConfig.videoConfig.actions = update(nextConfig.videoConfig.actions);
  saveAvatarConfig(nextConfig);
};

export const updateAvatarSequenceFrameMedia = (
  actionId: string,
  frameId: string,
  mediaId: string,
): void => {
  const config = getAvatarConfig(useProjectStore.getState().project);
  const nextConfig = structuredClone(config);
  const update = (items: AvatarSequenceAction[]) =>
    items.map((item) =>
      item.id === actionId
        ? {
            ...item,
            frames: item.frames.map((frame) =>
              frame.id === frameId ? { ...frame, mediaId } : frame,
            ),
          }
        : item,
    );
  nextConfig.sequenceConfig.idle = update(nextConfig.sequenceConfig.idle);
  nextConfig.sequenceConfig.speaking = update(nextConfig.sequenceConfig.speaking);
  nextConfig.sequenceConfig.actions = update(nextConfig.sequenceConfig.actions);
  saveAvatarConfig(nextConfig);
};
