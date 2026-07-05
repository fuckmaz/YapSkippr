export interface SampledFrame {
  currentTimeSeconds: number;
  imageData: ImageData;
  width: number;
  height: number;
}

export interface FrameSamplerOptions {
  width: number;
  sampleIntervalMs: number;
  onFrame(frame: SampledFrame): void | Promise<void>;
  onError?(error: Error): void;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface ScreenshotCrop {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
}

interface CaptureVisibleTabResponse {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

const CAPTURE_MESSAGE_TYPE = 'YAPSKIPPR_CAPTURE_VISIBLE_TAB';

export function startScreenshotFrameSampler(video: HTMLVideoElement, options: FrameSamplerOptions): () => void {
  let stopped = false;
  let timeout: number | undefined;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      if (document.visibilityState !== 'visible') {
        return;
      }
      if (!video.isConnected) {
        throw new Error('Video element is no longer connected.');
      }
      const dataUrl = await captureVisibleTab();
      const frame = await sampleFrameFromScreenshot(video, dataUrl, options.width);
      await options.onFrame(frame);
    } catch (error) {
      const frameError = error instanceof Error ? error : new Error(String(error));
      if (isExtensionContextInvalidatedError(frameError)) {
        stopped = true;
      }
      options.onError?.(frameError);
    } finally {
      if (!stopped) {
        timeout = window.setTimeout(() => void tick(), options.sampleIntervalMs);
      }
    }
  }

  void tick();

  return () => {
    stopped = true;
    if (timeout !== undefined) window.clearTimeout(timeout);
  };
}

export function isExtensionContextInvalidatedError(error: Error): boolean {
  return error.message.toLowerCase().includes('extension context invalidated');
}

export function calculateScreenshotCrop(
  videoRect: RectLike,
  viewport: Dimensions,
  screenshot: Dimensions
): ScreenshotCrop {
  const scaleX = screenshot.width / viewport.width;
  const scaleY = screenshot.height / viewport.height;
  const left = clamp(videoRect.left * scaleX, 0, screenshot.width);
  const top = clamp(videoRect.top * scaleY, 0, screenshot.height);
  const right = clamp((videoRect.left + videoRect.width) * scaleX, 0, screenshot.width);
  const bottom = clamp((videoRect.top + videoRect.height) * scaleY, 0, screenshot.height);

  return {
    sourceX: Math.round(left),
    sourceY: Math.round(top),
    sourceWidth: Math.max(1, Math.round(right - left)),
    sourceHeight: Math.max(1, Math.round(bottom - top))
  };
}

async function sampleFrameFromScreenshot(
  video: HTMLVideoElement,
  dataUrl: string,
  targetWidth: number
): Promise<SampledFrame> {
  const image = await loadImage(dataUrl);
  const crop = calculateScreenshotCrop(
    video.getBoundingClientRect(),
    { width: window.innerWidth, height: window.innerHeight },
    { width: image.naturalWidth, height: image.naturalHeight }
  );
  const targetHeight = Math.max(1, Math.round(targetWidth * (crop.sourceHeight / crop.sourceWidth)));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not create 2D canvas context.');

  context.drawImage(
    image,
    crop.sourceX,
    crop.sourceY,
    crop.sourceWidth,
    crop.sourceHeight,
    0,
    0,
    targetWidth,
    targetHeight
  );

  return {
    currentTimeSeconds: video.currentTime,
    imageData: context.getImageData(0, 0, targetWidth, targetHeight),
    width: targetWidth,
    height: targetHeight
  };
}

async function captureVisibleTab(): Promise<string> {
  const response = await chrome.runtime.sendMessage<{ type: typeof CAPTURE_MESSAGE_TYPE }, CaptureVisibleTabResponse>({
    type: CAPTURE_MESSAGE_TYPE
  });

  if (!response?.ok || !response.dataUrl) {
    throw new Error(response?.error ?? 'Visible tab capture failed.');
  }

  return response.dataUrl;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load captured tab image.'));
    image.src = src;
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
