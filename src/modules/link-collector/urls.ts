// Pure URL handling for the link collector. No Discord or Karakeep imports.

// Stops at whitespace and at the delimiters Discord markup puts around URLs:
// `<url>` (suppressed embed), `||url||` (spoiler), quotes and markdown brackets.
const URL_PATTERN = /https?:\/\/[^\s<>|"'`[\]]+/gi;

const TRAILING_PUNCTUATION = /[.,;:!?]$/;

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

/** Strip trailing punctuation and any unbalanced closing parens. */
function trimTrailing(url: string): string {
  let result = url;
  for (;;) {
    if (TRAILING_PUNCTUATION.test(result)) {
      result = result.slice(0, -1);
    } else if (result.endsWith(')') && count(result, ')') > count(result, '(')) {
      result = result.slice(0, -1);
    } else {
      return result;
    }
  }
}

function isTrackingParam(pair: string): boolean {
  const key = pair.split('=', 1)[0] ?? '';
  return key.startsWith('utm_') || key === 'fbclid' || key === 'gclid' || key === 'si';
}

/**
 * Strip trailing punctuation, unbalanced closing parens and tracking query
 * params (`utm_*`, `fbclid`, `gclid`, `si`). The fragment is kept; beyond the
 * WHATWG URL serialisation nothing else is rewritten (the remaining query is
 * kept byte-for-byte, in order). Unparseable input is returned trimmed.
 */
export function normaliseUrl(url: string): string {
  const trimmed = trimTrailing(url);
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (parsed.search) {
    const kept = parsed.search
      .slice(1)
      .split('&')
      .filter((pair) => pair !== '' && !isTrackingParam(pair));
    // Assigning `search` re-serialises with the same encoding rules the
    // parser already applied, so the kept pairs come back unchanged.
    parsed.search = kept.length > 0 ? `?${kept.join('&')}` : '';
  }
  return parsed.href;
}

/** True when the URL's host equals an ignored domain or is a subdomain of one. */
export function isIgnored(url: string, ignoredDomains: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return ignoredDomains.some((entry) => {
    const domain = entry.trim().toLowerCase();
    return domain !== '' && (host === domain || host.endsWith(`.${domain}`));
  });
}

/** Find http(s) URLs in message content and forwarded snapshot content, in order. */
export function extractUrls(texts: string[]): string[] {
  return texts.flatMap((text) => (text.match(URL_PATTERN) ?? []).map(trimTrailing));
}

export interface SelectUrlsInput {
  texts: string[];
  ignoredDomains: readonly string[];
  max?: number;
}

export interface SelectedUrls {
  urls: string[];
  /** Distinct, non-ignored URLs dropped because they exceeded `max`. */
  skipped: number;
}

/** Extract → normalise → drop ignored → dedupe (order kept) → cap at `max`. */
export function selectUrls({ texts, ignoredDomains, max = 20 }: SelectUrlsInput): SelectedUrls {
  const unique = [
    ...new Set(
      extractUrls(texts)
        .map(normaliseUrl)
        .filter((url) => !isIgnored(url, ignoredDomains)),
    ),
  ];
  return { urls: unique.slice(0, max), skipped: Math.max(0, unique.length - max) };
}
