import type { TimedEvidence, TranscriptCue } from '../types';

const STRONG_START_PATTERNS = [
  "today's sponsor",
  'sponsored by',
  'thanks to our sponsor',
  'thanks to sponsor',
  'our sponsor',
  'partnered with'
];

const WEAK_PRESENCE_PATTERNS = [
  'use code',
  'promo code',
  'link in the description',
  'check out',
  'limited time'
];

const END_PATTERNS = [
  'now back to',
  'back to the video',
  'with that out of the way',
  'anyway',
  "let's get back",
  'back into'
];

export function analyzeTranscriptCues(cues: TranscriptCue[]): TimedEvidence[] {
  const evidence: TimedEvidence[] = [];

  for (const cue of cues) {
    const normalized = normalizeText(cue.text);
    const strongStart = findPattern(normalized, STRONG_START_PATTERNS);
    if (strongStart) {
      evidence.push({
        source: 'transcript',
        kind: 'ad-read-start',
        startSeconds: cue.startSeconds,
        endSeconds: cue.startSeconds + cue.durationSeconds,
        confidence: 0.85,
        reason: `Transcript sponsor start cue: "${strongStart}".`,
        raw: cue
      });
      continue;
    }

    const weakPresence = findPattern(normalized, WEAK_PRESENCE_PATTERNS);
    if (weakPresence) {
      evidence.push({
        source: 'transcript',
        kind: 'ad-read-presence',
        startSeconds: cue.startSeconds,
        endSeconds: cue.startSeconds + cue.durationSeconds,
        confidence: 0.5,
        reason: `Transcript ad-read call-to-action cue: "${weakPresence}".`,
        raw: cue
      });
      continue;
    }

    const end = findPattern(normalized, END_PATTERNS);
    if (end) {
      evidence.push({
        source: 'transcript',
        kind: 'ad-read-end',
        startSeconds: cue.startSeconds,
        endSeconds: cue.startSeconds + cue.durationSeconds,
        confidence: 0.7,
        reason: `Transcript return-to-content cue: "${end}".`,
        raw: cue
      });
    }
  }

  return evidence;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function findPattern(text: string, patterns: string[]): string | null {
  return patterns.find((pattern) => text.includes(pattern)) ?? null;
}
