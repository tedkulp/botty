import type { ModuleStatus } from '../api/client.js';

/** What a dot shows: a Module status, or "off" for a Module switched off. */
export type DotLevel = ModuleStatus['level'] | 'off';

const DOT_TITLE: Record<DotLevel, string> = { ok: 'ok', degraded: 'degraded', error: 'error', off: 'switched off' };

export function StatusDot({ level }: { level: DotLevel }) {
  return <span className={`dot dot-${level}`} title={DOT_TITLE[level]} />;
}

/** The dot level for a Module: its status when on, "off" otherwise. */
export function dotLevel(module: { enabled: boolean; status: ModuleStatus }): DotLevel {
  return module.enabled ? module.status.level : 'off';
}

export function StatusLine({ status }: { status: ModuleStatus }) {
  return (
    <span className="row small">
      <StatusDot level={status.level} />
      <span>{status.level}</span>
      {status.message && <span className="muted">{status.message}</span>}
    </span>
  );
}

export interface SwitchProps {
  label: string;
  on: boolean;
  /** Amber while a request is in flight; not clickable. */
  busy?: boolean;
  disabled?: boolean;
  onToggle(next: boolean): void;
}

export function Switch({ label, on, busy = false, disabled, onToggle }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      aria-busy={busy}
      className={`toggle${on ? ' on' : ''}${busy ? ' busy' : ''}`}
      disabled={disabled}
      onClick={() => !busy && onToggle(!on)}
    />
  );
}

/** "Last edited by Ada · 2026-10-26 14:02", or nothing for never-edited config. */
export function LastEdited({ by, at }: { by: { name: string } | null; at: string | null }) {
  if (!by) return <div className="muted small">Never edited</div>;
  const when = at ? new Date(at).toLocaleString() : '';
  return (
    <div className="muted small">
      Last edited by {by.name}
      {when && ` · ${when}`}
    </div>
  );
}
