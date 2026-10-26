import type { ActivityItem } from '../../api/client.js';

const LEVEL_DOT = { info: 'ok', warn: 'degraded', error: 'error' } as const;

/** "Homelab · #links", from cached names when the server knew them, raw ids otherwise. */
function where(entry: ActivityItem, showPlace: boolean): string | null {
  if (!showPlace) return null;
  const parts: string[] = [];
  if (entry.guild) parts.push(entry.guild.name ?? entry.guild.id);
  if (entry.channel) parts.push(`#${entry.channel.name ?? entry.channel.id}`);
  return parts.length ? parts.join(' · ') : null;
}

export interface ActivityListProps {
  entries: ActivityItem[];
  /** Show server and channel per entry (off in a channel's own "recent" list). */
  showPlace?: boolean;
  empty?: string;
}

/**
 * Activity entries, newest first. Entries hold references only (jump-links,
 * names, URLs, ids), never message text, so this renders them as they are.
 */
export function ActivityList({ entries, showPlace = true, empty = 'No activity yet.' }: ActivityListProps) {
  if (entries.length === 0) return <p className="muted small">{empty}</p>;
  return (
    <ul className="activity-list">
      {entries.map((entry) => {
        const place = where(entry, showPlace);
        return (
          <li key={entry.id} className={`activity activity-${entry.level}`}>
            <div className="row small muted">
              <span className={`dot dot-${LEVEL_DOT[entry.level]}`} title={entry.level} />
              <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
              {place && <span>{place}</span>}
              {entry.actor && <span>by {entry.actor.name}</span>}
              {entry.link && (
                <a href={entry.link} target="_blank" rel="noreferrer">
                  jump to message
                </a>
              )}
            </div>
            <div className="activity-message">{entry.message}</div>
          </li>
        );
      })}
    </ul>
  );
}
