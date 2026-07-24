export type PromotionalSignal = 'sponsor-cta' | 'low-signal';

export interface PromotionalSignalClassification {
  signal: PromotionalSignal;
  matchedSemantic: string | null;
  reason: string;
}

interface PromotionalTextPattern {
  semantic: string;
  pattern: RegExp;
}

const PROMOTIONAL_URL_TOKEN_PATTERN =
  /(?:^|[._~!$&'()*+,;=:@/?#-])(?:affiliate|bonus|checkout|claim|coupon|deal|discount|gift|offer|partner|promo|redeem|shop|sponsor|subscribe|trial)(?:$|[._~!$&'()*+,;=:@/?#-])/i;
const DOMAIN_LIKE_PATTERN =
  /^(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:[/?#:]|$)/i;

const PROMOTIONAL_TEXT_PATTERNS: readonly PromotionalTextPattern[] = [
  {
    semantic: 'promo code',
    pattern: /\b(?:use|enter)\s+(?:(?:promo|discount|coupon|offer)\s+)?code\b/i
  },
  {
    semantic: 'discount code',
    pattern: /\b(?:promo|discount|coupon|offer)\s+code\b/i
  },
  {
    semantic: 'percentage discount',
    pattern: /\b\d{1,2}\s*%\s+off\b/i
  },
  {
    semantic: 'free trial',
    pattern: /\b(?:free|extended)\s+trial\b/i
  },
  {
    semantic: 'limited-time offer',
    pattern: /\blimited[- ]time\s+(?:deal|discount|offer)\b/i
  },
  {
    semantic: 'exclusive offer',
    pattern: /\b(?:exclusive|special)\s+(?:deal|discount|offer)\b/i
  },
  {
    semantic: 'sponsor disclosure',
    pattern: /\b(?:sponsored|presented)\s+by\b/i
  },
  {
    semantic: 'sponsor attribution',
    pattern: /\b(?:thanks?\s+to(?:\s+our)?\s+sponsor|brought\s+to\s+you\s+by)\b/i
  },
  {
    semantic: 'description link call to action',
    pattern: /\blink\s+in\s+(?:the\s+)?description\b/i
  },
  {
    semantic: 'shop now call to action',
    pattern: /\bshop\s+now\b/i
  },
  {
    semantic: 'explicit savings',
    pattern: /\bsave\s+(?:[$€£]\s*\d+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s*(?:%|dollars?|euros?|pounds?))\b/i
  }
];

export function classifyPromotionalLinkContext(
  text: string,
  links: readonly string[]
): PromotionalSignalClassification {
  for (const link of links) {
    const matchedSemantic = findPromotionalUrlSemantic(link);
    if (matchedSemantic) {
      return {
        signal: 'sponsor-cta',
        matchedSemantic,
        reason: `URL contains promotional semantic "${matchedSemantic}"`
      };
    }
  }

  const matchedSemantic = findPromotionalTextSemantic(text);
  if (matchedSemantic) {
    return {
      signal: 'sponsor-cta',
      matchedSemantic,
      reason: `surrounding text contains promotional semantic "${matchedSemantic}"`
    };
  }

  return {
    signal: 'low-signal',
    matchedSemantic: null,
    reason: 'URL and surrounding text contain no promotional semantics'
  };
}

export function findPromotionalUrlSemantic(value: string): string | null {
  const parsed = parseHttpUrlLike(value);
  if (!parsed) return null;

  const searchable = `${parsed.hostname}${parsed.pathname}${parsed.search}${parsed.hash}`;
  return searchable
    .match(PROMOTIONAL_URL_TOKEN_PATTERN)?.[0]
    ?.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '')
    .toLowerCase() ?? null;
}

export function findPromotionalTextSemantic(text: string): string | null {
  const normalized = normalizeText(text);

  for (const candidate of PROMOTIONAL_TEXT_PATTERNS) {
    const match = candidate.pattern.exec(normalized);
    if (!match || isNegatedMatch(normalized, match.index)) continue;
    return candidate.semantic;
  }

  return null;
}

export function parseHttpUrlLike(value: string): URL | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const hasHttpScheme = /^https?:\/\//i.test(normalized);
  if (!hasHttpScheme && !DOMAIN_LIKE_PATTERN.test(normalized)) return null;

  for (const candidate of hasHttpScheme ? [normalized] : [`https://${normalized}`]) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed;
    } catch {
      // Try the next normalization.
    }
  }

  return null;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNegatedMatch(normalizedText: string, startIndex: number): boolean {
  const prefix = normalizedText.slice(Math.max(0, startIndex - 64), startIndex);
  if (/\bnot\s+only\s*$/.test(prefix)) return false;
  return /\b(?:not|never|without|isnt|wasnt|werent|arent|wont|didnt|doesnt|dont|no)\b(?:\s+\w+){0,3}\s*$/.test(prefix);
}
