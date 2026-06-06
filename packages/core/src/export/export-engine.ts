import type { MediaItem, Project } from "../types/project";
import type { Clip, Track, Transform } from "../types/timeline";
import type {
  VideoExportSettings,
  AudioExportSettings,
  ImageExportSettings,
  SequenceExportSettings,
  ExportProgress,
  ExportPreset,
  ExportResult,
  ExportStats,
  ExportError,
} from "./types";
import {
  DEFAULT_VIDEO_SETTINGS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_IMAGE_SETTINGS,
  VIDEO_QUALITY_PRESETS,
} from "./types";
import { VideoEngine, getVideoEngine } from "../video/video-engine";
import { AudioEngine, getAudioEngine } from "../audio/audio-engine";
import { titleEngine } from "../text/title-engine";
import { graphicsEngine } from "../graphics/graphics-engine";
import { UpscalingEngine, getUpscalingEngine } from "../video/upscaling";
import { getMediaEngine } from "../media/mediabunny-engine";
import { getWavEncoder } from "../wasm/wav";

type AvatarFastPathVisualTrack = {
  track: Track;
  originalIndex: number;
  role: "background" | "avatar";
};

type AvatarFastPathPlan = {
  tracks: AvatarFastPathVisualTrack[];
  videoMediaIds: string[];
  imageMediaIds: string[];
};

type DrawableFrame = ImageBitmap | OffscreenCanvas | HTMLCanvasElement;

type FastPathVideoFrameCacheEntry = {
  canvas: OffscreenCanvas;
  lastAccessed: number;
};

type FastPathSequenceActionPlan = {
  id: string;
  frames: Array<{ mediaId: string; duration: number; transform?: Transform }>;
  totalDuration: number;
  transform: Transform;
};

export class ExportEngine {
  private static readonly AUDIO_EXPORT_CHUNK_DURATION_SECONDS = 15;
  private static readonly ENABLE_AVATAR_FAST_PATH = true;
  private static readonly FAST_PATH_VIDEO_CACHE_MAX = 240;
  private static readonly FAST_PATH_PREFETCH_SECONDS = 1;
  private mediabunny: typeof import("mediabunny") | null = null;
  private initialized = false;
  private videoEngine: VideoEngine | null = null;
  private audioEngine: AudioEngine | null = null;
  private upscalingEngine: UpscalingEngine | null = null;
  private abortController: AbortController | null = null;
  private currentExport: {
    startTime: number;
    framesRendered: number;
  } | null = null;
  private exportWorker: Worker | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.mediabunny = await import("mediabunny");
    } catch (error) {
      console.warn("[ExportEngine] MediaBunny not available:", error);
      this.mediabunny = null;
    }

    try {
      this.videoEngine = getVideoEngine();
      this.audioEngine = getAudioEngine();

      if (!this.videoEngine.isInitialized()) {
        await this.videoEngine.initialize();
      }
      if (!this.audioEngine.isInitialized()) {
        await this.audioEngine.initialize();
      }

      this.initialized = true;
    } catch (error) {
      throw new Error(
        `ExportEngine initialization failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  async initializeGPUForExport(
    width: number,
    height: number,
  ): Promise<boolean> {
    if (!this.initialized || !this.videoEngine) {
      await this.initialize();
    }

    try {
      await this.videoEngine!.initializeGPUCompositor(width, height);
      const gpuCompositor = this.videoEngine!.getGPUCompositor();
      if (gpuCompositor) {
        const device = gpuCompositor.getDevice();
        if (device) {
          this.upscalingEngine = getUpscalingEngine();
          await this.upscalingEngine.initialize({ device });
        }
        return true;
      }
      return false;
    } catch (error) {
      throw new Error(
        `ExportEngine initialization failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  isMediaBunnyAvailable(): boolean {
    return this.mediabunny !== null;
  }

  isWebCodecsSupported(): boolean {
    return (
      typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined"
    );
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.mediabunny) {
      throw new Error("ExportEngine not initialized. Call initialize() first.");
    }
  }

  private getVideoEncoderProbeCodecs(codec: string): string[] {
    const rawCodec = codec.trim();
    const lowerCodec = rawCodec.toLowerCase();
    const candidates = [rawCodec];

    if (
      lowerCodec === "avc" ||
      lowerCodec.includes("avc") ||
      lowerCodec.includes("h264")
    ) {
      candidates.push("avc1.640028", "avc1.4d401f", "avc1.42e01e");
    }
    if (lowerCodec === "vp9" || lowerCodec.includes("vp09")) {
      candidates.push("vp09.00.10.08");
    }
    if (lowerCodec === "vp8" || lowerCodec.includes("vp8")) {
      candidates.push("vp8");
    }
    if (lowerCodec === "av1" || lowerCodec.includes("av01")) {
      candidates.push("av01.0.08M.08");
    }

    return [...new Set(candidates.filter(Boolean))];
  }

  private async probeVideoEncoderHardwareSupport(params: {
    codec: string;
    width: number;
    height: number;
    bitrate: number;
    frameRate: number;
  }): Promise<Record<string, unknown>> {
    if (
      typeof VideoEncoder === "undefined" ||
      typeof VideoEncoder.isConfigSupported !== "function"
    ) {
      return {
        webCodecs: false,
        reason: "VideoEncoder.isConfigSupported unavailable",
      };
    }

    const codecs = this.getVideoEncoderProbeCodecs(params.codec);
    const hardwareHints = [
      "prefer-hardware",
      "no-preference",
      "prefer-software",
    ] as const;
    const candidates: Array<Record<string, unknown>> = [];

    for (const codec of codecs) {
      for (const hardwareAcceleration of hardwareHints) {
        try {
          const support = await VideoEncoder.isConfigSupported({
            codec,
            width: params.width,
            height: params.height,
            bitrate: params.bitrate,
            framerate: params.frameRate,
            hardwareAcceleration,
          });

          candidates.push({
            codec,
            hardwareAcceleration,
            supported: support.supported === true,
            resolvedCodec: support.config?.codec,
            resolvedHardwareAcceleration: support.config?.hardwareAcceleration,
          });
        } catch (error) {
          candidates.push({
            codec,
            hardwareAcceleration,
            supported: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return {
      webCodecs: true,
      requestedCodec: params.codec,
      width: params.width,
      height: params.height,
      bitrate: params.bitrate,
      frameRate: params.frameRate,
      preferHardwareSupported: candidates.some(
        (candidate) =>
          candidate.hardwareAcceleration === "prefer-hardware" &&
          candidate.supported === true,
      ),
      noPreferenceSupported: candidates.some(
        (candidate) =>
          candidate.hardwareAcceleration === "no-preference" &&
          candidate.supported === true,
      ),
      preferSoftwareSupported: candidates.some(
        (candidate) =>
          candidate.hardwareAcceleration === "prefer-software" &&
          candidate.supported === true,
      ),
      candidates,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async findSupportedAudioCodec(
    outputFormat: { getSupportedAudioCodecs: () => any[] },
    audioSettings: AudioExportSettings,
    getFirstEncodableAudioCodec: (codecs: any[]) => Promise<string | null>,
  ): Promise<{ codec: string; bitrate: number }> {
    const supportedCodecs = outputFormat.getSupportedAudioCodecs();
    const requestedBitrate = audioSettings.bitrate * 1000;

    const bitrateFallbacks = [requestedBitrate, 192000, 128000, 96000].filter(
      (b, i, arr) => arr.indexOf(b) === i,
    );

    for (const bitrate of bitrateFallbacks) {
      const codec = await getFirstEncodableAudioCodec(supportedCodecs);
      if (codec) {
        const isSupported = await this.isAudioConfigSupported(
          codec,
          bitrate,
          audioSettings.channels,
          audioSettings.sampleRate,
        );
        if (isSupported) {
          return { codec, bitrate };
        }
      }
    }

    for (const fallbackCodec of ["aac", "mp3", "opus"]) {
      if (
        supportedCodecs.some((c: string) =>
          String(c).toLowerCase().includes(fallbackCodec) ||
          (fallbackCodec === "aac" && String(c).toLowerCase().includes("mp4a")),
        )
      ) {
        for (const bitrate of bitrateFallbacks) {
          const isSupported = await this.isAudioConfigSupported(
            fallbackCodec,
            bitrate,
            audioSettings.channels,
            audioSettings.sampleRate,
          );
          if (isSupported) {
            return { codec: fallbackCodec, bitrate };
          }
        }
      }
    }

    const defaultCodec = await getFirstEncodableAudioCodec(supportedCodecs);
    return {
      codec: defaultCodec || "aac",
      bitrate: 128000,
    };
  }

  private async isAudioConfigSupported(
    codec: string,
    bitrate: number,
    channels: number,
    sampleRate: number,
  ): Promise<boolean> {
    if (typeof AudioEncoder === "undefined") {
      return true;
    }

    try {
      let codecString: string;
      if (codec === "aac" || codec.includes("mp4a")) {
        codecString = "mp4a.40.2";
      } else if (codec === "opus") {
        codecString = "opus";
      } else if (codec === "mp3") {
        codecString = "mp3";
      } else {
        codecString = codec;
      }

      const config: AudioEncoderConfig = {
        codec: codecString,
        sampleRate,
        numberOfChannels: channels,
        bitrate,
      };

      const support = await AudioEncoder.isConfigSupported(config);
      return support.supported === true;
    } catch {
      return false;
    }
  }

  async *exportVideo(
    project: Project,
    settings: Partial<VideoExportSettings> = {},
    writableStream?: FileSystemWritableFileStream,
  ): AsyncGenerator<ExportProgress, ExportResult> {
    this.ensureInitialized();
    const exportId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    const exportStart = performance.now();
    let lastMark = exportStart;
    const timings = {
      renderMs: 0,
      upscaleMs: 0,
      encodeMs: 0,
      idleMs: 0,
      frames: 0,
    };
    const logExport = (stage: string, details: Record<string, unknown> = {}) => {
      const now = performance.now();
      console.info(`[Export:${exportId}] ${stage}`, {
        elapsedMs: Math.round(now - exportStart),
        stepMs: Math.round(now - lastMark),
        ...details,
      });
      lastMark = now;
    };

    if (!this.mediabunny) {
      const errorMessage = this.isWebCodecsSupported()
        ? "MediaBunny library failed to load. Please refresh the page and try again."
        : "Video export requires WebCodecs API which is not supported in your browser. Please use Chrome, Edge, or another WebCodecs-compatible browser.";
      return {
        success: false,
        error: this.createError("UNSUPPORTED_CODEC", errorMessage, "preparing"),
      };
    }

    const fullSettings: VideoExportSettings = {
      ...DEFAULT_VIDEO_SETTINGS,
      ...settings,
      audioSettings: {
        ...DEFAULT_VIDEO_SETTINGS.audioSettings,
        ...settings.audioSettings,
      },
    };

    if (fullSettings.codec === "prores") {
      fullSettings.codec = "h264";
      fullSettings.format = "mp4";
      fullSettings.bitrate = 25000;
      fullSettings.quality = 95;
    }

    const { timeline } = project;
    const timelineDuration = this.calculateTimelineDuration(timeline);

    const isMemoryIntensiveCodec =
      fullSettings.codec === "vp9" ||
      fullSettings.codec === "av1" ||
      fullSettings.codec === "h265";
    const isLongVideo = timelineDuration > 120;

    let maxW = isMemoryIntensiveCodec ? 1920 : 3840;
    let maxH = isMemoryIntensiveCodec ? 1080 : 2160;
    if (isLongVideo) {
      maxW = Math.min(maxW, 1920);
      maxH = Math.min(maxH, 1080);
    }
    if (fullSettings.width > maxW || fullSettings.height > maxH) {
      const scale = Math.min(maxW / fullSettings.width, maxH / fullSettings.height, 1);
      fullSettings.width = Math.round(fullSettings.width * scale / 2) * 2;
      fullSettings.height = Math.round(fullSettings.height * scale / 2) * 2;
    }
    if (isLongVideo && fullSettings.frameRate > 30) {
      fullSettings.frameRate = 30;
    }

    this.abortController = new AbortController();
    this.currentExport = { startTime: Date.now(), framesRendered: 0 };
    logExport("start", {
      project: project.name,
      duration: timelineDuration,
      tracks: project.timeline.tracks.length,
      width: fullSettings.width,
      height: fullSettings.height,
      frameRate: fullSettings.frameRate,
      format: fullSettings.format,
      codec: fullSettings.codec,
    });

    if (timelineDuration <= 0) {
      return {
        success: false,
        error: this.createError(
          "MUXER_ERROR",
          "Timeline is empty. Add clips before exporting.",
          "preparing",
        ),
      };
    }

    if (!writableStream) {
      return {
        success: false,
        error: this.createError(
          "MUXER_ERROR",
          "No writable stream provided. Export requires a file destination.",
          "preparing",
        ),
      };
    }

    const totalFrames = Math.ceil(timelineDuration * fullSettings.frameRate);
    const fastPathPlan = ExportEngine.ENABLE_AVATAR_FAST_PATH
      ? this.resolveAvatarFastPathPlan(project)
      : null;
    if (fastPathPlan) {
      const sequenceActionMap = this.resolveFastPathSequenceActionMap(project);
      logExport("avatar fast path selected", {
        tracks: fastPathPlan.tracks.map(({ track, role }) => ({
          name: track.name,
          role,
          clips: track.clips.length,
        })),
        videoMediaCount: fastPathPlan.videoMediaIds.length,
        imageMediaCount: fastPathPlan.imageMediaIds.length,
        sequenceActionCount: sequenceActionMap.size,
      });
      const fastResult = yield* this.exportAvatarFastPath(
        project,
        fullSettings,
        writableStream,
        totalFrames,
        timelineDuration,
        fastPathPlan,
        sequenceActionMap,
        logExport,
      );
      return fastResult;
    }

    await this.initializeGPUForExport(
      fullSettings.width,
      fullSettings.height,
    );
    logExport("gpu initialized");

    this.videoEngine?.resetExportState();
    if (this.videoEngine) {
      this.videoEngine.exportMode = true;
    }
    let bytesWritten = 0;

    try {
      yield this.createProgress("preparing", 0, totalFrames, 0, 0);
      logExport("prepare output", { totalFrames });

      const {
        Output,
        StreamTarget,
        Mp4OutputFormat,
        WebMOutputFormat,
        MovOutputFormat,
        CanvasSource,
        AudioBufferSource,
        getFirstEncodableVideoCodec,
        getFirstEncodableAudioCodec,
        QUALITY_MEDIUM,
      } = this.mediabunny!;

      const diskWriter = writableStream;
      const chunkWriter = new WritableStream<{ data: Uint8Array; position: number }>({
        async write(chunk) {
          const buf = chunk.data.buffer.slice(
            chunk.data.byteOffset,
            chunk.data.byteOffset + chunk.data.byteLength,
          ) as ArrayBuffer;
          await diskWriter.seek(chunk.position);
          await diskWriter.write(buf);
          bytesWritten += chunk.data.byteLength;
        },
      });

      let outputFormat;
      switch (fullSettings.format) {
        case "webm":
          outputFormat = new WebMOutputFormat();
          break;
        case "mov":
          outputFormat = new MovOutputFormat();
          break;
        case "mp4":
        default:
          outputFormat = new Mp4OutputFormat({ fastStart: false });
          break;
      }

      const target = new StreamTarget(chunkWriter, {
        chunked: true,
        chunkSize: 4 * 1024 * 1024,
      });
      const output = new Output({ format: outputFormat, target });
      logExport("output created");

      const videoCodec = await getFirstEncodableVideoCodec(
        outputFormat.getSupportedVideoCodecs(),
        { width: fullSettings.width, height: fullSettings.height },
      );

      if (!videoCodec) {
        throw this.createError(
          "UNSUPPORTED_CODEC",
          "No supported video codec found",
          "preparing",
        );
      }

      const audioCodecResult = await this.findSupportedAudioCodec(
        outputFormat,
        fullSettings.audioSettings,
        getFirstEncodableAudioCodec,
      );
      const hardwareSupport = await this.probeVideoEncoderHardwareSupport({
        codec: String(videoCodec),
        width: fullSettings.width,
        height: fullSettings.height,
        bitrate: fullSettings.bitrate ? fullSettings.bitrate * 1000 : 8_000_000,
        frameRate: fullSettings.frameRate,
      });
      logExport("video encoder support", hardwareSupport);
      logExport("codecs selected", {
        videoCodec,
        audioCodec: audioCodecResult.codec,
        audioBitrate: audioCodecResult.bitrate,
      });

      const exportCanvas = new OffscreenCanvas(
        fullSettings.width,
        fullSettings.height,
      );
      const exportCtx = exportCanvas.getContext("2d", {
        alpha: fullSettings.format === "webm",
      }) as OffscreenCanvasRenderingContext2D | null;
      if (!exportCtx) {
        throw this.createError(
          "FRAME_ENCODE_FAILED",
          "Could not create export canvas context",
          "preparing",
        );
      }
      exportCtx.imageSmoothingEnabled = true;
      exportCtx.imageSmoothingQuality = "high";

      const videoSource = new CanvasSource(exportCanvas, {
        codec: videoCodec,
        bitrate: fullSettings.bitrate ? fullSettings.bitrate * 1000 : QUALITY_MEDIUM,
        keyFrameInterval:
          fullSettings.keyframeInterval / fullSettings.frameRate,
        hardwareAcceleration: "prefer-hardware",
        onEncoderConfig: (config) => {
          logExport("video encoder config", {
            codec: config.codec,
            width: config.width,
            height: config.height,
            bitrate: config.bitrate,
            framerate: config.framerate,
            hardwareAcceleration: config.hardwareAcceleration,
          });
        },
      });
      const audioSource = new AudioBufferSource({
        codec: audioCodecResult.codec as "aac" | "opus" | "mp3",
        bitrate: audioCodecResult.bitrate,
      });
      output.addVideoTrack(videoSource);
      output.addAudioTrack(audioSource);
      output.setMetadataTags({
        title: project.name,
        date: new Date(),
      });

      await output.start();
      logExport("output started");

      try {
        logExport("audio encode start");
        await this.encodeTimelineAudioToSource(project, audioSource);
        logExport("audio encode complete");
      } finally {
        this.audioEngine?.clearCache();
      }
      audioSource.close();
      logExport("audio source closed");

      const mediaEngine = getMediaEngine();
      const videoMediaIds: string[] = [];
      for (const track of project.timeline.tracks) {
        if (track.type !== "video") continue;
        for (const clip of track.clips) {
          const mediaItem = project.mediaLibrary.items.find(
            (m) => m.id === clip.mediaId,
          );
          if (mediaItem?.blob && !videoMediaIds.includes(mediaItem.id)) {
            videoMediaIds.push(mediaItem.id);
            try {
              await mediaEngine.createExportDecoder(
                mediaItem.id,
                mediaItem.blob,
                fullSettings.width,
              );
            } catch {}
          }
        }
      }
      logExport("video decoders prepared", { videoMediaCount: videoMediaIds.length });

      const logFrameWindow = Math.max(1, fullSettings.frameRate * 5);
      const yieldFrameWindow = Math.max(1, fullSettings.frameRate);

      for (let frame = 0; frame < totalFrames; frame++) {
        if (this.abortController.signal.aborted) {
          throw this.createError(
            "CANCELLED",
            "Export cancelled by user",
            "rendering",
          );
        }

        const time = frame / fullSettings.frameRate;
        if (frame === 0) {
          logExport("first frame render start", { time });
        }
        const renderStart = performance.now();
        const rendered = await this.videoEngine!.renderFrame(
          project,
          time,
          fullSettings.width,
          fullSettings.height,
        );
        timings.renderMs += performance.now() - renderStart;
        if (frame === 0) {
          logExport("first frame render complete");
        }
        const shouldUpscale = this.shouldApplyUpscaling(project, fullSettings);
        let frameImage = rendered.image;

        if (shouldUpscale && this.upscalingEngine?.isInitialized()) {
          const upscaleStart = performance.now();
          const upscaled = await this.upscalingEngine.upscaleImageBitmap(
            frameImage,
            fullSettings.width,
            fullSettings.height,
            fullSettings.upscaling!,
          );
          timings.upscaleMs += performance.now() - upscaleStart;
          frameImage.close();
          frameImage = upscaled;
        }

        exportCtx.clearRect(0, 0, fullSettings.width, fullSettings.height);
        exportCtx.drawImage(frameImage, 0, 0, fullSettings.width, fullSettings.height);

        if (frame === 0) {
          logExport("first frame encode start");
        }
        const encodeStart = performance.now();
        await videoSource.add(time, 1 / fullSettings.frameRate);
        timings.encodeMs += performance.now() - encodeStart;
        if (frame === 0) {
          logExport("first frame encode complete");
        }
        frameImage.close();

        this.currentExport!.framesRendered = frame + 1;
        timings.frames = frame + 1;

        if ((frame + 1) % yieldFrameWindow === 0) {
          const idleStart = performance.now();
          await new Promise((resolve) => setTimeout(resolve, 0));
          timings.idleMs += performance.now() - idleStart;
        }
        if ((frame + 1) % logFrameWindow === 0) {
          const videoCacheStats = this.videoEngine?.getCacheStats();
          logExport("render progress", {
            frame: frame + 1,
            totalFrames,
            bytesWritten,
            avgRenderMs: Math.round(timings.renderMs / timings.frames),
            avgEncodeMs: Math.round(timings.encodeMs / timings.frames),
            avgUpscaleMs: timings.upscaleMs > 0
              ? Math.round(timings.upscaleMs / timings.frames)
              : 0,
            idleMs: Math.round(timings.idleMs),
            frameCacheEntries: videoCacheStats?.entries,
            frameCacheMB: videoCacheStats
              ? Math.round(videoCacheStats.sizeBytes / 1024 / 1024)
              : undefined,
            mediaFrameCacheEntries: mediaEngine.getFrameCacheSize(),
          });
        }

        yield this.createProgress(
          "rendering",
          (frame + 1) / totalFrames,
          totalFrames,
          frame + 1,
          bytesWritten,
        );
      }

      videoSource.close();
      logExport("video source closed", {
        bytesWritten,
        frames: timings.frames,
        renderMs: Math.round(timings.renderMs),
        encodeMs: Math.round(timings.encodeMs),
        upscaleMs: Math.round(timings.upscaleMs),
        idleMs: Math.round(timings.idleMs),
      });
      mediaEngine.disposeAllExportDecoders();
      mediaEngine.clearFrameCache();
      this.videoEngine?.clearVideoElementCache();
      this.videoEngine?.clearCache();
      if (this.videoEngine) {
        this.videoEngine.exportMode = false;
      }

      yield this.createProgress(
        "muxing",
        0.98,
        totalFrames,
        totalFrames,
        bytesWritten,
      );

      logExport("finalize start");
      await output.finalize();
      logExport("finalize complete", { bytesWritten });
      logExport("writable close start");
      await writableStream.close();
      logExport("writable close complete", { bytesWritten });

      yield this.createProgress(
        "complete",
        1,
        totalFrames,
        totalFrames,
        bytesWritten,
      );

      return {
        success: true,
        stats: this.calculateStats(totalFrames, bytesWritten),
      };
    } catch (error) {
      logExport("failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      try { await writableStream.abort(); } catch {}
      if (error && typeof error === "object" && "code" in error) {
        return { success: false, error: error as ExportError };
      }
      return {
        success: false,
        error: this.createError(
          "FRAME_ENCODE_FAILED",
          error instanceof Error ? error.message : "Unknown error",
          "rendering",
        ),
      };
    } finally {
      this.abortController = null;
      this.currentExport = null;
      this.audioEngine?.clearCache();
      this.videoEngine?.clearVideoElementCache();
      this.videoEngine?.clearCache();
      if (this.videoEngine) {
        this.videoEngine.exportMode = false;
      }
      try {
        getMediaEngine().disposeAllExportDecoders();
        getMediaEngine().clearFrameCache();
      } catch {}
      logExport("cleanup complete");
    }
  }

  private terminateWorker(): void {
    if (this.exportWorker) {
      this.exportWorker.terminate();
      this.exportWorker = null;
    }
  }

  private resolveAvatarFastPathPlan(project: Project): AvatarFastPathPlan | null {
    if (project.timeline.subtitles?.length) return null;
    if (project.textClips?.length || project.shapeClips?.length || project.svgClips?.length || project.stickerClips?.length) {
      return null;
    }

    const mediaById = new Map(project.mediaLibrary.items.map((item) => [item.id, item]));
    const tracks: AvatarFastPathVisualTrack[] = [];
    const videoMediaIds = new Set<string>();
    const imageMediaIds = new Set<string>();
    let hasAvatarClip = false;

    for (let originalIndex = 0; originalIndex < project.timeline.tracks.length; originalIndex++) {
      const track = project.timeline.tracks[originalIndex];
      if (track.hidden || track.clips.length === 0) continue;

      if (track.type === "audio") continue;
      if (track.type === "text" || track.type === "graphics") return null;
      if (track.transitions?.length) return null;
      if (track.type !== "video" && track.type !== "image") return null;

      const isAvatarTrack = track.clips.some((clip) => this.isAvatarFastPathClip(clip));
      const isBackgroundTrack = this.isFastPathBackgroundTrack(track);

      if (!isAvatarTrack && !isBackgroundTrack) return null;

      for (const clip of track.clips) {
        if (!this.isStaticFastPathClip(clip)) return null;
        const media = mediaById.get(clip.mediaId);
        if (!media?.blob) return null;
        if (media.type !== "video" && media.type !== "image") return null;
        if (media.type === "video") videoMediaIds.add(media.id);
        if (media.type === "image") imageMediaIds.add(media.id);
        if (this.isAvatarFastPathClip(clip)) hasAvatarClip = true;
      }

      tracks.push({
        track,
        originalIndex,
        role: isAvatarTrack ? "avatar" : "background",
      });
    }

    if (!hasAvatarClip || tracks.length === 0) return null;

    return {
      tracks: tracks.sort((a, b) => b.originalIndex - a.originalIndex),
      videoMediaIds: Array.from(videoMediaIds),
      imageMediaIds: Array.from(imageMediaIds),
    };
  }

  private isAvatarFastPathClip(clip: Clip): boolean {
    const kind = clip.metadata?.kind;
    return kind === "avatar-generated" || kind === "avatar-action-overlay";
  }

  private isFastPathBackgroundTrack(track: Track): boolean {
    return track.name.trim().toLowerCase() === "background";
  }

  private isStaticFastPathClip(clip: Clip): boolean {
    return (
      (clip.effects?.length ?? 0) === 0 &&
      (clip.audioEffects?.length ?? 0) === 0 &&
      (clip.keyframes?.length ?? 0) === 0 &&
      !clip.reversed &&
      !clip.smoothSlowMo &&
      (clip.speed === undefined || clip.speed === 1) &&
      !clip.stabilization?.enabled &&
      (!clip.emphasisAnimation || clip.emphasisAnimation.type === "none")
    );
  }

  private resolveFastPathSequenceActionMap(
    project: Project,
  ): Map<string, FastPathSequenceActionPlan> {
    const sequenceConfig = (project.metadata?.avatar as {
      sequenceConfig?: Record<string, unknown>;
    } | undefined)?.sequenceConfig;
    const actions = [
      ...(Array.isArray(sequenceConfig?.idle) ? sequenceConfig.idle : []),
      ...(Array.isArray(sequenceConfig?.speaking) ? sequenceConfig.speaking : []),
      ...(Array.isArray(sequenceConfig?.actions) ? sequenceConfig.actions : []),
    ] as Array<Record<string, unknown>>;
    const plans = new Map<string, FastPathSequenceActionPlan>();

    for (const action of actions) {
      const id = typeof action.id === "string" ? action.id : null;
      const frames = Array.isArray(action.frames)
        ? (action.frames as Array<Record<string, unknown>>)
        : [];
      if (!id || frames.length === 0) continue;

      const defaultDuration =
        typeof action.frameDurationSec === "number" &&
        Number.isFinite(action.frameDurationSec) &&
        action.frameDurationSec > 0
          ? action.frameDurationSec
          : 0.4;
      const framePlan = frames
        .map((frame) => {
          const mediaId = typeof frame.mediaId === "string" ? frame.mediaId : "";
          const duration =
            typeof frame.durationSec === "number" &&
            Number.isFinite(frame.durationSec) &&
            frame.durationSec > 0
              ? frame.durationSec
              : defaultDuration;
          return {
            mediaId,
            duration: Math.max(0.001, duration),
            transform: this.normalizeFastPathOptionalTransform(frame.transform),
          };
        })
        .filter((frame) => frame.mediaId);

      const totalDuration = framePlan.reduce(
        (total, frame) => total + frame.duration,
        0,
      );
      const transform = this.normalizeFastPathTransform(action.transform);
      if (totalDuration <= 0) continue;

      plans.set(id, {
        id,
        frames: framePlan,
        totalDuration,
        transform,
      });
    }

    return plans;
  }

  private normalizeFastPathTransform(value: unknown): Transform {
    const transform = (value ?? {}) as Partial<Transform>;
    return {
      position: transform.position ?? { x: 0, y: 0 },
      scale: transform.scale ?? { x: 1, y: 1 },
      rotation: transform.rotation ?? 0,
      anchor: transform.anchor ?? { x: 0.5, y: 0.5 },
      opacity: transform.opacity ?? 1,
      fitMode: transform.fitMode ?? "none",
      crop: transform.crop,
      borderRadius: transform.borderRadius,
      rotate3d: transform.rotate3d,
      perspective: transform.perspective,
      transformStyle: transform.transformStyle,
    };
  }

  private normalizeFastPathOptionalTransform(value: unknown): Transform | undefined {
    return value ? this.normalizeFastPathTransform(value) : undefined;
  }

  private async *exportAvatarFastPath(
    project: Project,
    fullSettings: VideoExportSettings,
    writableStream: FileSystemWritableFileStream,
    totalFrames: number,
    timelineDuration: number,
    plan: AvatarFastPathPlan,
    sequenceActionMap: Map<string, FastPathSequenceActionPlan>,
    logExport: (stage: string, details?: Record<string, unknown>) => void,
  ): AsyncGenerator<ExportProgress, ExportResult> {
    const timings = {
      drawMs: 0,
      encodeMs: 0,
      idleMs: 0,
      frames: 0,
    };
    let bytesWritten = 0;
    const mediaById = new Map(project.mediaLibrary.items.map((item) => [item.id, item]));
    const imageCache = new Map<string, ImageBitmap>();
    const videoFrameCache = new Map<string, FastPathVideoFrameCacheEntry>();
    const sequenceFrameCache = new Map<string, FastPathVideoFrameCacheEntry>();
    const mediaEngine = getMediaEngine();

    try {
      yield this.createProgress("preparing", 0, totalFrames, 0, 0);

      if (!mediaEngine.isAvailable()) {
        await mediaEngine.initialize();
      }

      const {
        Output,
        StreamTarget,
        Mp4OutputFormat,
        WebMOutputFormat,
        MovOutputFormat,
        CanvasSource,
        AudioBufferSource,
        getFirstEncodableVideoCodec,
        getFirstEncodableAudioCodec,
        QUALITY_MEDIUM,
      } = this.mediabunny!;

      const diskWriter = writableStream;
      const chunkWriter = new WritableStream<{ data: Uint8Array; position: number }>({
        async write(chunk) {
          const buf = chunk.data.buffer.slice(
            chunk.data.byteOffset,
            chunk.data.byteOffset + chunk.data.byteLength,
          ) as ArrayBuffer;
          await diskWriter.seek(chunk.position);
          await diskWriter.write(buf);
          bytesWritten += chunk.data.byteLength;
        },
      });

      let outputFormat;
      switch (fullSettings.format) {
        case "webm":
          outputFormat = new WebMOutputFormat();
          break;
        case "mov":
          outputFormat = new MovOutputFormat();
          break;
        case "mp4":
        default:
          outputFormat = new Mp4OutputFormat({ fastStart: false });
          break;
      }

      const target = new StreamTarget(chunkWriter, {
        chunked: true,
        chunkSize: 4 * 1024 * 1024,
      });
      const output = new Output({ format: outputFormat, target });

      const videoCodec = await getFirstEncodableVideoCodec(
        outputFormat.getSupportedVideoCodecs(),
        { width: fullSettings.width, height: fullSettings.height },
      );
      if (!videoCodec) {
        throw this.createError(
          "UNSUPPORTED_CODEC",
          "No supported video codec found",
          "preparing",
        );
      }

      const audioCodecResult = await this.findSupportedAudioCodec(
        outputFormat,
        fullSettings.audioSettings,
        getFirstEncodableAudioCodec,
      );
      const hardwareSupport = await this.probeVideoEncoderHardwareSupport({
        codec: String(videoCodec),
        width: fullSettings.width,
        height: fullSettings.height,
        bitrate: fullSettings.bitrate ? fullSettings.bitrate * 1000 : 8_000_000,
        frameRate: fullSettings.frameRate,
      });
      logExport("avatar fast video encoder support", hardwareSupport);

      const exportCanvas = new OffscreenCanvas(fullSettings.width, fullSettings.height);
      const exportCtx = exportCanvas.getContext("2d", {
        alpha: fullSettings.format === "webm",
      }) as OffscreenCanvasRenderingContext2D | null;
      if (!exportCtx) {
        throw this.createError(
          "FRAME_ENCODE_FAILED",
          "Could not create avatar fast export canvas context",
          "preparing",
        );
      }
      exportCtx.imageSmoothingEnabled = true;
      exportCtx.imageSmoothingQuality = "high";

      const videoSource = new CanvasSource(exportCanvas, {
        codec: videoCodec,
        bitrate: fullSettings.bitrate ? fullSettings.bitrate * 1000 : QUALITY_MEDIUM,
        keyFrameInterval: fullSettings.keyframeInterval / fullSettings.frameRate,
        hardwareAcceleration: "prefer-hardware",
        onEncoderConfig: (config) => {
          logExport("avatar fast video encoder config", {
            codec: config.codec,
            width: config.width,
            height: config.height,
            bitrate: config.bitrate,
            framerate: config.framerate,
            hardwareAcceleration: config.hardwareAcceleration,
          });
        },
      });
      const audioSource = new AudioBufferSource({
        codec: audioCodecResult.codec as "aac" | "opus" | "mp3",
        bitrate: audioCodecResult.bitrate,
      });

      output.addVideoTrack(videoSource);
      output.addAudioTrack(audioSource);
      output.setMetadataTags({
        title: project.name,
        date: new Date(),
      });

      await output.start();
      logExport("avatar fast output started", {
        videoCodec,
        audioCodec: audioCodecResult.codec,
      });

      try {
        logExport("avatar fast audio encode start");
        await this.encodeTimelineAudioToSource(project, audioSource);
        logExport("avatar fast audio encode complete");
      } finally {
        this.audioEngine?.clearCache();
      }
      audioSource.close();

      for (const mediaId of plan.videoMediaIds) {
        const media = mediaById.get(mediaId);
        if (!media?.blob) continue;
        await mediaEngine.createExportDecoder(
          media.id,
          media.blob,
          this.getFastPathDecodeWidth(media, fullSettings),
        );
      }
      logExport("avatar fast decoders prepared", {
        videoMediaCount: plan.videoMediaIds.length,
        imageMediaCount: plan.imageMediaIds.length,
      });

      const logFrameWindow = Math.max(1, fullSettings.frameRate * 5);
      const yieldFrameWindow = Math.max(1, fullSettings.frameRate);

      for (let frame = 0; frame < totalFrames; frame++) {
        if (this.abortController?.signal.aborted) {
          throw this.createError(
            "CANCELLED",
            "Export cancelled by user",
            "rendering",
          );
        }

        const time = Math.min(frame / fullSettings.frameRate, timelineDuration);
        const drawStart = performance.now();
        exportCtx.clearRect(0, 0, fullSettings.width, fullSettings.height);
        if (fullSettings.format !== "webm") {
          exportCtx.fillStyle = "#000000";
          exportCtx.fillRect(0, 0, fullSettings.width, fullSettings.height);
        }

        for (const { track } of plan.tracks) {
          const activeClips = this.getFastPathActiveClips(track, time);
          for (const clip of activeClips) {
            const media = mediaById.get(clip.mediaId);
            if (!media?.blob) continue;
            const frameImage = await this.getFastPathFrame(
              media,
              clip,
              time,
              imageCache,
              videoFrameCache,
              sequenceFrameCache,
              sequenceActionMap,
              mediaById,
              fullSettings,
            );
            if (!frameImage) continue;
            this.drawFastPathFrame(
              exportCtx,
              frameImage,
              clip.transform,
              fullSettings.width,
              fullSettings.height,
            );
          }
        }

        timings.drawMs += performance.now() - drawStart;

        const encodeStart = performance.now();
        await videoSource.add(time, 1 / fullSettings.frameRate);
        timings.encodeMs += performance.now() - encodeStart;

        this.currentExport!.framesRendered = frame + 1;
        timings.frames = frame + 1;

        if ((frame + 1) % yieldFrameWindow === 0) {
          const idleStart = performance.now();
          await new Promise((resolve) => setTimeout(resolve, 0));
          timings.idleMs += performance.now() - idleStart;
        }

        if ((frame + 1) % logFrameWindow === 0) {
          logExport("avatar fast render progress", {
            frame: frame + 1,
            totalFrames,
            bytesWritten,
            avgDrawMs: Math.round(timings.drawMs / timings.frames),
            avgEncodeMs: Math.round(timings.encodeMs / timings.frames),
            idleMs: Math.round(timings.idleMs),
            mediaFrameCacheEntries: mediaEngine.getFrameCacheSize(),
            videoFrameCacheEntries: videoFrameCache.size,
            sequenceFrameCacheEntries: sequenceFrameCache.size,
          });
        }

        yield this.createProgress(
          "rendering",
          (frame + 1) / totalFrames,
          totalFrames,
          frame + 1,
          bytesWritten,
        );
      }

      videoSource.close();
      logExport("avatar fast video source closed", {
        bytesWritten,
        frames: timings.frames,
        drawMs: Math.round(timings.drawMs),
        encodeMs: Math.round(timings.encodeMs),
        idleMs: Math.round(timings.idleMs),
      });

      yield this.createProgress("muxing", 0.98, totalFrames, totalFrames, bytesWritten);
      await output.finalize();
      await writableStream.close();
      logExport("avatar fast finalize complete", { bytesWritten });

      yield this.createProgress("complete", 1, totalFrames, totalFrames, bytesWritten);
      return {
        success: true,
        stats: this.calculateStats(totalFrames, bytesWritten),
      };
    } catch (error) {
      logExport("avatar fast failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      try { await writableStream.abort(); } catch {}
      if (error && typeof error === "object" && "code" in error) {
        return { success: false, error: error as ExportError };
      }
      return {
        success: false,
        error: this.createError(
          "FRAME_ENCODE_FAILED",
          error instanceof Error ? error.message : "Unknown avatar fast export error",
          "rendering",
        ),
      };
    } finally {
      this.abortController = null;
      this.currentExport = null;
      for (const bitmap of imageCache.values()) {
        try { bitmap.close(); } catch {}
      }
      imageCache.clear();
      this.clearFastPathVideoFrameCache(videoFrameCache);
      this.clearFastPathVideoFrameCache(sequenceFrameCache);
      this.audioEngine?.clearCache();
      try {
        mediaEngine.disposeAllExportDecoders();
        mediaEngine.clearFrameCache();
      } catch {}
      logExport("avatar fast cleanup complete");
    }
  }

  private getFastPathDecodeWidth(
    media: MediaItem,
    settings: VideoExportSettings,
  ): number {
    const width = media.metadata.width;
    if (Number.isFinite(width) && width > 0) {
      return Math.min(width, settings.width);
    }
    return settings.width;
  }

  private getFastPathActiveClips(track: Track, time: number): Clip[] {
    return track.clips.filter((clip) => {
      const clipEnd = clip.startTime + clip.duration;
      return time >= clip.startTime && time < clipEnd;
    });
  }

  private async getFastPathFrame(
    media: MediaItem,
    clip: Clip,
    time: number,
    imageCache: Map<string, ImageBitmap>,
    videoFrameCache: Map<string, FastPathVideoFrameCacheEntry>,
    sequenceFrameCache: Map<string, FastPathVideoFrameCacheEntry>,
    sequenceActionMap: Map<string, FastPathSequenceActionPlan>,
    mediaById: Map<string, MediaItem>,
    settings: VideoExportSettings,
  ): Promise<DrawableFrame | null> {
    if (!media.blob) return null;
    if (media.type === "image") {
      let bitmap = imageCache.get(media.id);
      if (!bitmap) {
        bitmap = await createImageBitmap(media.blob);
        imageCache.set(media.id, bitmap);
      }
      return bitmap;
    }

    if (media.type !== "video") return null;
    const sequenceFrame = await this.getFastPathSequenceFrame(
      clip,
      time,
      imageCache,
      sequenceFrameCache,
      sequenceActionMap,
      mediaById,
      settings,
    );
    if (sequenceFrame) return sequenceFrame;

    const mediaEngine = getMediaEngine();
    let decoder = mediaEngine.getExportDecoder(media.id);
    if (!decoder) {
      decoder = await mediaEngine.createExportDecoder(
        media.id,
        media.blob,
        this.getFastPathDecodeWidth(media, settings),
      );
    }
    if (!decoder) return null;

    const localTime = Math.max(0, time - clip.startTime);
    const sourceDuration = media.metadata.duration;
    const maxSourceTime = Number.isFinite(sourceDuration) && sourceDuration > 0
      ? Math.max(0, sourceDuration - 1 / Math.max(1, settings.frameRate))
      : Infinity;
    const sourceTime = Math.min((clip.inPoint ?? 0) + localTime, maxSourceTime);
    const sourceFrameIndex = this.getFastPathSourceFrameIndex(
      sourceTime,
      settings.frameRate,
    );
    const cacheKey = this.getFastPathVideoFrameCacheKey(
      media.id,
      sourceFrameIndex,
      this.getFastPathDecodeWidth(media, settings),
    );
    const cached = videoFrameCache.get(cacheKey);
    if (cached) {
      cached.lastAccessed = performance.now();
      return cached.canvas;
    }

    await this.prefetchFastPathVideoFrames({
      decoder,
      media,
      startFrameIndex: sourceFrameIndex,
      maxSourceTime,
      settings,
      cache: videoFrameCache,
    });

    const prefetched = videoFrameCache.get(cacheKey);
    if (prefetched) {
      prefetched.lastAccessed = performance.now();
      return prefetched.canvas;
    }

    const canvas = await decoder.getFrame(sourceTime);
    if (!canvas) return null;
    this.setFastPathVideoFrameCache(
      videoFrameCache,
      cacheKey,
      this.cloneFastPathCanvas(canvas),
    );
    return videoFrameCache.get(cacheKey)?.canvas ?? canvas;
  }

  private getFastPathSourceFrameIndex(sourceTime: number, frameRate: number): number {
    return Math.max(0, Math.round(sourceTime * Math.max(1, frameRate)));
  }

  private async getFastPathSequenceFrame(
    clip: Clip,
    time: number,
    imageCache: Map<string, ImageBitmap>,
    sequenceFrameCache: Map<string, FastPathVideoFrameCacheEntry>,
    sequenceActionMap: Map<string, FastPathSequenceActionPlan>,
    mediaById: Map<string, MediaItem>,
    settings: VideoExportSettings,
  ): Promise<OffscreenCanvas | null> {
    if (clip.metadata?.source !== "sequence") return null;
    const sequenceActionId =
      typeof clip.metadata.sequenceActionId === "string"
        ? clip.metadata.sequenceActionId
        : null;
    if (!sequenceActionId) return null;
    const action = sequenceActionMap.get(sequenceActionId);
    if (!action) return null;

    const localTime = Math.max(0, time - clip.startTime + (clip.inPoint ?? 0));
    const actionTime =
      action.totalDuration > 0
        ? localTime % action.totalDuration
        : 0;
    const frame = this.getFastPathSequenceFrameAtTime(action, actionTime);
    if (!frame) return null;

    const cacheKey = [
      "sequence",
      action.id,
      frame.mediaId,
      settings.width,
      settings.height,
      JSON.stringify(action.transform),
      JSON.stringify(frame.transform ?? null),
    ].join(":");
    const cached = sequenceFrameCache.get(cacheKey);
    if (cached) {
      cached.lastAccessed = performance.now();
      return cached.canvas;
    }

    const media = mediaById.get(frame.mediaId);
    if (!media?.blob) return null;
    let bitmap = imageCache.get(media.id);
    if (!bitmap) {
      bitmap = await createImageBitmap(media.blob);
      imageCache.set(media.id, bitmap);
    }

    const canvas = new OffscreenCanvas(settings.width, settings.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.clearRect(0, 0, settings.width, settings.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    this.drawFastPathFrame(
      ctx as OffscreenCanvasRenderingContext2D,
      bitmap,
      this.combineFastPathTransforms(action.transform, frame.transform),
      settings.width,
      settings.height,
    );
    this.setFastPathVideoFrameCache(sequenceFrameCache, cacheKey, canvas);
    return canvas;
  }

  private getFastPathSequenceFrameAtTime(
    action: FastPathSequenceActionPlan,
    time: number,
  ): { mediaId: string; duration: number; transform?: Transform } | null {
    if (action.frames.length === 0) return null;
    let cursor = 0;
    for (const frame of action.frames) {
      cursor += frame.duration;
      if (time < cursor) return frame;
    }
    return action.frames[action.frames.length - 1] ?? null;
  }

  private combineFastPathTransforms(
    base: Transform,
    relative?: Transform,
  ): Transform {
    if (!relative) return base;
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

  private getFastPathVideoFrameCacheKey(
    mediaId: string,
    sourceFrameIndex: number,
    decodeWidth: number,
  ): string {
    return `${mediaId}:${decodeWidth}:${sourceFrameIndex}`;
  }

  private cloneFastPathCanvas(source: OffscreenCanvas): OffscreenCanvas {
    const clone = new OffscreenCanvas(source.width, source.height);
    const ctx = clone.getContext("2d");
    if (ctx) {
      ctx.drawImage(source, 0, 0);
    }
    return clone;
  }

  private setFastPathVideoFrameCache(
    cache: Map<string, FastPathVideoFrameCacheEntry>,
    key: string,
    canvas: OffscreenCanvas,
  ): void {
    const previous = cache.get(key);
    if (previous) {
      previous.canvas.width = 0;
      previous.canvas.height = 0;
    }
    cache.set(key, {
      canvas,
      lastAccessed: performance.now(),
    });
    this.trimFastPathVideoFrameCache(cache);
  }

  private trimFastPathVideoFrameCache(
    cache: Map<string, FastPathVideoFrameCacheEntry>,
  ): void {
    while (cache.size > ExportEngine.FAST_PATH_VIDEO_CACHE_MAX) {
      let oldestKey: string | null = null;
      let oldestAccess = Infinity;
      for (const [key, entry] of cache) {
        if (entry.lastAccessed < oldestAccess) {
          oldestAccess = entry.lastAccessed;
          oldestKey = key;
        }
      }
      if (!oldestKey) return;
      const oldest = cache.get(oldestKey);
      if (oldest) {
        oldest.canvas.width = 0;
        oldest.canvas.height = 0;
      }
      cache.delete(oldestKey);
    }
  }

  private clearFastPathVideoFrameCache(
    cache: Map<string, FastPathVideoFrameCacheEntry>,
  ): void {
    for (const entry of cache.values()) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
    cache.clear();
  }

  private async prefetchFastPathVideoFrames(params: {
    decoder: {
      getFramesAtTimestamps(
        timestamps: number[],
      ): Promise<Array<{ timestamp: number; canvas: OffscreenCanvas }>>;
      getFrame(timestamp: number): Promise<OffscreenCanvas | null>;
    };
    media: MediaItem;
    startFrameIndex: number;
    maxSourceTime: number;
    settings: VideoExportSettings;
    cache: Map<string, FastPathVideoFrameCacheEntry>;
  }): Promise<void> {
    const frameRate = Math.max(1, params.settings.frameRate);
    const decodeWidth = this.getFastPathDecodeWidth(params.media, params.settings);
    const frameCount = Math.max(
      1,
      Math.round(ExportEngine.FAST_PATH_PREFETCH_SECONDS * frameRate),
    );
    const timestamps: number[] = [];

    for (let offset = 0; offset < frameCount; offset++) {
      const frameIndex = params.startFrameIndex + offset;
      const timestamp = frameIndex / frameRate;
      if (timestamp > params.maxSourceTime) break;
      const key = this.getFastPathVideoFrameCacheKey(
        params.media.id,
        frameIndex,
        decodeWidth,
      );
      if (params.cache.has(key)) continue;
      timestamps.push(timestamp);
    }

    if (timestamps.length === 0) return;

    try {
      const frames = await params.decoder.getFramesAtTimestamps(timestamps);
      for (const frame of frames) {
        const frameIndex = this.getFastPathSourceFrameIndex(
          frame.timestamp,
          frameRate,
        );
        const key = this.getFastPathVideoFrameCacheKey(
          params.media.id,
          frameIndex,
          decodeWidth,
        );
        this.setFastPathVideoFrameCache(params.cache, key, frame.canvas);
      }
    } catch {
      const timestamp = params.startFrameIndex / frameRate;
      const frame = await params.decoder.getFrame(timestamp);
      if (!frame) return;
      const key = this.getFastPathVideoFrameCacheKey(
        params.media.id,
        params.startFrameIndex,
        decodeWidth,
      );
      this.setFastPathVideoFrameCache(
        params.cache,
        key,
        this.cloneFastPathCanvas(frame),
      );
    }
  }

  private drawFastPathFrame(
    ctx: OffscreenCanvasRenderingContext2D,
    frame: DrawableFrame,
    transform: Transform,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    ctx.save();
    ctx.globalAlpha = transform.opacity ?? 1;
    ctx.translate(
      canvasWidth / 2 + (transform.position?.x ?? 0),
      canvasHeight / 2 + (transform.position?.y ?? 0),
    );
    ctx.rotate(((transform.rotation ?? 0) * Math.PI) / 180);
    ctx.scale(transform.scale?.x ?? 1, transform.scale?.y ?? 1);

    const sourceWidth = frame.width;
    const sourceHeight = frame.height;
    const fitMode = transform.fitMode ?? "none";
    let drawWidth = sourceWidth;
    let drawHeight = sourceHeight;

    if (fitMode !== "none") {
      const sourceAspect = sourceWidth / sourceHeight;
      const canvasAspect = canvasWidth / canvasHeight;
      if (fitMode === "stretch") {
        drawWidth = canvasWidth;
        drawHeight = canvasHeight;
      } else if (fitMode === "cover") {
        if (sourceAspect > canvasAspect) {
          drawHeight = canvasHeight;
          drawWidth = canvasHeight * sourceAspect;
        } else {
          drawWidth = canvasWidth;
          drawHeight = canvasWidth / sourceAspect;
        }
      } else {
        if (sourceAspect > canvasAspect) {
          drawWidth = canvasWidth;
          drawHeight = canvasWidth / sourceAspect;
        } else {
          drawHeight = canvasHeight;
          drawWidth = canvasHeight * sourceAspect;
        }
      }
    }

    const anchor = transform.anchor ?? { x: 0.5, y: 0.5 };
    const drawX = -drawWidth * anchor.x;
    const drawY = -drawHeight * anchor.y;

    if (transform.crop) {
      const sx = transform.crop.x * sourceWidth;
      const sy = transform.crop.y * sourceHeight;
      const sWidth = transform.crop.width * sourceWidth;
      const sHeight = transform.crop.height * sourceHeight;
      ctx.drawImage(frame, sx, sy, sWidth, sHeight, drawX, drawY, drawWidth, drawHeight);
    } else {
      ctx.drawImage(frame, drawX, drawY, drawWidth, drawHeight);
    }

    ctx.restore();
  }

  async *exportAudio(
    project: Project,
    settings: Partial<AudioExportSettings> = {},
  ): AsyncGenerator<ExportProgress, ExportResult> {
    this.ensureInitialized();

    const fullSettings: AudioExportSettings = {
      ...DEFAULT_AUDIO_SETTINGS,
      ...settings,
    };

    if (!this.mediabunny && fullSettings.format !== "wav") {
      return {
        success: false,
        error: this.createError(
          "UNSUPPORTED_CODEC",
          `Audio export to ${fullSettings.format} format requires MediaBunny. WAV format is available as a fallback.`,
          "preparing",
        ),
      };
    }

    this.abortController = new AbortController();
    this.currentExport = { startTime: Date.now(), framesRendered: 0 };

    const { timeline } = project;
    const timelineDuration = this.calculateTimelineDuration(timeline);

    if (timelineDuration <= 0) {
      return {
        success: false,
        error: this.createError(
          "AUDIO_ENCODE_FAILED",
          "Timeline is empty. Add clips before exporting.",
          "preparing",
        ),
      };
    }

    try {
      yield this.createProgress("preparing", 0, 1, 0, 0);
      const audioBuffer = await this.renderTimelineAudio(project);

      if (!audioBuffer) {
        throw this.createError(
          "AUDIO_ENCODE_FAILED",
          "No audio to export",
          "rendering",
        );
      }

      yield this.createProgress("encoding", 0.5, 1, 0, 0);

      // Encode based on format
      let blob: Blob;

      if (fullSettings.format === "wav") {
        blob = this.encodeWav(audioBuffer, fullSettings);
      } else {
        // Use MediaBunny for other formats
        blob = await this.encodeAudioWithMediaBunny(audioBuffer, fullSettings);
      }

      yield this.createProgress("complete", 1, 1, 1, blob.size);

      return {
        success: true,
        blob,
        stats: {
          duration: Date.now() - this.currentExport!.startTime,
          framesRendered: 1,
          averageSpeed: 1,
          fileSize: blob.size,
          averageBitrate: (blob.size * 8) / timelineDuration,
        },
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        return { success: false, error: error as ExportError };
      }
      return {
        success: false,
        error: this.createError(
          "AUDIO_ENCODE_FAILED",
          error instanceof Error ? error.message : "Unknown error",
          "encoding",
        ),
      };
    } finally {
      this.abortController = null;
      this.currentExport = null;
    }
  }

  async exportFrame(
    project: Project,
    time: number,
    settings: Partial<ImageExportSettings> = {},
  ): Promise<ExportResult> {
    this.ensureInitialized();

    const fullSettings: ImageExportSettings = {
      ...DEFAULT_IMAGE_SETTINGS,
      width: project.settings.width,
      height: project.settings.height,
      ...settings,
    };

    try {
      const renderedFrame = await this.videoEngine!.renderFrame(
        project,
        time,
        fullSettings.width,
        fullSettings.height,
      );

      // Scale if needed (fallback in case render didn't match)
      let canvas: OffscreenCanvas;
      if (
        fullSettings.width !== renderedFrame.width ||
        fullSettings.height !== renderedFrame.height
      ) {
        canvas = new OffscreenCanvas(fullSettings.width, fullSettings.height);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(
            renderedFrame.image,
            0,
            0,
            fullSettings.width,
            fullSettings.height,
          );
        }
        renderedFrame.image.close();
      } else {
        canvas = new OffscreenCanvas(renderedFrame.width, renderedFrame.height);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(renderedFrame.image, 0, 0);
        }
        renderedFrame.image.close();
      }
      const mimeType = this.getImageMimeType(fullSettings.format);
      const blob = await canvas.convertToBlob({
        type: mimeType,
        quality: fullSettings.quality / 100,
      });

      return {
        success: true,
        blob,
        stats: {
          duration: 0,
          framesRendered: 1,
          averageSpeed: 0,
          fileSize: blob.size,
          averageBitrate: 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this.createError(
          "FRAME_ENCODE_FAILED",
          error instanceof Error ? error.message : "Unknown error",
          "rendering",
        ),
      };
    }
  }

  async exportImage(
    project: Project,
    settings: Partial<ImageExportSettings> = {},
  ): Promise<ExportResult> {
    return this.exportFrame(project, 0, settings);
  }

  async *exportImageSequence(
    project: Project,
    settings: Partial<SequenceExportSettings> = {},
  ): AsyncGenerator<ExportProgress, ExportResult> {
    this.ensureInitialized();

    const { timeline } = project;
    const frameRate = project.settings.frameRate;
    const totalFrames = Math.ceil(timeline.duration * frameRate);

    const fullSettings: SequenceExportSettings = {
      ...DEFAULT_IMAGE_SETTINGS,
      width: project.settings.width,
      height: project.settings.height,
      startFrame: 0,
      endFrame: totalFrames - 1,
      namingPattern: "frame_{0000}",
      ...settings,
    };

    this.abortController = new AbortController();
    this.currentExport = { startTime: Date.now(), framesRendered: 0 };

    const framesToExport = fullSettings.endFrame - fullSettings.startFrame + 1;
    const blobs: Blob[] = [];

    try {
      yield this.createProgress("preparing", 0, framesToExport, 0, 0);

      for (let i = 0; i < framesToExport; i++) {
        if (this.abortController.signal.aborted) {
          throw this.createError(
            "CANCELLED",
            "Export cancelled by user",
            "rendering",
          );
        }

        const frameNumber = fullSettings.startFrame + i;
        const time = frameNumber / frameRate;

        const result = await this.exportFrame(project, time, fullSettings);
        if (result.success && result.blob) {
          blobs.push(result.blob);
        }

        this.currentExport!.framesRendered = i + 1;

        yield this.createProgress(
          "rendering",
          (i + 1) / framesToExport,
          framesToExport,
          i + 1,
          blobs.reduce((sum, b) => sum + b.size, 0),
        );
      }

      yield this.createProgress(
        "complete",
        1,
        framesToExport,
        framesToExport,
        0,
      );

      const totalSize = blobs.reduce((sum, b) => sum + b.size, 0);

      return {
        success: true,
        blob: blobs[0],
        stats: this.calculateStats(framesToExport, totalSize),
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        return { success: false, error: error as ExportError };
      }
      return {
        success: false,
        error: this.createError(
          "FRAME_ENCODE_FAILED",
          error instanceof Error ? error.message : "Unknown error",
          "rendering",
        ),
      };
    } finally {
      this.abortController = null;
      this.currentExport = null;
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  getPresets(): ExportPreset[] {
    return [
      {
        id: "4k-master",
        name: "4K Master Quality",
        description: "Maximum quality 4K for professional delivery",
        category: "broadcast",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["4k-high"],
          codec: "h265",
          quality: 95,
        },
      },
      {
        id: "4k-prores-hq",
        name: "4K ProRes HQ",
        description: "Professional 4K ProRes for editing/mastering",
        category: "broadcast",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          width: 3840,
          height: 2160,
          frameRate: 30,
          format: "mov",
          codec: "prores",
          proresProfile: "hq",
          bitrate: 880000,
          quality: 100,
        },
      },
      {
        id: "4k-prores-4444",
        name: "4K ProRes 4444",
        description: "Highest quality ProRes with alpha channel support",
        category: "broadcast",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          width: 3840,
          height: 2160,
          frameRate: 30,
          format: "mov",
          codec: "prores",
          proresProfile: "4444",
          bitrate: 1320000,
          quality: 100,
        },
      },
      {
        id: "youtube-4k",
        name: "YouTube 4K",
        description: "4K UHD optimized for YouTube",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["4k"],
          codec: "h264",
        },
      },
      {
        id: "youtube-4k-60",
        name: "YouTube 4K 60fps",
        description: "4K 60fps for YouTube gaming/motion",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["4k-60"],
          codec: "h264",
        },
      },
      {
        id: "youtube-1080p-high",
        name: "YouTube 1080p High",
        description: "High bitrate 1080p for YouTube",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["1080p-high"],
          codec: "h264",
        },
      },
      {
        id: "youtube-1080p",
        name: "YouTube 1080p",
        description: "Standard 1080p for YouTube",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["1080p"],
          codec: "h264",
        },
      },
      {
        id: "tiktok-1080p",
        name: "TikTok/Reels",
        description: "Vertical 1080x1920 for TikTok/Reels",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          width: 1080,
          height: 1920,
          bitrate: 15000,
          frameRate: 30,
          codec: "h264",
        },
      },
      {
        id: "twitter",
        name: "Twitter/X",
        description: "Optimized for Twitter",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["720p"],
          codec: "h264",
        },
      },
      {
        id: "web-vp9",
        name: "Web (VP9)",
        description: "WebM VP9 for web embedding (720p for stability)",
        category: "web",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          format: "webm",
          codec: "vp9",
          ...VIDEO_QUALITY_PRESETS["720p"],
        },
      },
      {
        id: "archive-4k",
        name: "Archive 4K",
        description: "High quality 4K for archival",
        category: "archive",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["4k-high"],
          codec: "h265",
        },
      },
      {
        id: "archive-prores",
        name: "Archive ProRes",
        description: "Lossless quality ProRes for archival",
        category: "archive",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          width: 1920,
          height: 1080,
          format: "mov",
          codec: "prores",
          proresProfile: "hq",
          bitrate: 220000,
          quality: 100,
        },
      },
      {
        id: "audio-mp3",
        name: "MP3 Audio",
        description: "MP3 320kbps",
        category: "custom",
        settings: DEFAULT_AUDIO_SETTINGS,
      },
      {
        id: "audio-wav",
        name: "WAV Audio",
        description: "Uncompressed WAV 24-bit",
        category: "archive",
        settings: {
          ...DEFAULT_AUDIO_SETTINGS,
          format: "wav",
          bitDepth: 24,
          sampleRate: 48000,
        },
      },
    ];
  }

  createPreset(
    name: string,
    settings: VideoExportSettings | AudioExportSettings | ImageExportSettings,
  ): ExportPreset {
    return {
      id: `custom-${Date.now()}`,
      name,
      description: "Custom preset",
      settings,
      category: "custom",
    };
  }

  estimateFileSize(
    project: Project,
    settings: VideoExportSettings | AudioExportSettings,
  ): number {
    const duration = project.timeline.duration;

    if ("codec" in settings) {
      const videoBitrate = settings.bitrate * 1000;
      const audioBitrate = settings.audioSettings.bitrate * 1000;
      return Math.ceil(((videoBitrate + audioBitrate) * duration) / 8);
    } else {
      if (settings.format === "wav") {
        return Math.ceil(
          duration *
            settings.sampleRate *
            settings.channels *
            (settings.bitDepth / 8),
        );
      }
      return Math.ceil((settings.bitrate * 1000 * duration) / 8);
    }
  }

  estimateExportTime(
    project: Project,
    settings: VideoExportSettings | AudioExportSettings,
  ): number {
    const duration = project.timeline.duration;

    if ("codec" in settings) {
      const pixelCount = settings.width * settings.height;
      const complexity = pixelCount / (1920 * 1080);
      const codecFactor =
        settings.codec === "h265" || settings.codec === "av1" ? 2 : 1;
      return duration * complexity * codecFactor * 0.5;
    } else {
      return duration * 0.1;
    }
  }

  private async renderTimelineAudio(
    project: Project,
    startTime: number = 0,
    duration?: number,
  ): Promise<AudioBuffer | null> {
    const { timeline } = project;

    const hasAudio = timeline.tracks.some(
      (track) =>
        (track.type === "audio" || track.type === "video") &&
        !track.muted &&
        track.clips.length > 0,
    );

    if (!hasAudio) {
      return null;
    }

    const timelineDuration = this.calculateTimelineDuration(timeline);
    if (timelineDuration <= 0) {
      return null;
    }

    const renderDuration = Math.max(
      0,
      Math.min(duration ?? timelineDuration, timelineDuration - startTime),
    );
    if (renderDuration <= 0) {
      return null;
    }

    const rendered = await this.audioEngine!.renderAudio(
      project,
      startTime,
      renderDuration,
    );

    return rendered.buffer;
  }

  private async encodeTimelineAudioToSource(
    project: Project,
    audioSource: InstanceType<typeof import("mediabunny").AudioBufferSource>,
  ): Promise<void> {
    const timelineDuration = this.calculateTimelineDuration(project.timeline);
    if (timelineDuration <= 0) {
      return;
    }

    const chunkDuration = ExportEngine.AUDIO_EXPORT_CHUNK_DURATION_SECONDS;

    for (
      let startTime = 0;
      startTime < timelineDuration;
      startTime += chunkDuration
    ) {
      if (this.abortController?.signal.aborted) {
        throw this.createError(
          "CANCELLED",
          "Export cancelled by user",
          "encoding",
        );
      }

      const currentChunkDuration = Math.min(
        chunkDuration,
        timelineDuration - startTime,
      );
      const audioBuffer = await this.renderTimelineAudio(
        project,
        startTime,
        currentChunkDuration,
      );

      if (!audioBuffer) {
        continue;
      }

      await audioSource.add(audioBuffer);

      // Yield between chunks so the browser can reclaim the previous buffer
      // before the next long-running render starts.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  private async encodeAudioWithMediaBunny(
    buffer: AudioBuffer,
    settings: AudioExportSettings,
  ): Promise<Blob> {
    const {
      Output,
      BufferTarget,
      Mp3OutputFormat,
      AudioSampleSource,
      AudioSample,
      getFirstEncodableAudioCodec,
    } = this.mediabunny!;
    let outputFormat;
    switch (settings.format) {
      case "mp3":
        outputFormat = new Mp3OutputFormat();
        break;
      case "aac":
      case "flac":
      case "ogg":
      default:
        return this.encodeWav(buffer, settings);
    }

    const target = new BufferTarget();
    const output = new Output({ format: outputFormat, target });

    const audioCodec = await getFirstEncodableAudioCodec(
      outputFormat.getSupportedAudioCodecs(),
    );

    const audioSource = new AudioSampleSource({
      codec: audioCodec || "mp3",
      bitrate: settings.bitrate * 1000,
    });

    output.addAudioTrack(audioSource);
    await output.start();
    const audioSamples = AudioSample.fromAudioBuffer(buffer, 0);
    for (const sample of audioSamples) {
      await audioSource.add(sample);
      sample.close();
    }

    audioSource.close();
    await output.finalize();

    const resultBuffer = target.buffer;
    if (!resultBuffer) {
      throw new Error("Audio encoding failed");
    }

    return new Blob([resultBuffer], {
      type: this.getAudioMimeType(settings.format),
    });
  }

  private encodeWav(buffer: AudioBuffer, settings: AudioExportSettings): Blob {
    const numberOfChannels = Math.min(
      buffer.numberOfChannels,
      settings.channels,
    );
    const sampleRate = settings.sampleRate;
    const bitDepth = settings.bitDepth;

    if (bitDepth === 32) {
      return this.encodeWav32Float(buffer, numberOfChannels, sampleRate);
    }

    const encoder = getWavEncoder();
    const samples: Float32Array[] = [];
    for (let ch = 0; ch < numberOfChannels; ch++) {
      samples.push(buffer.getChannelData(ch));
    }

    const wavData = encoder.encodeFullWav(
      samples,
      sampleRate,
      bitDepth as 16 | 24,
    );

    return new Blob([wavData.buffer as ArrayBuffer], { type: "audio/wav" });
  }

  private encodeWav32Float(
    buffer: AudioBuffer,
    numberOfChannels: number,
    sampleRate: number,
  ): Blob {
    const bitDepth = 32;
    const bytesPerSample = 4;
    const blockAlign = numberOfChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataLength = buffer.length * blockAlign;
    const headerLength = 44;
    const totalLength = headerLength + dataLength;

    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);

    this.writeString(view, 0, "RIFF");
    view.setUint32(4, totalLength - 8, true);
    this.writeString(view, 8, "WAVE");
    this.writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 3, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    this.writeString(view, 36, "data");
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        view.setFloat32(offset, buffer.getChannelData(channel)[i], true);
        offset += bytesPerSample;
      }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  private writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  private getAudioMimeType(format: AudioExportSettings["format"]): string {
    switch (format) {
      case "mp3":
        return "audio/mpeg";
      case "wav":
        return "audio/wav";
      case "aac":
        return "audio/aac";
      case "flac":
        return "audio/flac";
      case "ogg":
        return "audio/ogg";
      default:
        return "audio/mpeg";
    }
  }

  private getImageMimeType(format: ImageExportSettings["format"]): string {
    switch (format) {
      case "png":
        return "image/png";
      case "webp":
        return "image/webp";
      case "jpg":
      default:
        return "image/jpeg";
    }
  }

  private createProgress(
    phase: ExportProgress["phase"],
    progress: number,
    totalFrames: number,
    currentFrame: number,
    bytesWritten: number,
  ): ExportProgress {
    const elapsed = this.currentExport
      ? (Date.now() - this.currentExport.startTime) / 1000
      : 0;
    const framesPerSecond = elapsed > 0 ? currentFrame / elapsed : 0;
    const remainingFrames = totalFrames - currentFrame;
    const estimatedTimeRemaining =
      framesPerSecond > 0 ? remainingFrames / framesPerSecond : 0;

    return {
      phase,
      progress,
      estimatedTimeRemaining,
      currentFrame,
      totalFrames,
      bytesWritten,
      currentBitrate: elapsed > 0 ? (bytesWritten * 8) / elapsed : 0,
    };
  }

  private createError(
    code: ExportError["code"],
    message: string,
    phase: ExportProgress["phase"],
  ): ExportError {
    return {
      code,
      message,
      phase,
      recoverable: code === "CANCELLED",
    };
  }

  private calculateStats(totalFrames: number, fileSize: number): ExportStats {
    const duration = this.currentExport
      ? Date.now() - this.currentExport.startTime
      : 0;
    const framesRendered = this.currentExport?.framesRendered || totalFrames;

    return {
      duration,
      framesRendered,
      averageSpeed: duration > 0 ? (framesRendered / duration) * 1000 : 0,
      fileSize,
      averageBitrate: duration > 0 ? (fileSize * 8000) / duration : 0,
    };
  }

  private calculateTimelineDuration(timeline: Project["timeline"]): number {
    let maxEndTime = 0;
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        const endTime = clip.startTime + clip.duration;
        if (endTime > maxEndTime) {
          maxEndTime = endTime;
        }
      }
    }
    const textClips = titleEngine.getAllTextClips();
    for (const textClip of textClips) {
      const endTime = textClip.startTime + textClip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
    const shapeClips = graphicsEngine.getAllShapeClips();
    for (const shapeClip of shapeClips) {
      const endTime = shapeClip.startTime + shapeClip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
    const svgClips = graphicsEngine.getAllSVGClips();
    for (const svgClip of svgClips) {
      const endTime = svgClip.startTime + svgClip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
    const stickerClips = graphicsEngine.getAllStickerClips();
    for (const stickerClip of stickerClips) {
      const endTime = stickerClip.startTime + stickerClip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
    if (timeline.subtitles) {
      for (const subtitle of timeline.subtitles) {
        if (subtitle.endTime > maxEndTime) {
          maxEndTime = subtitle.endTime;
        }
      }
    }

    return maxEndTime;
  }

  private shouldApplyUpscaling(
    project: Project,
    settings: VideoExportSettings,
  ): boolean {
    if (!settings.upscaling?.enabled) {
      return false;
    }

    const sourceWidth = project.settings.width;
    const sourceHeight = project.settings.height;
    const targetWidth = settings.width;
    const targetHeight = settings.height;

    return targetWidth > sourceWidth || targetHeight > sourceHeight;
  }

  dispose(): void {
    this.cancel();
    this.terminateWorker();
    this.mediabunny = null;
    this.videoEngine = null;
    this.audioEngine = null;
    if (this.upscalingEngine) {
      this.upscalingEngine.clearTexturePool();
      this.upscalingEngine = null;
    }
    this.initialized = false;
  }
}
let exportEngineInstance: ExportEngine | null = null;

export function getExportEngine(): ExportEngine {
  if (!exportEngineInstance) {
    exportEngineInstance = new ExportEngine();
  }
  return exportEngineInstance;
}

export async function initializeExportEngine(): Promise<ExportEngine> {
  const engine = getExportEngine();
  await engine.initialize();
  return engine;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
