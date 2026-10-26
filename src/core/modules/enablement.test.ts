import { describe, expect, it } from 'vitest';
import { isEnabled } from './enablement.js';

describe('isEnabled', () => {
  it('is off whenever the Module is off globally, including null', () => {
    for (const global of [false, null]) {
      for (const channel of [true, false, null]) {
        for (const channelDefault of [true, false]) {
          expect(isEnabled({ global, channel, channelDefault })).toBe(false);
        }
      }
    }
  });

  it('follows an explicit channel switch when on globally', () => {
    expect(isEnabled({ global: true, channel: true, channelDefault: false })).toBe(true);
    expect(isEnabled({ global: true, channel: false, channelDefault: true })).toBe(false);
  });

  it('uses channelDefault when the channel has no stored choice', () => {
    expect(isEnabled({ global: true, channel: null, channelDefault: true })).toBe(true);
    expect(isEnabled({ global: true, channel: null, channelDefault: false })).toBe(false);
  });
});
