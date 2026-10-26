import { useState } from 'react';
import type { ChannelModule } from '../../api/client.js';
import { useDashboard } from '../../app/dashboard.js';
import { SchemaForm, type SaveResult } from '../../forms/SchemaForm.js';
import { useSwitchRequest } from '../../lib/useSwitchRequest.js';
import { LastEdited, LastErrorLine, NeedsReviewPill, Switch } from '../../ui/status.js';
import { RecentActivity } from '../activity/RecentActivity.js';

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
 * missing-permissions warning, a "configure" expander with the Channel
 * config form and a "recent" expander with the Module's latest Activity here.
 */
export function ChannelModuleRow({ channelId, channelName, module, onChanged }: ChannelModuleRowProps) {
  const { api } = useDashboard();
  const { busy, error, toggle } = useSwitchRequest(async (on) =>
    onChanged(await api.setChannelEnabled(channelId, module.id, on)),
  );
  const [configuring, setConfiguring] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const hasConfig = Object.keys((module.schema.properties as object | undefined) ?? {}).length > 0;

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
        {module.needsReview && <NeedsReviewPill />}
        <Switch label={`${module.name} in #${channelName}`} on={module.channelEnabled} busy={busy} onToggle={toggle} />
      </div>
      {error && <div className="field-error small">{error}</div>}
      {module.missingPermissions.length > 0 && (
        <div className="warning small" role="alert">
          ⚠️ The bot is missing permissions here: {module.missingPermissions.join(', ')}
        </div>
      )}
      <LastErrorLine label="Last error here" error={module.lastError} />
      <div className="row small expanders">
        {hasConfig ? (
          <button type="button" className="link" aria-expanded={configuring} onClick={() => setConfiguring((v) => !v)}>
            configure
          </button>
        ) : (
          <span className="muted">No Channel config</span>
        )}
        <button type="button" className="link" aria-expanded={showRecent} onClick={() => setShowRecent((v) => !v)}>
          recent
        </button>
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
      {showRecent && <RecentActivity moduleId={module.id} moduleName={module.name} channelId={channelId} />}
    </section>
  );
}
