import { useDashboard } from '../../app/dashboard.js';
import { useAsync } from '../../lib/useAsync.js';
import { dotLevel, StatusDot } from '../../ui/status.js';

/** One line per Module: a status dot and "enabled in N channels" for this guild. */
export function GuildOverview({ guildId }: { guildId: string }) {
  const { api, refreshKey } = useDashboard();
  const overview = useAsync(() => api.guildOverview(guildId), [api, guildId, refreshKey]);

  if (overview.error) return <p className="muted">Could not load this server.</p>;
  if (!overview.data) return <p className="muted">Loading…</p>;
  if (!overview.data.available) return null;

  return (
    <>
      <p className="muted small">Pick a channel on the left to switch Modules on for it.</p>
      <ul className="overview-list">
        {overview.data.modules.map((m) => (
          <li key={m.id} className="row">
            <StatusDot level={dotLevel(m)} />
            <span>
              {m.name}: enabled in {m.enabledChannels} channel{m.enabledChannels === 1 ? '' : 's'}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
