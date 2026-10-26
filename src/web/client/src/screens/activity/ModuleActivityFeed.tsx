import { useState } from 'react';
import type { ActivityItem } from '../../api/client.js';
import { useDashboard } from '../../app/dashboard.js';
import { useAsync } from '../../lib/useAsync.js';
import { ActivityList } from './ActivityList.js';

const PAGE_SIZE = 50;

interface Page {
  entries: ActivityItem[];
  nextBefore: number | null;
}

/**
 * The ⚙️ Module page's Activity feed: server and channel filters, "load more"
 * and a refresh button. It loads on open and on refresh only (no live push).
 */
export function ModuleActivityFeed({ moduleId }: { moduleId: string }) {
  const { api, refreshKey } = useDashboard();
  const [guildId, setGuildId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);

  const guilds = useAsync(async () => {
    const list = await api.listGuilds();
    return list.available ? list.guilds : [];
  }, [api, refreshKey]);
  const channels = useAsync(async () => {
    if (!guildId) return [];
    const tree = await api.guildChannels(guildId).catch(() => null);
    if (!tree?.available) return [];
    return tree.categories.flatMap((category) => category.channels).filter((c) => c.kind !== 'category');
  }, [api, guildId, refreshKey]);

  const filter = { ...(guildId ? { guildId } : {}), ...(channelId ? { channelId } : {}) };
  const page = useAsync<Page>(
    () => api.listActivity(moduleId, { ...filter, limit: PAGE_SIZE }),
    [api, moduleId, guildId, channelId, refreshKey],
  );

  async function loadMore() {
    const before = page.data?.nextBefore;
    if (!before) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const next = await api.listActivity(moduleId, { ...filter, limit: PAGE_SIZE, before });
      page.setData((prev) => ({ entries: [...(prev?.entries ?? []), ...next.entries], nextBefore: next.nextBefore }));
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="activity-feed" aria-labelledby={`activity-${moduleId}`}>
      <div className="row">
        <h3 id={`activity-${moduleId}`} className="grow">
          Activity
        </h3>
        <button type="button" onClick={page.reload} disabled={page.loading} aria-label="Refresh activity">
          ↻ Refresh
        </button>
      </div>
      <div className="row small activity-filters">
        <select
          aria-label="Server"
          value={guildId}
          onChange={(e) => {
            setGuildId(e.target.value);
            setChannelId('');
          }}
        >
          <option value="">All servers</option>
          {(guilds.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select aria-label="Channel" value={channelId} disabled={!guildId} onChange={(e) => setChannelId(e.target.value)}>
          <option value="">All channels</option>
          {(channels.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              #{c.name}
            </option>
          ))}
        </select>
      </div>
      {page.error ? (
        <p className="field-error small">Could not load activity.</p>
      ) : !page.data ? (
        <p className="muted small">Loading…</p>
      ) : (
        <>
          <ActivityList entries={page.data.entries} />
          {page.data.nextBefore !== null && (
            <button type="button" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
          {moreError && <div className="field-error small">Could not load more. Try again.</div>}
        </>
      )}
    </section>
  );
}
