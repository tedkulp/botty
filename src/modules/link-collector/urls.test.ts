import { describe, expect, it } from 'vitest';
import { extractUrls, isIgnored, normaliseUrl, selectUrls } from './urls.js';

describe('selectUrls', () => {
  it('extracts, normalises, drops ignored and dedupes, preserving order', () => {
    const result = selectUrls({
      texts: [
        'look https://b.com/x?utm_source=t. and https://media.giphy.com/y.gif',
        '<https://a.com/z> and ||https://b.com/x||',
      ],
      ignoredDomains: ['giphy.com'],
    });

    expect(result).toEqual({ urls: ['https://b.com/x', 'https://a.com/z'], skipped: 0 });
  });

  it('keeps the first 20 URLs and counts the rest as skipped', () => {
    const texts = [Array.from({ length: 25 }, (_, i) => `https://example.com/${i + 1}`).join(' ')];

    const result = selectUrls({ texts, ignoredDomains: [] });

    expect(result.urls).toHaveLength(20);
    expect(result.urls[0]).toBe('https://example.com/1');
    expect(result.urls[19]).toBe('https://example.com/20');
    expect(result.skipped).toBe(5);
  });

  it('honours a custom max', () => {
    const result = selectUrls({
      texts: ['https://a.com/1 https://a.com/2 https://a.com/3'],
      ignoredDomains: [],
      max: 2,
    });

    expect(result).toEqual({ urls: ['https://a.com/1', 'https://a.com/2'], skipped: 1 });
  });

  it('returns nothing for text without URLs', () => {
    expect(selectUrls({ texts: ['hi', ''], ignoredDomains: [] })).toEqual({ urls: [], skipped: 0 });
  });
});

describe('isIgnored', () => {
  const ignored = ['giphy.com', 'tenor.com'];
  it.each([
    ['exact host', 'https://giphy.com/gifs/x', true],
    ['subdomain', 'https://media.giphy.com/media/x.gif', true],
    ['host case-insensitive', 'https://Media.GIPHY.com/x', true],
    ['unrelated host', 'https://example.com/giphy.com', false],
    ['suffix that is not a subdomain', 'https://notgiphy.com/x', false],
    ['unparseable URL', 'not a url', false],
  ])('%s', (_name, url, expected) => {
    expect(isIgnored(url, ignored)).toBe(expected);
  });

  it('matches entries written with mixed case', () => {
    expect(isIgnored('https://giphy.com/x', ['Giphy.COM'])).toBe(true);
  });
});

describe('normaliseUrl', () => {
  it.each([
    ['plain URL unchanged', 'https://example.com/a', 'https://example.com/a'],
    ['trailing period', 'https://example.com/a.', 'https://example.com/a'],
    ['trailing comma', 'https://example.com/a,', 'https://example.com/a'],
    ['trailing mixed punctuation', 'https://example.com/a?!;:', 'https://example.com/a'],
    ['unbalanced closing paren', 'https://example.com/a)', 'https://example.com/a'],
    [
      'balanced parens kept',
      'https://en.wikipedia.org/wiki/Foo_(bar)',
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ],
    [
      'balanced parens kept, extra closing stripped',
      'https://en.wikipedia.org/wiki/Foo_(bar)).',
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ],
    [
      'tracking params stripped, real params kept',
      'https://example.com/a?utm_source=x&id=7&fbclid=y&utm_medium=z&gclid=g&si=s&q=hi',
      'https://example.com/a?id=7&q=hi',
    ],
    [
      'only tracking params leaves no query',
      'https://example.com/a?utm_source=x&si=abc',
      'https://example.com/a',
    ],
    [
      'fragment kept',
      'https://example.com/a?utm_source=x#section-2',
      'https://example.com/a#section-2',
    ],
    [
      'query left untouched when nothing is stripped',
      'https://example.com/a?b=1&a=2&c=a%20b',
      'https://example.com/a?b=1&a=2&c=a%20b',
    ],
    ['path case preserved', 'https://example.com/CaseSensitive', 'https://example.com/CaseSensitive'],
  ])('%s', (_name, input, expected) => {
    expect(normaliseUrl(input)).toBe(expected);
  });
});

describe('extractUrls', () => {
  it.each([
    ['plain URL', ['see https://example.com/a for more'], ['https://example.com/a']],
    ['suppressed embed', ['<https://example.com/a>'], ['https://example.com/a']],
    ['spoiler', ['||https://example.com/a||'], ['https://example.com/a']],
    [
      'multiple URLs on one line',
      ['https://a.com and http://b.com/x'],
      ['https://a.com', 'http://b.com/x'],
    ],
    ['markdown link', ['[title](https://example.com/a)'], ['https://example.com/a']],
    ['surrounding punctuation', ['("https://example.com/a").'], ['https://example.com/a']],
    [
      'across texts including forwarded snapshots',
      ['https://a.com', 'fwd: https://b.com'],
      ['https://a.com', 'https://b.com'],
    ],
    ['no http(s) URLs', ['hello ftp://x.com'], []],
  ])('%s', (_name, texts, expected) => {
    expect(extractUrls(texts)).toEqual(expected);
  });
});
