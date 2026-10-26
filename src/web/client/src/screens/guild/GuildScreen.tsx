import { useMemo } from 'react';
import { ApiError, type Orphan } from '../../api/client.js';
import { useDashboard } from '../../app/dashboard.js';
import { useAsync } from '../../lib/useAsync.js';
import { ColumnAndPane } from '../../shell/Shell.js';
import { ChannelPane } from './ChannelPane.js';
import { ChannelTreeView } from './ChannelTreeView.js';
import { GuildOverview } from './GuildOverview.js';
import { OrphanList } from './OrphanList.js';

export interface GuildScreenProps {
  guildId: string;
  channelId: string | undefined;
  /** The guild's name as the rail knows it (shown while the tree loads or is unavailable). */
  guildName: string | undefined;
  /** This guild's orphan rows. */
  orphans: Orphan[];
  /** Reload orphans (after a delete). */
  onOrphansChanged(): void;
}

const UNAVAILABLE = 'Channels are unavailable while the bot is disconnected from Discord.';

/**
 * A guild selected in the rail: the channel tree in the column; the guild
 * overview (or the selected channel's Module rows) in the pane. A guild that
 * is no longer in the cache shows only its orphan rows.
 */
export function GuildScreen({ guildId, channelId, guildName, orphans, onOrphansChanged }: GuildScreenProps) {
  const { api, refreshKey, discord } = useDashboard();
  const tree = useAsync(() => api.guildChannels(guildId), [api, guildId, refreshKey]);
  const modules = useAsync(() => api.listModules(), [api, refreshKey]);
  const moduleNames = useMemo(() => new Map((modules.data ?? []).map((m) => [m.id, m.name])), [modules.data]);

  const vanished = tree.error instanceof ApiError && tree.error.status === 404;
  const down = discord === 'down' || tree.data?.available === false;
  const name = (tree.data?.available ? tree.data.guild.name : undefined) ?? guildName ?? (vanished ? 'Unavailable server' : 'Server');

  let column;
  if (down) column = <p className="muted small">{UNAVAILABLE}</p>;
  else if (vanished) column = <p className="muted small">The bot is no longer in this server.</p>;
  else if (tree.error) column = <p className="muted small">Could not load channels.</p>;
  else if (!tree.data?.available) column = <p className="muted small">Loading…</p>;
  else
    column = (
      <ChannelTreeView
        guildId={guildId}
        categories={tree.data.categories}
        selectedChannelId={channelId}
        moduleNames={moduleNames}
      />
    );

  let pane;
  if (down) pane = <p className="muted">{UNAVAILABLE}</p>;
  else if (channelId && !vanished) pane = <ChannelPane key={channelId} channelId={channelId} onChanged={tree.reload} />;
  else
    pane = (
      <article className="panel">
        <h2>{name}</h2>
        {!vanished && <GuildOverview guildId={guildId} />}
        {vanished && orphans.length === 0 && <p className="muted">Nothing is stored for this server.</p>}
        <OrphanList orphans={orphans} onDeleted={onOrphansChanged} />
      </article>
    );

  return <ColumnAndPane columnLabel={name} column={column} pane={pane} />;
}
