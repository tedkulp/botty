import { useState } from 'react';
import { ApiError, type ModuleDetail, type ModuleSummary } from '../../api/client.js';
import { useDashboard } from '../../app/dashboard.js';
import { SchemaForm, type SaveResult } from '../../forms/SchemaForm.js';
import { useAsync } from '../../lib/useAsync.js';
import { LastEdited, StatusLine, Switch } from '../../ui/status.js';

function summaryOf(m: ModuleDetail): ModuleSummary {
  return { id: m.id, name: m.name, enabled: m.enabled, status: m.status, lastError: m.lastError };
}

export interface ModulePaneProps {
  moduleId: string;
  /** Called after a switch or save so the column can update its dot. */
  onChanged(summary: ModuleSummary): void;
}

/**
 * One Module's global settings: the global switch (amber while setup or
 * cleanup runs), status and last error, a needs-review flag and the Global
 * config form. #22 adds the Activity feed below the form.
 */
export function ModulePane({ moduleId, onChanged }: ModulePaneProps) {
  const { api, refreshKey } = useDashboard();
  const detail = useAsync(() => api.getModule(moduleId), [api, moduleId, refreshKey]);
  const [busy, setBusy] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  if (detail.error) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return <p className="muted">{missing ? `There is no Module called “${moduleId}”.` : 'Could not load this Module.'}</p>;
  }
  const module = detail.data;
  if (!module) return <p className="muted">Loading…</p>;

  async function toggle(on: boolean) {
    setBusy(true);
    setSwitchError(null);
    try {
      const result = await api.setGlobalEnabled(moduleId, on);
      const next = { ...module!, ...result };
      detail.setData(next);
      onChanged(summaryOf(next));
    } catch {
      setSwitchError('The switch did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function save(payload: Record<string, unknown>): Promise<SaveResult> {
    const result = await api.saveGlobalConfig(moduleId, payload);
    if (!result.ok) return result;
    detail.setData(result.module);
    onChanged(summaryOf(result.module));
    return { ok: true };
  }

  return (
    <article className="panel">
      <div className="row">
        <h2 className="grow">{module.name}</h2>
        <span className="muted small">{busy ? 'working…' : module.enabled ? 'on' : 'off'}</span>
        <Switch label="Global switch" on={module.enabled} busy={busy} onToggle={toggle} />
      </div>
      {switchError && <div className="field-error small">{switchError}</div>}
      <div className="status-block">
        {module.enabled ? <StatusLine status={module.status} /> : <span className="muted small">Switched off globally</span>}
        {module.lastError && (
          <div className="small muted">
            Last error: {module.lastError.message} · {new Date(module.lastError.at).toLocaleString()}
          </div>
        )}
      </div>
      <hr />
      <div className="row">
        <h3 className="grow">Global config</h3>
        {module.needsReview && (
          <span className="pill pill-warn" title="A stored value was invalid and fell back to its default. Review and save.">
            needs review
          </span>
        )}
      </div>
      <SchemaForm
        schema={module.schema.global}
        value={module.config}
        onSave={save}
        footer={<LastEdited by={module.updatedBy} at={module.updatedAt} />}
      />
    </article>
  );
}
