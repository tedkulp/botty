import { useCallback } from 'react';
import type { ModuleSummary } from '../../api/client.js';
import { routePath } from '../../app/router.js';
import { useDashboard } from '../../app/dashboard.js';
import { useAsync } from '../../lib/useAsync.js';
import { ColumnAndPane } from '../../shell/Shell.js';
import { dotLevel, StatusDot } from '../../ui/status.js';
import { ModulePane } from './ModulePane.js';

/** ⚙️ Modules: every Module in the column, the selected one's global settings in the pane. */
export function ModulesScreen({ moduleId }: { moduleId: string | undefined }) {
  const { api, navigate, refreshKey } = useDashboard();
  const list = useAsync(() => api.listModules(), [api, refreshKey]);
  const modules = list.data ?? [];
  const selectedId = moduleId ?? modules[0]?.id;

  // Keep the column's dot in step with what the pane just changed.
  const setList = list.setData;
  const onChanged = useCallback(
    (summary: ModuleSummary) => setList((prev = []) => prev.map((m) => (m.id === summary.id ? summary : m))),
    [setList],
  );

  const column = (
    <ul className="column-list">
      {list.error ? <li className="muted small">Could not load Modules.</li> : null}
      {modules.map((m) => {
        const href = routePath({ screen: 'modules', moduleId: m.id });
        return (
          <li key={m.id}>
            <a
              href={href}
              className={`column-item${m.id === selectedId ? ' selected' : ''}`}
              aria-current={m.id === selectedId ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate({ screen: 'modules', moduleId: m.id });
              }}
            >
              <StatusDot level={dotLevel(m)} />
              {m.name}
            </a>
          </li>
        );
      })}
    </ul>
  );

  let pane;
  if (selectedId) pane = <ModulePane key={selectedId} moduleId={selectedId} onChanged={onChanged} />;
  else if (list.loading) pane = <p className="muted">Loading…</p>;
  else pane = <p className="muted">No Modules are compiled into this bot.</p>;

  return <ColumnAndPane columnLabel="Modules" column={column} pane={pane} />;
}
