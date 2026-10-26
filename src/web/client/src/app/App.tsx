import { useCallback, useMemo, useRef, useState } from 'react';
import type { Api, Guild, Orphan } from '../api/client.js';
import { useAsync } from '../lib/useAsync.js';
import { GuildScreen } from '../screens/guild/GuildScreen.js';
import { ModulesScreen } from '../screens/modules/ModulesScreen.js';
import { RailButton, Shell } from '../shell/Shell.js';
import { DashboardContext, type Dashboard } from './dashboard.js';
import { useRoute } from './router.js';

export interface AppProps {
  api: Api;
}

/**
 * Auth gate + shell. Without a session (`/api/me` -> null) the browser goes to
 * sign in; otherwise the rail, the selected screen's column and pane render.
 */
export function App({ api }: AppProps) {
  const me = useAsync(async () => {
    const admin = await api.me();
    if (!admin) api.signIn();
    return admin;
  }, [api]);

  if (me.error) return <p className="boot">Could not reach botty. Reload to try again.</p>;
  if (!me.data) return <p className="boot muted">{me.loading ? 'Loading…' : 'Redirecting to sign in…'}</p>;
  return <SignedIn api={api} admin={me.data} />;
}

function SignedIn({ api, admin }: { api: Api; admin: NonNullable<Dashboard['admin']> }) {
  const [route, navigate] = useRoute();
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);
  const status = useAsync(() => api.status(), [api, refreshKey]);
  const discord = status.data?.discord;
  const inviteUrl = status.data?.inviteUrl ?? null;

  // The rail keeps the last guild list it saw, so a disconnect shows the icons disabled.
  const lastGuilds = useRef<Guild[]>([]);
  const guildList = useAsync(async () => {
    const list = await api.listGuilds();
    if (list.available) lastGuilds.current = list.guilds;
    return list;
  }, [api, refreshKey]);
  const orphanList = useAsync(() => api.listOrphans(), [api, refreshKey]);
  const guilds = lastGuilds.current;
  const guildsUp = discord !== 'down' && guildList.data?.available !== false;
  const orphans: Orphan[] = orphanList.data?.available ? orphanList.data.orphans : [];
  // Guilds that only exist in stored settings (the bot left them) get a rail entry for their orphans.
  const vanished = [...new Set(orphans.map((o) => o.guildId).filter((id): id is string => !!id))].filter(
    (id) => !guilds.some((g) => g.id === id),
  );

  const dashboard = useMemo<Dashboard>(
    () => ({ api, admin, discord, inviteUrl, route, navigate, refreshKey, refresh }),
    [api, admin, discord, inviteUrl, route, navigate, refreshKey, refresh],
  );

  const selectedGuild = route.screen === 'guild' ? route.guildId : undefined;
  return (
    <DashboardContext.Provider value={dashboard}>
      <Shell
        rail={
          <RailButton
            label="Modules"
            icon="⚙️"
            selected={route.screen === 'modules'}
            onSelect={() => navigate({ screen: 'modules' })}
          />
        }
        guilds={
          <>
            {guilds.map((g) => (
              <RailButton
                key={g.id}
                label={g.name}
                icon={g.icon ? <img src={g.icon} alt="" /> : initials(g.name)}
                selected={selectedGuild === g.id}
                disabled={!guildsUp}
                onSelect={() => navigate({ screen: 'guild', guildId: g.id })}
              />
            ))}
            {guildsUp &&
              vanished.map((id) => (
                <RailButton
                  key={id}
                  label={`Unavailable server ${id}`}
                  icon="?"
                  selected={selectedGuild === id}
                  onSelect={() => navigate({ screen: 'guild', guildId: id })}
                />
              ))}
          </>
        }
      >
        {route.screen === 'modules' && <ModulesScreen moduleId={route.moduleId} />}
        {route.screen === 'guild' && (
          <GuildScreen
            key={route.guildId}
            guildId={route.guildId}
            channelId={route.channelId}
            guildName={guilds.find((g) => g.id === route.guildId)?.name}
            orphans={orphans.filter((o) => o.guildId === route.guildId)}
            onOrphansChanged={orphanList.reload}
          />
        )}
      </Shell>
    </DashboardContext.Provider>
  );
}

/** "Board games" -> "BG": the rail shows initials for a guild without an icon. */
function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?'
  );
}
