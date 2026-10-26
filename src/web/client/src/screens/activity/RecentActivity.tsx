import { useDashboard } from '../../app/dashboard.js';
import { useAsync } from '../../lib/useAsync.js';
import { ActivityList } from './ActivityList.js';

const RECENT = 10;

export interface RecentActivityProps {
  moduleId: string;
  moduleName: string;
  /** Thread Activity is stored under the parent channel, so a channel's list includes its threads. */
  channelId: string;
}

/** A Module's latest entries in one channel, for the channel row's "recent" expander. Loads on open and refresh. */
export function RecentActivity({ moduleId, moduleName, channelId }: RecentActivityProps) {
  const { api, refreshKey } = useDashboard();
  const page = useAsync(
    () => api.listActivity(moduleId, { channelId, limit: RECENT }),
    [api, moduleId, channelId, refreshKey],
  );
  const headingId = `recent-${moduleId}-${channelId}`;

  return (
    <section className="expander-body" aria-labelledby={headingId}>
      <div className="row">
        <h4 id={headingId} className="grow small">
          Recent {moduleName} activity
        </h4>
        <button type="button" onClick={page.reload} disabled={page.loading} aria-label="Refresh recent activity">
          ↻ Refresh
        </button>
      </div>
      {page.error ? (
        <p className="field-error small">Could not load activity.</p>
      ) : !page.data ? (
        <p className="muted small">Loading…</p>
      ) : (
        <ActivityList entries={page.data.entries} showPlace={false} empty="No activity in this channel yet." />
      )}
    </section>
  );
}
