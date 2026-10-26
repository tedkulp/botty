import { useState } from 'react';

/**
 * Busy and error state for an Enable switch: `toggle(on)` runs `send(on)`,
 * keeps `busy` true while it is in flight and sets `error` if it fails.
 */
export function useSwitchRequest(send: (on: boolean) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      await send(on);
    } catch {
      setError('The switch did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, toggle };
}
