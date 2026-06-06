import React, { useMemo, useState } from "react";
import { getMasterClock, type Clip, type Project } from "@openreel/core";
import { PlayCircle } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { toast } from "../../stores/notification-store";
import { getAvatarActions, getAvatarConfig } from "./avatar-project";
import { addAvatarActionOverlay } from "./avatar-timeline";
import type {
  AvatarSequenceAction,
  AvatarSource,
  AvatarVideoAsset,
} from "./avatar-types";
import { AvatarThumbnail } from "./AvatarThumbnail";
import { useI18n } from "../../i18n";

export const isAvatarGeneratedClip = (clip: Clip | null | undefined): clip is Clip => {
  return clip?.metadata?.kind === "avatar-generated";
};

export const AvatarActionConsole: React.FC<{ clip?: Clip | null }> = ({ clip }) => {
  const { t } = useI18n();
  const project = useProjectStore((state) => state.project);
  const config = useMemo(() => getAvatarConfig(project), [project]);
  const actions = useMemo(() => getAvatarActions(config), [config]);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const parentClip = clip && isAvatarGeneratedClip(clip)
    ? clip
    : findAvatarGeneratedClipForAction(project);

  const runAction = async (source: AvatarSource, actionId: string) => {
    if (!parentClip) {
      toast.warning(t("avatar.noGeneratedClip"), t("avatar.noGeneratedClipDesc"));
      return;
    }
    const timeline = useTimelineStore.getState();
    const insertionTime = timeline.playbackState === "playing"
      ? getMasterClock().currentTime
      : timeline.playheadPosition;
    setBusyActionId(actionId);
    try {
      if (timeline.playbackState === "playing") {
        timeline.pause();
        timeline.setPlayheadPosition(insertionTime);
        await waitForPlaybackToSettle();
      }
      await addAvatarActionOverlay(parentClip.id, source, actionId, {
        startTime: insertionTime,
      });
      toast.success(t("avatar.overlayAdded"));
    } catch (error) {
      toast.error(
        t("avatar.overlayFailed"),
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setBusyActionId(null);
    }
  };

  return (
    <div className="h-full bg-bg-1 text-fg flex flex-col">
      <div className="flex-1 overflow-y-auto px-2 py-3 custom-scrollbar">
        <ActionGroup
          title={t("avatar.videoActions")}
          source="video"
          actions={actions.video}
          busyActionId={busyActionId}
          onRun={runAction}
        />
        <ActionGroup
          title={t("avatar.sequenceActions")}
          source="sequence"
          actions={actions.sequence}
          busyActionId={busyActionId}
          onRun={runAction}
        />
      </div>
    </div>
  );
};

const ActionGroup: React.FC<{
  title: string;
  source: AvatarSource;
  actions: Array<AvatarVideoAsset | AvatarSequenceAction>;
  busyActionId: string | null;
  onRun: (source: AvatarSource, actionId: string) => Promise<void>;
}> = ({ title, source, actions, busyActionId, onRun }) => {
  const { t } = useI18n();
  return (
  <section className="mb-3 rounded-lg border border-border bg-bg-2 px-2 py-2.5">
    <div className="mb-2 text-xs font-medium text-fg-2">{title}</div>
    {actions.length === 0 ? (
      <p className="text-xs text-fg-muted">{t("avatar.noActions")}</p>
    ) : (
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => (
          <button
            key={action.id}
            className="group relative flex min-w-0 flex-col rounded-md border border-border/80 bg-gradient-to-b from-bg to-bg-2 p-1.5 text-xs text-fg transition hover:border-accent/70 hover:brightness-110 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-2px_0_rgba(0,0,0,0.28),0_1px_2px_rgba(0,0,0,0.35)]"
            disabled={busyActionId !== null}
            onClick={() => void onRun(source, action.id)}
            title={action.name}
          >
            <span className="pointer-events-none absolute right-1.5 top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full border border-accent/60 bg-bg/80 text-accent shadow-[0_0_6px_rgba(0,229,168,0.35)] opacity-80 group-hover:opacity-100">
              <PlayCircle className="h-3 w-3" />
            </span>
            <div className="h-14 w-full overflow-hidden rounded border border-border/80 bg-bg-1 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.28)]">
              <AvatarThumbnail
                mediaId={source === "video"
                  ? (action as AvatarVideoAsset).mediaId
                  : (action as AvatarSequenceAction).frames[0]?.mediaId}
                className="h-full min-h-0 border-0"
              />
            </div>
            <div className="mt-1 flex h-6 w-full items-center justify-center rounded border border-border/60 bg-bg-1/70 px-1 shadow-[inset_0_1px_1px_rgba(0,0,0,0.35)]">
              <span className="w-full truncate text-center text-[11px] font-medium leading-none text-fg-2">
                {action.name}
              </span>
            </div>
          </button>
        ))}
      </div>
    )}
  </section>
  );
};

export default AvatarActionConsole;

function findAvatarGeneratedClipForAction(project: Project): Clip | null {
  const playhead = useTimelineStore.getState().playheadPosition;
  const generatedClips = project.timeline.tracks
    .flatMap((track) => track.clips)
    .filter(isAvatarGeneratedClip)
    .sort((a, b) => b.startTime - a.startTime);
  const clipAtPlayhead = generatedClips.find((clip) => {
    return playhead >= clip.startTime && playhead <= clip.startTime + clip.duration;
  });
  if (clipAtPlayhead) return clipAtPlayhead;
  return generatedClips[0] ?? null;
}

function waitForPlaybackToSettle(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}
