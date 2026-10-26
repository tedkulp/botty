import { useCallback, useEffect, useState } from 'react';

/**
 * Client-side routes. Each screen owns one `screen` value, with its
 * `parseRoute` / `routePath` cases and a branch in `App`'s screen switch.
 */
export type Route = { screen: 'modules'; moduleId?: string } | { screen: 'guild'; guildId: string; channelId?: string };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'modules' && parts[1]) return { screen: 'modules', moduleId: parts[1] };
  if (parts[0] === 'guilds' && parts[1]) {
    if (parts[2] === 'channels' && parts[3]) return { screen: 'guild', guildId: parts[1], channelId: parts[3] };
    return { screen: 'guild', guildId: parts[1] };
  }
  return { screen: 'modules' };
}

export function routePath(route: Route): string {
  switch (route.screen) {
    case 'modules':
      return route.moduleId ? `/modules/${encodeURIComponent(route.moduleId)}` : '/modules';
    case 'guild': {
      const guild = `/guilds/${encodeURIComponent(route.guildId)}`;
      return route.channelId ? `${guild}/channels/${encodeURIComponent(route.channelId)}` : guild;
    }
  }
}

/** The current route, kept in the URL (history API) so reloads and back/forward work. */
export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((next: Route) => {
    const path = routePath(next);
    if (path !== window.location.pathname) window.history.pushState(null, '', path);
    setRoute(next);
  }, []);

  return [route, navigate];
}
