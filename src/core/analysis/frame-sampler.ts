import { sendRuntimeMessageWithCallback } from '../runtime-message';

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
const MIN_SAMPLE_INTERVAL_MS = 250;
const MAX_GENERIC_FAILURE_BACKOFF_MS = 60_000;
const MIN_VISIBLE_VIDEO_FRACTION = 0.05;
const MIN_SOURCE_CROP_DIMENSION = 2;
const MAX_FRAME_ASPECT_RATIO = 4;
const MAX_OUTPUT_WIDTH = 1920;
const MAX_OUTPUT_HEIGHT = 2160;
const MAX_OUTPUT_PIXELS = 2_073_600;

export class VideoElementDisconnectedError extends Error {
  readonly code = 'VIDEO_ELEMENT_DISCONNECTED';

  constructor() {
    super('Video element is no longer connected.');
    this.name = 'VideoElementDisconnectedError';
  }
}

export function startScreenshotFrameSampler(video: HTMLVideoElement, options: FrameSamplerOptions): () => void {
  let stopped = false;
  let timeout: number | undefined;
  let consecutiveFailures = 0;
  const sampleIntervalMs = normalizeSampleInterval(options.sampleIntervalMs);

  async function tick(): Promise<void> {
    if (stopped) return;
    let retryDelayMs = sampleIntervalMs;
    try {
      assertVideoElementConnected(video);
      if (document.visibilityState !== 'visible') {
        return;
      }
      const dataUrl = await captureVisibleTab();
      if (stopped) return;
      assertVideoElementConnected(video);
      const frame = await sampleFrameFromScreenshot(video, dataUrl, options.width);
      if (stopped) return;
      assertVideoElementConnected(video);
      await options.onFrame(frame);
      consecutiveFailures = 0;
    } catch (error) {
      if (stopped) return;
      const frameError = error instanceof Error ? error : new Error(String(error));
      if (
        isExtensionContextInvalidatedError(frameError)
        || isCapturePermissionMissingError(frameError)
        || isVideoElementDisconnectedError(frameError)
      ) {
        stopped = true;
      } else {
        consecutiveFailures = Math.min(consecutiveFailures + 1, 17);
        retryDelayMs = calculateFailureRetryDelay(sampleIntervalMs, consecutiveFailures);
      }
      options.onError?.(frameError);
    } finally {
      if (!stopped) {
        timeout = window.setTimeout(() => void tick(), retryDelayMs);
      }
    }
  }

  void tick();

  return () => {
    stopped = true;
    if (timeout !== undefined) window.clearTimeout(timeout);
  };
}

export function isVideoElementDisconnectedError(error: Error): error is VideoElementDisconnectedError {
  return error instanceof VideoElementDisconnectedError
    || (error.name === 'VideoElementDisconnectedError'
      && (error as Partial<VideoElementDisconnectedError>).code === 'VIDEO_ELEMENT_DISCONNECTED');
}

export function isExtensionContextInvalidatedError(error: Error): boolean {
  return error.message.toLowerCase().includes('extension context invalidated');
}

export function isCapturePermissionMissingError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return message.includes('<all_urls>') && message.includes('activetab') && message.includes('permission');
}

export function calculateScreenshotCrop(
  videoRect: RectLike,
  viewport: Dimensions,
  screenshot: Dimensions
): ScreenshotCrop {
  assertPositiveDimensions(viewport, 'viewport');
  assertPositiveDimensions(screenshot, 'screenshot');
  assertUsableVideoRect(videoRect);

  const visibleLeft = clamp(videoRect.left, 0, viewport.width);
  const visibleTop = clamp(videoRect.top, 0, viewport.height);
  const visibleRight = clamp(videoRect.left + videoRect.width, 0, viewport.width);
  const visibleBottom = clamp(videoRect.top + videoRect.height, 0, viewport.height);
  const visibleWidth = visibleRight - visibleLeft;
  const visibleHeight = visibleBottom - visibleTop;

  if (
    visibleWidth <= 0
    || visibleHeight <= 0
    || visibleWidth / videoRect.width < MIN_VISIBLE_VIDEO_FRACTION
    || visibleHeight / videoRect.height < MIN_VISIBLE_VIDEO_FRACTION
  ) {
    throw new Error('Video rectangle is outside the usable viewport area.');
  }

  const scaleX = screenshot.width / viewport.width;
  const scaleY = screenshot.height / viewport.height;
  const sourceX = Math.round(visibleLeft * scaleX);
  const sourceY = Math.round(visibleTop * scaleY);
  const sourceRight = Math.round(visibleRight * scaleX);
  const sourceBottom = Math.round(visibleBottom * scaleY);
  const sourceWidth = sourceRight - sourceX;
  const sourceHeight = sourceBottom - sourceY;

  if (sourceWidth < MIN_SOURCE_CROP_DIMENSION || sourceHeight < MIN_SOURCE_CROP_DIMENSION) {
    throw new Error('Visible video rectangle is too small to sample safely.');
  }

  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight
  };
}

export function calculateSampledFrameDimensions(crop: ScreenshotCrop, requestedWidth: number): Dimensions {
  if (!Number.isFinite(requestedWidth) || requestedWidth <= 0) {
    throw new Error('Frame sample width must be a finite positive number.');
  }

  const width = Math.round(requestedWidth);
  if (width < 1 || width > MAX_OUTPUT_WIDTH) {
    throw new Error(`Frame sample width exceeds the ${MAX_OUTPUT_WIDTH}px safety limit.`);
  }
  if (
    !Number.isFinite(crop.sourceWidth)
    || !Number.isFinite(crop.sourceHeight)
    || crop.sourceWidth < MIN_SOURCE_CROP_DIMENSION
    || crop.sourceHeight < MIN_SOURCE_CROP_DIMENSION
  ) {
    throw new Error('Screenshot crop dimensions are not usable.');
  }

  const heightToWidth = crop.sourceHeight / crop.sourceWidth;
  const aspectRatio = Math.max(heightToWidth, 1 / heightToWidth);
  if (!Number.isFinite(aspectRatio) || aspectRatio > MAX_FRAME_ASPECT_RATIO) {
    throw new Error(`Screenshot crop exceeds the ${MAX_FRAME_ASPECT_RATIO}:1 aspect-ratio safety limit.`);
  }

  const height = Math.max(1, Math.round(width * heightToWidth));
  if (height > MAX_OUTPUT_HEIGHT || width * height > MAX_OUTPUT_PIXELS) {
    throw new Error('Frame sample exceeds safe canvas dimensions.');
  }

  return { width, height };
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
  const dimensions = calculateSampledFrameDimensions(crop, targetWidth);
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not create 2D canvas context.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  context.drawImage(
    image,
    crop.sourceX,
    crop.sourceY,
    crop.sourceWidth,
    crop.sourceHeight,
    0,
    0,
    dimensions.width,
    dimensions.height
  );

  return {
    currentTimeSeconds: video.currentTime,
    imageData: context.getImageData(0, 0, dimensions.width, dimensions.height),
    width: dimensions.width,
    height: dimensions.height
  };
}

async function captureVisibleTab(): Promise<string> {
  const response = await sendRuntimeMessageWithCallback<CaptureVisibleTabResponse>({
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

function normalizeSampleInterval(value: number): number {
  if (!Number.isFinite(value)) return MIN_SAMPLE_INTERVAL_MS;
  return Math.max(MIN_SAMPLE_INTERVAL_MS, Math.round(value));
}

function calculateFailureRetryDelay(sampleIntervalMs: number, consecutiveFailures: number): number {
  const exponent = Math.min(Math.max(0, consecutiveFailures - 1), 16);
  return Math.min(
    Math.max(sampleIntervalMs, MAX_GENERIC_FAILURE_BACKOFF_MS),
    sampleIntervalMs * (2 ** exponent)
  );
}

function assertPositiveDimensions(dimensions: Dimensions, label: string): void {
  if (
    !Number.isFinite(dimensions.width)
    || !Number.isFinite(dimensions.height)
    || dimensions.width <= 0
    || dimensions.height <= 0
  ) {
    throw new Error(`Screenshot ${label} dimensions must be finite and positive.`);
  }
}

function assertUsableVideoRect(videoRect: RectLike): void {
  if (
    !Number.isFinite(videoRect.left)
    || !Number.isFinite(videoRect.top)
    || !Number.isFinite(videoRect.width)
    || !Number.isFinite(videoRect.height)
    || videoRect.width <= 0
    || videoRect.height <= 0
    || !Number.isFinite(videoRect.left + videoRect.width)
    || !Number.isFinite(videoRect.top + videoRect.height)
  ) {
    throw new Error('Video rectangle must contain finite positive dimensions.');
  }
}

function assertVideoElementConnected(video: HTMLVideoElement): void {
  if (!video.isConnected) throw new VideoElementDisconnectedError();
}
