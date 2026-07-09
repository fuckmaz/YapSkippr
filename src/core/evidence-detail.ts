export function summarizeRawEvidence(raw: unknown): string | null {
  if (!isRecord(raw)) return null;

  if (Array.isArray(raw.links)) {
    const links = raw.links.filter((link): link is string => typeof link === 'string' && link.length > 0);
    if (links.length > 0) return links.join(', ');
  }

  if (typeof raw.value === 'string' && raw.value.trim()) {
    return appendQrLocation(raw.value.trim(), raw.location);
  }

  if (typeof raw.text === 'string' && raw.text.trim()) return raw.text.trim();
  if (typeof raw.contextText === 'string' && raw.contextText.trim()) return raw.contextText.trim();
  return null;
}

function appendQrLocation(value: string, location: unknown): string {
  const box = formatQrBox(location);
  return box ? `${value} (${box})` : value;
}

function formatQrBox(location: unknown): string | null {
  if (!isRecord(location)) return null;
  const topLeft = getPoint(location.topLeftCorner);
  const bottomRight = getPoint(location.bottomRightCorner);
  if (!topLeft || !bottomRight) return null;

  const x = Math.round(topLeft.x);
  const y = Math.round(topLeft.y);
  const width = Math.max(0, Math.round(bottomRight.x - topLeft.x));
  const height = Math.max(0, Math.round(bottomRight.y - topLeft.y));
  return `QR box ${x},${y} ${width}x${height}`;
}

function getPoint(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) return null;
  if (typeof value.x !== 'number' || typeof value.y !== 'number') return null;
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return { x: value.x, y: value.y };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
