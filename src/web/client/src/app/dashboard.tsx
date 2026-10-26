import { createContext, useContext } from 'react';
import type { Admin, Api, DiscordState } from '../api/client.js';
import type { Route } from './router.js';

/** What every screen can reach: the API, who is signed in, Discord's state, routing and refresh. */
export interface Dashboard {
  api: Api;
  admin: Admin;
  discord: DiscordState | undefined;
  /** The bot's invite link (permissions = union of every Module's); null before the bot has logged in. */
  inviteUrl: string | null;
  route: Route;
  navigate(route: Route): void;
  /** Bumped by the Refresh button; screens list it in their load deps. */
  refreshKey: number;
  refresh(): void;
}

export const DashboardContext = createContext<Dashboard | null>(null);

export function useDashboard(): Dashboard {
  const value = useContext(DashboardContext);
  if (!value) throw new Error('useDashboard outside <App>');
  return value;
}
