import { useCallback, useMemo, useState } from 'react';
import type { Api } from '../api/client.js';
import { useAsync } from '../lib/useAsync.js';
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
  const status = useAsync(() => api.discordStatus(), [api, refreshKey]);

  const dashboard = useMemo<Dashboard>(
    () => ({ api, admin, discord: status.data, route, navigate, refreshKey, refresh }),
    [api, admin, status.data, route, navigate, refreshKey, refresh],
  );

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
        // #21: guild icons go here, disabled while `discord === 'down'`.
        guilds={null}
      >
        {route.screen === 'modules' && <ModulesScreen moduleId={route.moduleId} />}
      </Shell>
    </DashboardContext.Provider>
  );
}
