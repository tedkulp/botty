import { useState } from 'react';
import type { ChannelModule } from '../../api/client.js';
import { useDashboard } from '../../app/dashboard.js';
import { SchemaForm, type SaveResult } from '../../forms/SchemaForm.js';
import { LastEdited, Switch } from '../../ui/status.js';

export interface ChannelModuleRowProps {
  channelId: string;
  channelName: string;
  module: ChannelModule;
  /** Called with the row the server returned after a switch or save. */
  onChanged(module: ChannelModule): void;
}

/** "enabled", "switched off globally" or "off": the channel switch stays editable in every case. */
function EnablementPill({ module }: { module: ChannelModule }) {
  if (module.enabled) return <span className="pill pill-ok">enabled</span>;
  if (!module.globalEnabled) return <span className="pill pill-muted">switched off globally</span>;
  return <span className="pill pill-muted">off here</span>;
}

/**
 * One Module in a channel pane: its channel switch, an enablement pill, a
 * missing-permissions warning and a "configure" expander with the Channel
 * config form.
 */
export function ChannelModuleRow({ channelId, channelName, module, onChanged }: ChannelModuleRowProps) {
  const { api } = useDashboard();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const hasConfig = Object.keys((module.schema.properties as object | undefined) ?? {}).length > 0;

  async function toggle(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.setChannelEnabled(channelId, module.id, on));
    } catch {
      setError('The switch did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function save(payload: Record<string, unknown>): Promise<SaveResult> {
    const result = await api.saveChannelConfig(channelId, module.id, payload);
    if (!result.ok) return result;
    onChanged(result.module);
    return { ok: true };
  }

  return (
    <section className="module-row" aria-labelledby={`module-${module.id}`}>
      <div className="row">
        <h3 id={`module-${module.id}`} className="grow">
          {module.name}
        </h3>
        <EnablementPill module={module} />
        {module.needsReview && (
          <span className="pill pill-warn" title="A stored value was invalid and fell back to its default. Review and save.">
            needs review
          </span>
        )}
        <Switch label={`${module.name} in #${channelName}`} on={module.channelEnabled} busy={busy} onToggle={toggle} />
      </div>
      {error && <div className="field-error small">{error}</div>}
      {module.missingPermissions.length > 0 && (
        <div className="warning small" role="alert">
          ⚠️ The bot is missing permissions here: {module.missingPermissions.join(', ')}
        </div>
      )}
      {module.lastError && (
        <div className="small muted">
          Last error here: {module.lastError.message} · {new Date(module.lastError.at).toLocaleString()}
        </div>
      )}
      <div className="row small expanders">
        {hasConfig ? (
          <button type="button" className="link" aria-expanded={configuring} onClick={() => setConfiguring((v) => !v)}>
            configure
          </button>
        ) : (
          <span className="muted">No Channel config</span>
        )}
        {/* #22: the "recent" Activity expander goes here, next to "configure" (it has module.id and channelId). */}
      </div>
      {configuring && (
        <div className="expander-body">
          <SchemaForm
            schema={module.schema}
            value={module.config}
            onSave={save}
            footer={<LastEdited by={module.updatedBy} at={module.updatedAt} />}
          />
        </div>
      )}
    </section>
  );
}
