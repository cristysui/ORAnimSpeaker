import React, { useEffect, useMemo, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";

export const AvatarThumbnail: React.FC<{
  mediaId?: string;
  className?: string;
}> = ({ mediaId, className }) => {
  const project = useProjectStore((state) => state.project);
  const media = useMemo(
    () => project.mediaLibrary.items.find((item) => item.id === mediaId),
    [mediaId, project.mediaLibrary.items],
  );
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [firstFrameUrl, setFirstFrameUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!media?.blob) {
      setObjectUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(media.blob);
    setObjectUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [media?.blob]);

  useEffect(() => {
    setFirstFrameUrl(null);
    if (!media?.blob || media.type !== "video" || media.thumbnailUrl) return;

    const video = document.createElement("video");
    const url = URL.createObjectURL(media.blob);
    let cancelled = false;
    let captured = false;
    let timeoutId: number | null = null;

    const cleanup = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };

    const captureFrame = () => {
      if (
        cancelled ||
        captured ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth <= 0 ||
        video.videoHeight <= 0
      ) {
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      captured = true;
      setFirstFrameUrl(canvas.toDataURL("image/jpeg", 0.78));
    };

    const requestCapture = () => {
      if (cancelled || captured) return;
      if ("requestVideoFrameCallback" in video) {
        video.requestVideoFrameCallback(() => captureFrame());
      } else {
        window.requestAnimationFrame(captureFrame);
      }
    };

    const seekToFirstFrame = () => {
      if (cancelled || captured) return;
      try {
        const targetTime = Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(0.001, video.duration / 2)
          : 0;
        if (Math.abs(video.currentTime - targetTime) > 0.0001) {
          video.currentTime = targetTime;
        } else {
          requestCapture();
        }
      } catch {
        requestCapture();
      }
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadedmetadata = seekToFirstFrame;
    video.onloadeddata = requestCapture;
    video.oncanplay = requestCapture;
    video.onseeked = requestCapture;
    video.src = url;
    video.load();
    timeoutId = window.setTimeout(requestCapture, 2000);

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [media?.blob, media?.thumbnailUrl, media?.type]);

  const url = media?.type === "video"
    ? media.thumbnailUrl || firstFrameUrl
    : media?.thumbnailUrl || media?.originalUrl || objectUrl;

  return (
    <div className={`relative flex h-full min-h-[84px] w-full items-center justify-center overflow-hidden rounded-md bg-bg border border-border ${className ?? ""}`}>
      {url ? (
        <img src={url} alt={media?.name ?? "动作缩略图"} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-16 w-24 items-center justify-center rounded border border-dashed border-border bg-bg-2 text-fg-muted">
          <ImageIcon className="h-5 w-5" />
        </div>
      )}
    </div>
  );
};

export default AvatarThumbnail;
