import { ApiError, type ModuleDetail, type ModuleSummary } from '../../api/client.js';
import { useDashboard } from '../../app/dashboard.js';
import { SchemaForm, type SaveResult } from '../../forms/SchemaForm.js';
import { useAsync } from '../../lib/useAsync.js';
import { useSwitchRequest } from '../../lib/useSwitchRequest.js';
import { LastEdited, LastErrorLine, NeedsReviewPill, StatusLine, Switch } from '../../ui/status.js';
import { ModuleActivityFeed } from '../activity/ModuleActivityFeed.js';

function summaryOf(m: ModuleDetail): ModuleSummary {
  return { id: m.id, name: m.name, enabled: m.enabled, status: m.status, lastError: m.lastError };
}

export interface ModulePaneProps {
  moduleId: string;
  /** Called after a switch or save so the column can update its dot. */
  onChanged(summary: ModuleSummary): void;
}

/**
 * One Module's global switch (amber while setup or
 * cleanup runs), status and last error, a needs-review flag and the Global
 * config form, then the Module's Activity feed.
 */
export function ModulePane({ moduleId, onChanged }: ModulePaneProps) {
  const { api, refreshKey } = useDashboard();
  const detail = useAsync(() => api.getModule(moduleId), [api, moduleId, refreshKey]);
  const { busy, error: switchError, toggle } = useSwitchRequest(async (on) => {
    const result = await api.setGlobalEnabled(moduleId, on);
    const next = { ...detail.data!, ...result };
    detail.setData(next);
    onChanged(summaryOf(next));
  });

  if (detail.error) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return <p className="muted">{missing ? `There is no Module called “${moduleId}”.` : 'Could not load this Module.'}</p>;
  }
  const module = detail.data;
  if (!module) return <p className="muted">Loading…</p>;

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
        <LastErrorLine label="Last error" error={module.lastError} />
      </div>
      <hr />
      <div className="row">
        <h3 className="grow">Global config</h3>
        {module.needsReview && <NeedsReviewPill />}
      </div>
      <SchemaForm
        schema={module.schema.global}
        value={module.config}
        onSave={save}
        footer={<LastEdited by={module.updatedBy} at={module.updatedAt} />}
      />
      <hr />
      <ModuleActivityFeed moduleId={moduleId} />
    </article>
  );
}
