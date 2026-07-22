import type { EvidenceKind, TimedEvidence, TranscriptCue } from '../types';

export interface TranscriptPhraseGroup {
  id: string;
  kind: EvidenceKind;
  confidence: number;
  reasonLabel: string;
  phrases: readonly string[];
  enabled?: boolean;
}

export interface TranscriptAnalysisOptions {
  phraseGroups?: readonly TranscriptPhraseGroup[];
  contextCueCount?: number;
}

export type TranscriptPhraseGroupParseResult =
  | { ok: true; groups: TranscriptPhraseGroup[] }
  | { ok: false; error: string };

export const DEFAULT_TRANSCRIPT_PHRASE_GROUPS: readonly TranscriptPhraseGroup[] = [
  {
    id: 'sponsor-start',
    kind: 'ad-read-start',
    confidence: 0.85,
    reasonLabel: 'Transcript sponsor start cue',
    phrases: [
      "today's sponsor",
      'todays sponsor',
      'sponsored by',
      'sponsor of this video',
      "sponsor of today's video",
      'sponsor of todays video',
      'thanks to our sponsor',
      'thanks to sponsor',
      'our sponsor',
      'made possible by',
      'this video is made possible by',
      'this episode is made possible by',
      'brought to you by',
      'presented by',
      'partnered with',
      'in partnership with',
      'a quick word from',
      'quick word from',
      'support for this channel comes from'
    ]
  },
  {
    id: 'ad-read-presence',
    kind: 'ad-read-presence',
    confidence: 0.5,
    reasonLabel: 'Transcript ad-read call-to-action cue',
    phrases: [
      'use code',
      'promo code',
      'discount code',
      'coupon code',
      'offer code',
      'link in the description',
      'click the link',
      'check out',
      'limited time',
      'free trial',
      'sign up',
      'head to',
      'go to',
      'visit',
      'sponsor',
      'sponsorship'
    ]
  },
  {
    id: 'return-to-content',
    kind: 'ad-read-end',
    confidence: 0.7,
    reasonLabel: 'Transcript return-to-content cue',
    phrases: [
      'now back to',
      'back to the video',
      'with that out of the way',
      'anyway',
      "let's get back",
      'lets get back',
      'back into',
      'now lets get back',
      "now let's get back"
    ]
  }
];

export function formatTranscriptPhraseGroupsForEditing(
  groups: readonly TranscriptPhraseGroup[] = DEFAULT_TRANSCRIPT_PHRASE_GROUPS
): string {
  return JSON.stringify(groups, null, 2);
}

export function parseTranscriptPhraseGroups(value: unknown): readonly TranscriptPhraseGroup[] {
  if (typeof value === 'string') {
    const parsed = parseTranscriptPhraseGroupsJson(value);
    return parsed.ok ? parsed.groups : DEFAULT_TRANSCRIPT_PHRASE_GROUPS;
  }

  const parsed = parseTranscriptPhraseGroupList(value);
  return parsed.ok ? parsed.groups : DEFAULT_TRANSCRIPT_PHRASE_GROUPS;
}

export function parseTranscriptPhraseGroupsJson(json: string): TranscriptPhraseGroupParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Transcript phrase groups must be valid JSON.' };
  }

  return parseTranscriptPhraseGroupList(parsed);
}

export function analyzeTranscriptCues(
  cues: TranscriptCue[],
  options: TranscriptAnalysisOptions = {}
): TimedEvidence[] {
  const evidence: TimedEvidence[] = [];
  const phraseGroups = options.phraseGroups ?? DEFAULT_TRANSCRIPT_PHRASE_GROUPS;
  const contextCueCount = Math.max(1, Math.floor(options.contextCueCount ?? 2));

  for (const [index, cue] of cues.entries()) {
    const currentCueText = normalizeText(cue.text);
    const normalized = normalizeText(getCueWindowText(cues, index, contextCueCount));
    const match = findPhraseGroupMatch(normalized, phraseGroups, currentCueText.length);
    if (match) {
      evidence.push({
        source: 'transcript',
        kind: match.group.kind,
        startSeconds: cue.startSeconds,
        endSeconds: cue.startSeconds + cue.durationSeconds,
        confidence: match.group.confidence,
        reason: `${match.group.reasonLabel}: "${match.phrase}".`,
        raw: {
          ...cue,
          phraseGroupId: match.group.id,
          phrase: match.phrase,
          contextText: normalized
        }
      });
    }
  }

  return evidence;
}

function parseTranscriptPhraseGroupList(value: unknown): TranscriptPhraseGroupParseResult {
  if (!Array.isArray(value)) return { ok: false, error: 'Transcript phrase groups must be a JSON array.' };

  const groups: TranscriptPhraseGroup[] = [];
  for (const [index, group] of value.entries()) {
    const parsed = parseTranscriptPhraseGroup(group, index);
    if (!parsed.ok) return parsed;
    groups.push(parsed.group);
  }

  return { ok: true, groups };
}

function parseTranscriptPhraseGroup(
  value: unknown,
  index: number
): { ok: true; group: TranscriptPhraseGroup } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: `Phrase group ${index + 1} must be an object.` };

  const id = stringValue(value.id).trim();
  if (!id) return { ok: false, error: `Phrase group ${index + 1} needs a non-empty id.` };

  if (!isEvidenceKind(value.kind)) return { ok: false, error: `Phrase group "${id}" has an invalid kind.` };

  const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? value.confidence : NaN;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, error: `Phrase group "${id}" confidence must be a number from 0 to 1.` };
  }

  const reasonLabel = stringValue(value.reasonLabel).trim();
  if (!reasonLabel) return { ok: false, error: `Phrase group "${id}" needs a reasonLabel.` };

  if (!Array.isArray(value.phrases)) return { ok: false, error: `Phrase group "${id}" phrases must be an array.` };
  const phrases = [...new Set(value.phrases.map((phrase) => stringValue(phrase).trim()).filter(Boolean))];
  if (phrases.length === 0) return { ok: false, error: `Phrase group "${id}" needs at least one phrase.` };

  return {
    ok: true,
    group: {
      id,
      kind: value.kind,
      confidence,
      reasonLabel,
      phrases,
      ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {})
    }
  };
}

function getCueWindowText(cues: readonly TranscriptCue[], startIndex: number, count: number): string {
  return cues
    .slice(startIndex, startIndex + count)
    .map((cue) => cue.text)
    .join(' ');
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findPhraseGroupMatch(
  normalizedText: string,
  phraseGroups: readonly TranscriptPhraseGroup[],
  currentCueLength: number
): { group: TranscriptPhraseGroup; phrase: string } | null {
  for (const group of phraseGroups) {
    if (group.enabled === false) continue;
    const phrase = findPattern(normalizedText, group.phrases, currentCueLength);
    if (phrase) return { group, phrase };
  }

  return null;
}

function findPattern(normalizedText: string, patterns: readonly string[], currentCueLength: number): string | null {
  return patterns.find((pattern) => {
    const startIndex = findPatternStartIndex(normalizedText, pattern);
    return startIndex >= 0 && startIndex < currentCueLength;
  }) ?? null;
}

function findPatternStartIndex(normalizedText: string, pattern: string): number {
  const normalizedPattern = normalizeText(pattern);
  if (!normalizedPattern) return -1;
  if (normalizedPattern.includes(' ')) return normalizedText.indexOf(normalizedPattern);
  return new RegExp(`\\b${escapeRegExp(normalizedPattern)}\\b`).exec(normalizedText)?.index ?? -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEvidenceKind(value: unknown): value is EvidenceKind {
  return value === 'ad-read-start' || value === 'ad-read-end' || value === 'ad-read-presence';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
