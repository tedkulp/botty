export interface EnablementInput {
  /** Stored global switch; null means off. */
  global: boolean | null;
  /** Stored channel switch; null means the Module's channelDefault. */
  channel: boolean | null;
  channelDefault: boolean;
}

/** Enabled (in a channel): on globally AND on for the channel. */
export function isEnabled({ global, channel, channelDefault }: EnablementInput): boolean {
  return global === true && (channel ?? channelDefault);
}
