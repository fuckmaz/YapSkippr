interface ShouldScanQrFrameOptions {
  sampleCount: number;
  currentTimeSeconds: number;
  lastQrScanTimeSeconds: number | null;
}

/**
 * Decode each distinct sampled frame. The screenshot sampler is the sole QR
 * cadence controller (5s normally, 1-5s in Fast Scan), so this function only
 * suppresses duplicate callbacks for the exact same playback position.
 */
export function shouldScanQrFrame({
  sampleCount,
  currentTimeSeconds,
  lastQrScanTimeSeconds
}: ShouldScanQrFrameOptions): boolean {
  if (!Number.isFinite(currentTimeSeconds)) return false;
  if (sampleCount <= 1) return true;
  if (lastQrScanTimeSeconds === null) return true;
  if (!Number.isFinite(lastQrScanTimeSeconds)) return true;

  if (currentTimeSeconds < lastQrScanTimeSeconds - 1) return true;
  return Math.abs(currentTimeSeconds - lastQrScanTimeSeconds) > 0.05;
}
