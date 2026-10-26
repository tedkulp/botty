import type { ChannelCategory, ChannelNode } from '../../api/client.js';
import { routePath } from '../../app/router.js';
import { useDashboard } from '../../app/dashboard.js';

/** Discord's placeholder name for an obfuscated channel. */
const HIDDEN = '___hidden___';

export interface ChannelTreeViewProps {
  guildId: string;
  categories: ChannelCategory[];
  selectedChannelId: string | undefined;
  /** Module id -> name, for the icons' titles. */
  moduleNames: ReadonlyMap<string, string>;
}

/** A small badge per Module Enabled in a channel. */
function ModuleIcons({ ids, names }: { ids: string[]; names: ReadonlyMap<string, string> }) {
  return (
    <span className="module-icons">
      {ids.map((id) => {
        const name = names.get(id) ?? id;
        return (
          <span key={id} className="module-icon" title={name}>
            {name.slice(0, 1).toUpperCase()}
          </span>
        );
      })}
    </span>
  );
}

function label(name: string): string {
  return name === HIDDEN ? 'hidden channel' : name;
}

/**
 * The channel tree: grouped by category in Discord order, an icon per Enabled
 * Module, threads under their parent as read-only "follows parent", and locked
 * (unviewable or obfuscated) channels greyed out and not selectable.
 */
export function ChannelTreeView({ guildId, categories, selectedChannelId, moduleNames }: ChannelTreeViewProps) {
  const { navigate } = useDashboard();

  function item(channel: ChannelNode) {
    const selected = channel.id === selectedChannelId;
    const prefix = channel.kind === 'voice' || channel.kind === 'stage' ? '🔊' : '#';
    return (
      <li key={channel.id} aria-disabled={channel.viewable ? undefined : true}>
        {channel.viewable ? (
          <a
            href={routePath({ screen: 'guild', guildId, channelId: channel.id })}
            className={`column-item${selected ? ' selected' : ''}`}
            aria-current={selected ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate({ screen: 'guild', guildId, channelId: channel.id });
            }}
          >
            <span className="grow">
              {prefix} {channel.name}
            </span>
            <ModuleIcons ids={channel.enabledModules} names={moduleNames} />
          </a>
        ) : (
          <div className="column-item locked" title="The bot cannot view this channel">
            🔒 {label(channel.name)}
          </div>
        )}
        {channel.threads.length > 0 && (
          <ul className="column-list threads">
            {channel.threads.map((thread) => (
              <li key={thread.id} className="thread small">
                ↳ {label(thread.name)} <span className="muted">· follows parent</span>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <div className="channel-tree">
      {categories.map((category) => (
        <div key={category.id ?? 'top'} className="category">
          {category.name !== null && (
            <div className="category-name">{category.viewable ? category.name : `🔒 ${label(category.name)}`}</div>
          )}
          <ul className="column-list">{category.channels.map(item)}</ul>
        </div>
      ))}
    </div>
  );
}
