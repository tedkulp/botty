import { useCallback } from 'react';
import { ApiError, type ChannelModule, type ChannelModules } from '../../api/client.js';
import { useDashboard } from '../../app/dashboard.js';
import { useAsync } from '../../lib/useAsync.js';
import { ChannelModuleRow } from './ChannelModuleRow.js';

export interface ChannelPaneProps {
  channelId: string;
  /** Called after a switch or save, so the channel tree can refresh its Module icons. */
  onChanged(): void;
}

/** A channel selected in the tree: one row per Module. */
export function ChannelPane({ channelId, onChanged }: ChannelPaneProps) {
  const { api, refreshKey } = useDashboard();
  const data = useAsync(() => api.channelModules(channelId), [api, channelId, refreshKey]);

  const setData = data.setData;
  const replace = useCallback(
    (next: ChannelModule) => {
      setData((prev) => {
        const current = prev as Extract<ChannelModules, { available: true }>;
        return { ...current, modules: current.modules.map((m) => (m.id === next.id ? next : m)) };
      });
      onChanged();
    },
    [setData, onChanged],
  );

  if (data.error) {
    const missing = data.error instanceof ApiError && data.error.status === 404;
    return <p className="muted">{missing ? 'This channel is not in the bot’s cache.' : 'Could not load this channel.'}</p>;
  }
  if (!data.data) return <p className="muted">Loading…</p>;
  if (!data.data.available) return <p className="muted">Channels are unavailable while the bot is disconnected from Discord.</p>;
  const { channel, modules } = data.data;

  return (
    <article className="panel">
      <h2>#{channel.name}</h2>
      <p className="muted small">Threads in this channel follow it.</p>
      {modules.length === 0 && <p className="muted">No Modules are compiled into this bot.</p>}
      {modules.map((m) => (
        <ChannelModuleRow key={m.id} channelId={channel.id} channelName={channel.name} module={m} onChanged={replace} />
      ))}
    </article>
  );
}
