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
}

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

export function analyzeTranscriptCues(
  cues: TranscriptCue[],
  options: TranscriptAnalysisOptions = {}
): TimedEvidence[] {
  const evidence: TimedEvidence[] = [];
  const phraseGroups = options.phraseGroups ?? DEFAULT_TRANSCRIPT_PHRASE_GROUPS;

  for (const cue of cues) {
    const normalized = normalizeText(cue.text);
    const match = findPhraseGroupMatch(normalized, phraseGroups);
    if (match) {
      evidence.push({
        source: 'transcript',
        kind: match.group.kind,
        startSeconds: cue.startSeconds,
        endSeconds: cue.startSeconds + cue.durationSeconds,
        confidence: match.group.confidence,
        reason: `${match.group.reasonLabel}: "${match.phrase}".`,
        raw: cue
      });
    }
  }

  return evidence;
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
  phraseGroups: readonly TranscriptPhraseGroup[]
): { group: TranscriptPhraseGroup; phrase: string } | null {
  for (const group of phraseGroups) {
    if (group.enabled === false) continue;
    const phrase = findPattern(normalizedText, group.phrases);
    if (phrase) return { group, phrase };
  }

  return null;
}

function findPattern(normalizedText: string, patterns: readonly string[]): string | null {
  return patterns.find((pattern) => matchesPattern(normalizedText, pattern)) ?? null;
}

function matchesPattern(normalizedText: string, pattern: string): boolean {
  const normalizedPattern = normalizeText(pattern);
  if (!normalizedPattern) return false;
  if (normalizedPattern.includes(' ')) return normalizedText.includes(normalizedPattern);
  return new RegExp(`\\b${escapeRegExp(normalizedPattern)}\\b`).test(normalizedText);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
