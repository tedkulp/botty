import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { configJsonSchema, moduleJsonSchemas, redactSecrets } from '../../../../core/modules/index.js';
import { modules } from '../../../../modules/index.js';
import { SchemaForm, type SaveResult } from './SchemaForm.js';

/** Every kind the renderer supports, built the way a Module would declare it. */
const kitchenSink = z.object({
  karakeepUrl: z.url().optional().meta({ title: 'Karakeep URL', description: 'Base URL of your instance.' }),
  apiKey: z.string().optional().meta({ secret: true }),
  defaultTags: z.array(z.string()).default([]),
  maxLinks: z.number().int().default(20),
  dryRun: z.boolean().default(false),
  listId: z.string().optional(),
  name: z.string(),
});

function renderForm(
  value: Record<string, unknown>,
  onSave: (values: Record<string, unknown>) => Promise<SaveResult> = async () => ({ ok: true }),
  schema: z.ZodObject = kitchenSink,
) {
  const user = userEvent.setup();
  render(<SchemaForm schema={configJsonSchema(schema)} value={redactSecrets(schema, value)} onSave={onSave} />);
  return { user };
}

const stored = {
  karakeepUrl: 'https://karakeep.test',
  apiKey: 'kk_secret',
  defaultTags: ['discord'],
  maxLinks: 20,
  dryRun: false,
  name: 'botty',
};

describe('SchemaForm', () => {
  it('renders an input for each field kind', () => {
    renderForm(stored);

    expect(screen.getByRole('textbox', { name: /Karakeep URL/ })).toHaveProperty('value', 'https://karakeep.test');
    expect(screen.getByText('Base URL of your instance.')).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: /Max links/ })).toHaveProperty('value', '20');
    expect(screen.getByRole('checkbox', { name: /Dry run/ })).toHaveProperty('checked', false);
    expect(screen.getByText('discord')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Default tags/ })).toBeTruthy();
  });

  it('marks optional fields and not required ones', () => {
    renderForm(stored);

    expect(screen.getByRole('textbox', { name: /List id/ }).closest('.field')?.textContent).toContain('optional');
    expect(screen.getByRole('textbox', { name: /^Name/ }).closest('.field')?.textContent).not.toContain('optional');
  });

  it('renders a secret masked and write-only, saying whether it is set', () => {
    renderForm(stored);

    const input = screen.getByLabelText(/Api key/) as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.value).toBe('');
    expect(input.closest('.field')?.textContent).toContain('set');
    expect(input.closest('.field')?.textContent).not.toContain('not set');
    expect(document.body.textContent).not.toContain('kk_secret');
  });

  it('says "not set" for an empty secret', () => {
    renderForm({ ...stored, apiKey: undefined });

    expect(screen.getByLabelText(/Api key/).closest('.field')?.textContent).toContain('not set');
  });

  it('saves only on Save, sending typed values and leaving an untouched secret blank', async () => {
    const onSave = vi.fn(async () => ({ ok: true }) as const);
    const { user } = renderForm(stored, onSave);

    const tags = screen.getByRole('textbox', { name: /Default tags/ });
    await user.type(tags, 'homelab{Enter}');
    await user.clear(screen.getByRole('spinbutton', { name: /Max links/ }));
    await user.type(screen.getByRole('spinbutton', { name: /Max links/ }), '5');
    await user.click(screen.getByRole('checkbox', { name: /Dry run/ }));
    expect(onSave).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const sent = (onSave.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(sent).toEqual({
      karakeepUrl: 'https://karakeep.test',
      defaultTags: ['discord', 'homelab'],
      maxLinks: 5,
      dryRun: true,
      name: 'botty',
    });
  });

  it('sends a newly typed secret, and omits a cleared optional field', async () => {
    const onSave = vi.fn(async () => ({ ok: true }) as const);
    const { user } = renderForm(stored, onSave);

    await user.type(screen.getByLabelText(/Api key/), 'kk_new');
    await user.clear(screen.getByRole('textbox', { name: /Karakeep URL/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const sent = (onSave.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(sent.apiKey).toBe('kk_new');
    expect('karakeepUrl' in sent).toBe(false);
  });

  it('removes a tag', async () => {
    const onSave = vi.fn(async () => ({ ok: true }) as const);
    const { user } = renderForm(stored, onSave);

    await user.click(screen.getByRole('button', { name: 'Remove discord' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect((onSave.mock.calls[0] as unknown as [Record<string, unknown>])[0].defaultTags).toEqual([]);
  });

  it('enables Save and Discard only when edited, and Discard restores the saved values', async () => {
    const { user } = renderForm(stored);
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    const discard = screen.getByRole('button', { name: 'Discard' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(discard.disabled).toBe(true);

    const name = screen.getByRole('textbox', { name: /^Name/ });
    await user.type(name, '-2');
    expect(save.disabled).toBe(false);
    await user.click(discard);

    expect(name).toHaveProperty('value', 'botty');
    expect(save.disabled).toBe(true);
  });

  it('shows field errors from a rejected save next to their fields', async () => {
    const onSave = vi.fn(
      async (): Promise<SaveResult> => ({
        ok: false,
        fieldErrors: [
          { path: ['karakeepUrl'], message: 'Invalid URL' },
          { path: [], message: 'Something about the whole config' },
        ],
      }),
    );
    const { user } = renderForm(stored, onSave);

    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'x');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /Karakeep URL/ }).closest('.field')?.textContent).toContain(
        'Invalid URL',
      ),
    );
    expect(screen.getByRole('alert').textContent).toContain('Something about the whole config');
  });

  it('renders an unsupported field as a note instead of throwing', () => {
    const odd = z.object({ nested: z.object({ a: z.string() }).optional(), ok: z.string().optional() });

    renderForm({}, undefined, odd);

    expect(screen.getByText(/not editable here/)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Ok/ })).toBeTruthy();
  });
});

// Module merge bar: every registered Module's forms render from its schemas.
describe('forms for every registered Module', () => {
  it('has a registry to check', () => {
    expect(Array.isArray(modules)).toBe(true);
  });

  for (const module of modules) {
    const schemas = moduleJsonSchemas(module);
    for (const scope of ['global', 'channel'] as const) {
      it(`${module.id}: ${scope} config form renders`, () => {
        const parsed = module.configSchema[scope].safeParse({});
        const defaults = (parsed.success ? parsed.data : {}) as Record<string, unknown>;
        const value = redactSecrets(module.configSchema[scope], defaults);

        expect(() =>
          render(<SchemaForm schema={schemas[scope]} value={value} onSave={async () => ({ ok: true })} />),
        ).not.toThrow();
        expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
        // A new Module needs no UI code: every field must be one the renderer can edit.
        expect(screen.queryByText(/not editable here/)).toBeNull();
      });
    }
  }
});
