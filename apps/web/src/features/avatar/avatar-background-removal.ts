import type { MediaItem } from "@openreel/core";

const DEFAULT_VIDEO_FPS = 8;
const MAX_VIDEO_DURATION_SEC = 12;
const BACKGROUND_DISTANCE = 58;

export type AvatarBackgroundRemovalProgress = (message: string) => void;

export async function removeAvatarMediaBackground(
  media: MediaItem,
  onProgress?: AvatarBackgroundRemovalProgress,
): Promise<File> {
  if (!media.blob) throw new Error("素材数据不存在");

  if (media.type === "image") {
    return removeImageBackground(media, onProgress);
  }
  if (media.type === "video") {
    return removeVideoBackground(media, onProgress);
  }
  throw new Error("只支持图片或视频动作素材");
}

async function removeImageBackground(
  media: MediaItem,
  onProgress?: AvatarBackgroundRemovalProgress,
): Promise<File> {
  onProgress?.("使用保守边缘算法处理图片");
  const bitmap = await createImageBitmap(media.blob!);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("无法创建画布");
    ctx.drawImage(bitmap, 0, 0);
    removeConnectedBackground(ctx, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, "image/png");
    return new File([blob], withSuffix(media.name, "去背景", "png"), {
      type: "image/png",
    });
  } finally {
    bitmap.close();
  }
}

async function removeVideoBackground(
  media: MediaItem,
  onProgress?: AvatarBackgroundRemovalProgress,
): Promise<File> {
  const video = document.createElement("video");
  const url = URL.createObjectURL(media.blob!);
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let stopped: Promise<void> | null = null;
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    await waitForVideoReady(video);
    const width = media.metadata.width || video.videoWidth;
    const height = media.metadata.height || video.videoHeight;
    const sourceDuration = media.metadata.duration || video.duration || 1;
    const duration = Math.min(sourceDuration, MAX_VIDEO_DURATION_SEC);
    const fps = Math.min(
      DEFAULT_VIDEO_FPS,
      Math.max(6, Math.round(media.metadata.frameRate || DEFAULT_VIDEO_FPS)),
    );

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!ctx) throw new Error("无法创建画布");

    stream = canvas.captureStream(fps);
    recorder = createRecorder(stream);
    const activeRecorder = recorder;
    const chunks: BlobPart[] = [];
    activeRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    stopped = new Promise<void>((resolve, reject) => {
      activeRecorder.onstop = () => resolve();
      activeRecorder.onerror = () => reject(new Error("视频编码失败"));
    });

    activeRecorder.start(1000);
    const frameDuration = 1 / fps;
    for (let time = 0; time < duration; time += frameDuration) {
      onProgress?.(`处理视频 ${Math.min(99, Math.round((time / duration) * 100))}%`);
      await seekVideo(video, Math.min(time, duration - 0.001));
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(video, 0, 0, width, height);
      removeConnectedBackground(ctx, width, height);
      await wait(Math.max(8, frameDuration * 1000));
    }

    stopRecorder(activeRecorder);
    await waitForRecorderStop(stopped);
    onProgress?.("导入去背景素材");
    const blob = new Blob(chunks, { type: activeRecorder.mimeType || "video/webm" });
    return new File([blob], withSuffix(media.name, "去背景", "webm"), {
      type: "video/webm",
    });
  } finally {
    if (recorder?.state && recorder.state !== "inactive") {
      stopRecorder(recorder);
    }
    stream?.getTracks().forEach((track) => track.stop());
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function removeConnectedBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const border = estimateBorderColor(data, width, height);
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];

  const enqueue = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    if (!isBackgroundLike(data, idx * 4, border)) return;
    visited[idx] = 1;
    queue.push(idx);
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  for (let head = 0; head < queue.length; head += 1) {
    const idx = queue[head];
    const x = idx % width;
    const y = Math.floor(idx / width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  const alpha = new Uint8ClampedArray(width * height);
  alpha.fill(255);
  for (const idx of queue) {
    alpha[idx] = 0;
  }
  featherMask(alpha, width, height);

  for (let idx = 0; idx < alpha.length; idx += 1) {
    data[idx * 4 + 3] = alpha[idx];
  }
  ctx.putImageData(imageData, 0, 0);
}

function isBackgroundLike(
  data: Uint8ClampedArray,
  offset: number,
  border: { r: number; g: number; b: number },
): boolean {
  const a = data[offset + 3];
  if (a < 16) return true;
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const distance = Math.hypot(r - border.r, g - border.g, b - border.b);
  if (distance <= BACKGROUND_DISTANCE) return true;

  const isBorderBright =
    border.r > 225 &&
    border.g > 225 &&
    border.b > 225 &&
    Math.max(border.r, border.g, border.b) - Math.min(border.r, border.g, border.b) < 20;
  const isBrightNeutral =
    r > 242 &&
    g > 242 &&
    b > 242 &&
    Math.max(r, g, b) - Math.min(r, g, b) < 16;
  return isBorderBright && isBrightNeutral;
}

function featherMask(alpha: Uint8ClampedArray, width: number, height: number): void {
  const original = new Uint8ClampedArray(alpha);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      if (original[idx] !== 255) continue;
      const touchesBackground =
        original[idx - 1] === 0 ||
        original[idx + 1] === 0 ||
        original[idx - width] === 0 ||
        original[idx + width] === 0;
      if (touchesBackground) alpha[idx] = 220;
    }
  }
}

function estimateBorderColor(data: Uint8ClampedArray, width: number, height: number) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const add = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    if (data[offset + 3] < 16) return;
    r += data[offset];
    g += data[offset + 1];
    b += data[offset + 2];
    count += 1;
  };
  const step = Math.max(1, Math.floor(Math.min(width, height) / 80));
  for (let x = 0; x < width; x += step) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    add(0, y);
    add(width - 1, y);
  }
  if (count === 0) return { r: 255, g: 255, b: 255 };
  return { r: r / count, g: g / count, b: b / count };
}

function createRecorder(stream: MediaStream): MediaRecorder {
  const preferred = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type));
  return new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
}

function stopRecorder(recorder: MediaRecorder): void {
  if (recorder.state === "inactive") return;
  try {
    recorder.stop();
  } catch {
    // Recorder state can change asynchronously while cleanup is running.
  }
}

function waitForRecorderStop(stopped: Promise<void>): Promise<void> {
  return Promise.race([stopped, wait(2000)]);
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("无法读取视频"));
    };
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("error", onError);
    video.load();
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) onReady();
  });
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let timeoutId: number | null = null;
    const finish = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      video.removeEventListener("seeked", finish);
      resolve();
    };
    video.addEventListener("seeked", finish);
    video.currentTime = time;
    timeoutId = window.setTimeout(finish, 500);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("无法导出图片"));
    }, type);
  });
}

function withSuffix(name: string, suffix: string, extension: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}-${suffix}.${extension}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
