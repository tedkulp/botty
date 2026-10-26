import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  fieldsFromSchema,
  secretIsSet,
  toDraft,
  toPayload,
  type Draft,
  type DraftValue,
  type FieldError,
  type FieldSpec,
  type JsonSchema,
} from './fields.js';
import { TagInput } from './TagInput.js';

export type { FieldError, JsonSchema } from './fields.js';

/** What `onSave` reports back. On success the parent passes the saved config back in as `value`. */
export type SaveResult = { ok: true } | { ok: false; fieldErrors: FieldError[] };

export interface SchemaFormProps {
  /** JSON Schema of a config object (`z.toJSONSchema`, input side). */
  schema: JsonSchema;
  /** The stored config as the API returns it: secrets redacted to `{ set }`. */
  value: Record<string, unknown>;
  /** Called with the payload on Save. Blank secrets are omitted (unchanged). */
  onSave(payload: Record<string, unknown>): Promise<SaveResult>;
  /** Shown under the buttons, e.g. "Last edited by". */
  footer?: ReactNode;
}

/**
 * The generated config form used for every Module's Global and Channel config.
 * Edits stay local until Save; Discard returns to `value`.
 */
export function SchemaForm({ schema, value, onSave, footer }: SchemaFormProps) {
  const fields = useMemo(() => fieldsFromSchema(schema), [schema]);
  const valueKey = JSON.stringify(value);
  const initial = useMemo(() => toDraft(fields, value), [fields, valueKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [saving, setSaving] = useState(false);
  const formId = useId();

  // A new stored value (after Save or a refresh) replaces the draft.
  useEffect(() => {
    setDraft(initial);
    setErrors([]);
  }, [initial]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const keys = new Set(fields.map((f) => f.key));
  const errorsFor = (key: string) => errors.filter((e) => e.path[0] === key).map((e) => e.message);
  const formErrors = errors.filter((e) => !keys.has(String(e.path[0] ?? '')));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const result = await onSave(toPayload(fields, draft));
      if (result.ok) {
        setErrors([]);
        // Secrets go back to blank; the parent's new `value` resets the rest.
        setDraft((d) => ({ ...d, ...Object.fromEntries(fields.filter((f) => f.kind === 'secret').map((f) => [f.key, ''])) }));
      } else {
        setErrors(result.fieldErrors);
      }
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraft(initial);
    setErrors([]);
  }

  const set = (key: string) => (next: DraftValue) => setDraft((d) => ({ ...d, [key]: next }));

  return (
    <form className="schema-form" onSubmit={submit} noValidate>
      {fields.length === 0 && <p className="muted small">Nothing to configure.</p>}
      {fields.map((field) => (
        <Field
          key={field.key}
          id={`${formId}-${field.key}`}
          field={field}
          draft={draft[field.key]!}
          stored={value[field.key]}
          errors={errorsFor(field.key)}
          onChange={set(field.key)}
        />
      ))}
      {formErrors.length > 0 && (
        <div role="alert" className="form-errors">
          {formErrors.map((e, i) => (
            <div key={i}>
              {e.path.length ? `${e.path.join('.')}: ` : ''}
              {e.message}
            </div>
          ))}
        </div>
      )}
      <div className="row form-actions">
        <button type="submit" className="btn primary" disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn" disabled={!dirty || saving} onClick={discard}>
          Discard
        </button>
      </div>
      {footer}
    </form>
  );
}

interface FieldProps {
  id: string;
  field: FieldSpec;
  draft: DraftValue;
  stored: unknown;
  errors: string[];
  onChange(next: DraftValue): void;
}

function Field({ id, field, draft, stored, errors, onChange }: FieldProps) {
  const helpId = `${id}-help`;
  const label = (
    <label htmlFor={id}>
      {field.label}
      {!field.required && <span className="optional"> optional</span>}
    </label>
  );

  if (field.kind === 'unsupported') {
    return (
      <div className="field">
        <div className="label">{field.label}</div>
        <p className="muted small">This field is not editable here; its stored value is kept.</p>
      </div>
    );
  }

  let control: ReactNode;
  switch (field.kind) {
    case 'boolean':
      control = (
        <input
          id={id}
          type="checkbox"
          className="switch"
          checked={draft as boolean}
          aria-describedby={helpId}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
      break;
    case 'tags':
      control = <TagInput id={id} value={draft as string[]} onChange={onChange} describedBy={helpId} />;
      break;
    case 'secret': {
      const isSet = secretIsSet(stored);
      control = (
        <div className="row">
          <input
            id={id}
            type="password"
            autoComplete="new-password"
            value={draft as string}
            placeholder={isSet ? 'Leave blank to keep' : ''}
            aria-describedby={helpId}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className={`pill ${isSet ? 'pill-ok' : 'pill-muted'}`}>{isSet ? 'set' : 'not set'}</span>
        </div>
      );
      break;
    }
    case 'number':
      control = (
        <input
          id={id}
          type="number"
          step={field.integer ? 1 : 'any'}
          value={draft as string}
          aria-describedby={helpId}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'string':
      control = (
        <input
          id={id}
          type={field.format === 'uri' ? 'url' : 'text'}
          value={draft as string}
          aria-describedby={helpId}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
  }

  return (
    <div className={`field${errors.length ? ' has-error' : ''}`}>
      {label}
      {control}
      <div id={helpId}>
        {field.description && <div className="muted small">{field.description}</div>}
        {errors.map((message, i) => (
          <div key={i} className="field-error small">
            {message}
          </div>
        ))}
      </div>
    </div>
  );
}
