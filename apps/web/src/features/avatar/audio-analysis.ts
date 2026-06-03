export type AudioSegmentState = "idle" | "speaking";

export interface AudioSegment {
  startTime: number;
  duration: number;
  state: AudioSegmentState;
}

export interface AnalyzeAudioOptions {
  threshold?: number;
  windowSec?: number;
  silenceDelaySec?: number;
  fallbackDuration?: number;
  startTime?: number;
  duration?: number;
}

const DEFAULT_THRESHOLD = 0.03;
const DEFAULT_WINDOW_SEC = 0.08;
const DEFAULT_SILENCE_DELAY_SEC = 0.3;

export async function analyzeAudioBlob(
  blob: Blob | null | undefined,
  options: AnalyzeAudioOptions = {},
): Promise<AudioSegment[]> {
  const fallbackDuration = options.fallbackDuration ?? 1;
  if (!blob) {
    return [{ startTime: 0, duration: fallbackDuration, state: "speaking" }];
  }

  try {
    const audioContext = new AudioContext();
    const buffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
    await audioContext.close();

    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const windowSize = Math.max(1, Math.floor((options.windowSec ?? DEFAULT_WINDOW_SEC) * sampleRate));
    const analysisStartTime = clampTime(options.startTime ?? 0, 0, buffer.duration);
    const analysisDuration = clampDuration(
      options.duration ?? buffer.duration - analysisStartTime,
      fallbackDuration,
    );
    const analysisEndTime = Math.min(buffer.duration, analysisStartTime + analysisDuration);
    const startOffset = Math.floor(analysisStartTime * sampleRate);
    const endOffset = Math.min(channelData.length, Math.ceil(analysisEndTime * sampleRate));
    const relativeDuration = Math.max(0, (endOffset - startOffset) / sampleRate);
    if (relativeDuration <= 0.01) {
      return [{ startTime: 0, duration: fallbackDuration, state: "speaking" }];
    }
    const threshold = options.threshold ?? DEFAULT_THRESHOLD;
    const silenceDelaySec = options.silenceDelaySec ?? DEFAULT_SILENCE_DELAY_SEC;
    const rawSegments: AudioSegment[] = [];

    let currentState: AudioSegmentState = "idle";
    let currentStart = 0;
    let pendingIdleAt: number | null = null;

    const pushSegment = (endTime: number) => {
      const duration = Math.max(0, endTime - currentStart);
      if (duration > 0.01) {
        rawSegments.push({
          startTime: currentStart,
          duration,
          state: currentState,
        });
      }
    };

    for (let offset = startOffset; offset < endOffset; offset += windowSize) {
      let sum = 0;
      const end = Math.min(endOffset, offset + windowSize);
      for (let i = offset; i < end; i += 1) {
        sum += channelData[i] * channelData[i];
      }
      const rms = Math.sqrt(sum / Math.max(1, end - offset));
      const time = (offset - startOffset) / sampleRate;

      if (rms >= threshold) {
        pendingIdleAt = null;
        if (currentState !== "speaking") {
          pushSegment(time);
          currentState = "speaking";
          currentStart = time;
        }
      } else if (currentState === "speaking") {
        pendingIdleAt ??= time;
        if (time - pendingIdleAt >= silenceDelaySec) {
          pushSegment(pendingIdleAt);
          currentState = "idle";
          currentStart = pendingIdleAt;
          pendingIdleAt = null;
        }
      }
    }

    pushSegment(relativeDuration);
    return mergeShortSegments(rawSegments.length > 0 ? rawSegments : [
      { startTime: 0, duration: relativeDuration || fallbackDuration, state: "idle" },
    ]);
  } catch (error) {
    console.warn("[avatar] Failed to analyze audio, using speaking fallback", error);
    return [{ startTime: 0, duration: fallbackDuration, state: "speaking" }];
  }
}

function clampTime(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampDuration(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function mergeShortSegments(segments: AudioSegment[]): AudioSegment[] {
  const merged: AudioSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && previous.state === segment.state) {
      previous.duration = segment.startTime + segment.duration - previous.startTime;
    } else if (segment.duration < 0.05 && previous) {
      previous.duration = segment.startTime + segment.duration - previous.startTime;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}
