export interface YouTubeCaptionTrack {
  baseUrl: string;
  languageCode: string;
  name: string;
  kind?: string;
}

export function extractCaptionTracksFromHtml(html: string): YouTubeCaptionTrack[] {
  const json = extractAssignedObjectJson(html, 'ytInitialPlayerResponse');
  if (!json) return [];

  try {
    return extractCaptionTracks(JSON.parse(json));
  } catch {
    return [];
  }
}

export function extractCaptionTracks(playerResponse: unknown): YouTubeCaptionTrack[] {
  if (!isRecord(playerResponse)) return [];
  const captions = playerResponse.captions;
  if (!isRecord(captions)) return [];
  const tracklist = captions.playerCaptionsTracklistRenderer;
  if (!isRecord(tracklist) || !Array.isArray(tracklist.captionTracks)) return [];

  return tracklist.captionTracks.flatMap((track) => {
    if (!isRecord(track) || typeof track.baseUrl !== 'string' || typeof track.languageCode !== 'string') {
      return [];
    }

    return [
      {
        baseUrl: track.baseUrl,
        languageCode: track.languageCode,
        name: extractName(track.name),
        kind: typeof track.kind === 'string' ? track.kind : undefined
      }
    ];
  });
}

function extractAssignedObjectJson(source: string, variableName: string): string | null {
  const variableIndex = source.indexOf(variableName);
  if (variableIndex < 0) return null;

  const start = source.indexOf('{', variableIndex);
  if (start < 0) return null;

  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  return null;
}

function extractName(value: unknown): string {
  if (!isRecord(value)) return '';
  if (typeof value.simpleText === 'string') return value.simpleText;
  if (Array.isArray(value.runs)) {
    return value.runs
      .map((run) => (isRecord(run) && typeof run.text === 'string' ? run.text : ''))
      .join('')
      .trim();
  }
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
