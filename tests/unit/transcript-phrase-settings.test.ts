import { describe, expect, test } from 'vitest';
import {
  DEFAULT_TRANSCRIPT_PHRASE_GROUPS,
  formatTranscriptPhraseGroupsForEditing,
  parseTranscriptPhraseGroups,
  parseTranscriptPhraseGroupsJson
} from '../../src/core/analysis/transcript-analyzer';

describe('transcript phrase settings', () => {
  test('formats default phrase groups for developer editing', () => {
    const json = formatTranscriptPhraseGroupsForEditing();
    const parsed = JSON.parse(json) as unknown;

    expect(Array.isArray(parsed)).toBe(true);
    expect(json).toContain('"sponsor-start"');
    expect(json).toContain('"made possible by"');
  });

  test('parses edited phrase groups from JSON', () => {
    const result = parseTranscriptPhraseGroupsJson(JSON.stringify([
      {
        id: 'creator-break',
        kind: 'ad-read-start',
        confidence: 0.77,
        reasonLabel: 'Creator break cue',
        phrases: ['creator break starts'],
        enabled: false
      }
    ]));

    expect(result).toEqual({
      ok: true,
      groups: [
        {
          id: 'creator-break',
          kind: 'ad-read-start',
          confidence: 0.77,
          reasonLabel: 'Creator break cue',
          phrases: ['creator break starts'],
          enabled: false
        }
      ]
    });
  });

  test('rejects malformed phrase group JSON with an actionable error', () => {
    expect(parseTranscriptPhraseGroupsJson('{nope')).toMatchObject({
      ok: false,
      error: expect.stringContaining('valid JSON')
    });

    expect(parseTranscriptPhraseGroupsJson(JSON.stringify([{ id: 'bad', kind: 'ad-read-start', confidence: 2, reasonLabel: '', phrases: [] }]))).toMatchObject({
      ok: false,
      error: expect.stringContaining('confidence')
    });
  });

  test('normalizes unknown storage values back to defaults', () => {
    expect(parseTranscriptPhraseGroups(null)).toEqual(DEFAULT_TRANSCRIPT_PHRASE_GROUPS);
    expect(parseTranscriptPhraseGroups('not valid json')).toEqual(DEFAULT_TRANSCRIPT_PHRASE_GROUPS);
  });
});
