import type { ReactNode } from 'react';
import { useDashboard } from '../app/dashboard.js';

// The Variant A layout: server rail | column | pane, under a top bar and the
// Discord-down banner. Screens render <ColumnAndPane> as Shell's children.

export interface ShellProps {
  /** Fixed entries at the top of the rail (⚙️ Modules). */
  rail: ReactNode;
  /** Guild icons under the divider. */
  guilds: ReactNode;
  children: ReactNode;
}

export function Shell({ rail, guilds, children }: ShellProps) {
  const { admin, refresh, discord, inviteUrl } = useDashboard();
  return (
    <div className="app">
      {discord === 'down' && <DiscordBanner />}
      <header className="topbar">
        <span className="brand">botty</span>
        <span className="grow" />
        {inviteUrl && (
          <a className="btn small" href={inviteUrl} target="_blank" rel="noreferrer">
            Invite bot
          </a>
        )}
        <button type="button" className="btn small" onClick={refresh}>
          Refresh
        </button>
        <span className="muted small">{admin.name}</span>
        <form method="post" action="/auth/logout">
          <button type="submit" className="btn small">
            Log out
          </button>
        </form>
      </header>
      <div className="shell">
        <nav className="rail" aria-label="Servers">
          {rail}
          <div className="rail-divider" />
          {guilds}
        </nav>
        {children}
      </div>
    </div>
  );
}

export interface RailButtonProps {
  label: string;
  icon: ReactNode;
  selected: boolean;
  disabled?: boolean;
  onSelect(): void;
}

export function RailButton({ label, icon, selected, disabled, onSelect }: RailButtonProps) {
  return (
    <button
      type="button"
      className={`rail-button${selected ? ' selected' : ''}`}
      title={label}
      aria-label={label}
      aria-current={selected ? 'page' : undefined}
      disabled={disabled}
      onClick={onSelect}
    >
      {icon}
    </button>
  );
}

export interface ColumnAndPaneProps {
  /** Accessible name of the column's navigation, e.g. "Modules" or a guild name. */
  columnLabel: string;
  column: ReactNode;
  pane: ReactNode;
}

/** The column (a list to pick from) and the pane (what's picked). */
export function ColumnAndPane({ columnLabel, column, pane }: ColumnAndPaneProps) {
  return (
    <>
      <nav className="column" aria-label={columnLabel}>
        <div className="column-title">{columnLabel}</div>
        {column}
      </nav>
      <main className="pane">{pane}</main>
    </>
  );
}

export function DiscordBanner() {
  return (
    <div className="banner" role="status" aria-label="Discord connection">
      ⚠️ The bot is disconnected from Discord. Servers and channels are unavailable; ⚙️ Modules and Global config
      still work.
    </div>
  );
}
