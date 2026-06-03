import React, { useMemo, useState } from "react";
import { Film, ImagePlus, Wand2 } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { toast } from "../../stores/notification-store";
import { getAvatarConfig, hasSequenceConfig, hasVideoConfig } from "./avatar-project";
import { generateAvatarFromSequence, generateAvatarFromVideo } from "./avatar-timeline";

export const AvatarGenerationStrip: React.FC = () => {
  const project = useProjectStore((state) => state.project);
  const config = useMemo(() => getAvatarConfig(project), [project]);
  const [busyClipId, setBusyClipId] = useState<string | null>(null);
  const canGenerateVideo = hasVideoConfig(config);
  const canGenerateSequence = hasSequenceConfig(config);

  const audioClips = useMemo(() => {
    return project.timeline.tracks.flatMap((track) =>
      track.clips
        .filter((clip) => {
          const media = project.mediaLibrary.items.find((item) => item.id === clip.mediaId);
          return track.type === "audio" || media?.type === "audio";
        })
        .map((clip) => ({ clip, track })),
    );
  }, [project]);

  if (audioClips.length === 0 || (!canGenerateVideo && !canGenerateSequence)) {
    return null;
  }

  const runGeneration = async (
    clipId: string,
    generator: (clipId: string) => Promise<void>,
    successMessage: string,
  ) => {
    setBusyClipId(clipId);
    try {
      await generator(clipId);
      toast.success(successMessage);
    } catch (error) {
      toast.error(
        "生成角色动画失败",
        error instanceof Error ? error.message : "未知错误",
      );
    } finally {
      setBusyClipId(null);
    }
  };

  return (
    <div className="border-b border-border bg-bg-1 px-3 py-2">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-fg-2">
        <Wand2 className="h-3.5 w-3.5 text-accent" />
        音频驱动角色动画
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
        {audioClips.map(({ clip, track }) => (
          <div
            key={clip.id}
            className="flex shrink-0 items-center gap-2 rounded border border-border bg-bg px-2 py-1.5 text-xs"
          >
            <span className="max-w-44 truncate text-fg-muted">
              {track.name} · {clip.duration.toFixed(1)}s
            </span>
            {canGenerateSequence && (
              <button
                className="flex items-center gap-1 rounded bg-accent/15 px-2 py-1 text-accent hover:bg-accent/25 disabled:opacity-50"
                disabled={busyClipId === clip.id}
                onClick={() =>
                  void runGeneration(
                    clip.id,
                    generateAvatarFromSequence,
                    "已从序列帧生成角色动画",
                  )
                }
              >
                <ImagePlus className="h-3.5 w-3.5" />
                从序列帧生成动画
              </button>
            )}
            {canGenerateVideo && (
              <button
                className="flex items-center gap-1 rounded bg-accent/15 px-2 py-1 text-accent hover:bg-accent/25 disabled:opacity-50"
                disabled={busyClipId === clip.id}
                onClick={() =>
                  void runGeneration(
                    clip.id,
                    generateAvatarFromVideo,
                    "已从视频生成角色动画",
                  )
                }
              >
                <Film className="h-3.5 w-3.5" />
                从视频生成动画
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AvatarGenerationStrip;
