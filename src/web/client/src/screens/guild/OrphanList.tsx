import { useState } from 'react';
import type { Orphan } from '../../api/client.js';
import { useDashboard } from '../../app/dashboard.js';

export interface OrphanListProps {
  orphans: Orphan[];
  /** Called after a row was deleted. */
  onDeleted(): void;
}

/**
 * Stored channel settings whose channel (or guild) is gone, as "unavailable"
 * rows. Nothing is deleted unless an Admin presses Delete.
 */
export function OrphanList({ orphans, onDeleted }: OrphanListProps) {
  const { api } = useDashboard();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (orphans.length === 0) return null;

  async function remove(orphan: Orphan) {
    const key = `${orphan.moduleId}:${orphan.channelId}`;
    setDeleting(key);
    setError(null);
    try {
      await api.deleteOrphan(orphan.moduleId, orphan.channelId);
      onDeleted();
    } catch {
      setError('Could not delete that row. Try again.');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="orphans">
      <h3>Unavailable channels</h3>
      <p className="muted small">Settings kept for channels the bot can no longer find. They are never deleted automatically.</p>
      {error && <div className="field-error small">{error}</div>}
      <ul className="orphan-list">
        {orphans.map((o) => {
          const key = `${o.moduleId}:${o.channelId}`;
          return (
            <li key={key} className="row small">
              <span className="pill pill-muted">unavailable</span>
              <span className="grow">
                unavailable channel {o.channelId} · {o.moduleName}
                {o.enabled !== null && ` · switched ${o.enabled ? 'on' : 'off'}`}
                {o.updatedBy && <span className="muted"> · last edited by {o.updatedBy.name}</span>}
              </span>
              <button type="button" className="btn small" disabled={deleting === key} onClick={() => void remove(o)}>
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
