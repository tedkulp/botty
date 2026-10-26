import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { DiscordState } from '../../../../core/discord.js';
import { defineModule } from '../../../../core/modules/index.js';
import { createTestApp, type TestApp } from '../../../server/testing.js';
import { createApi } from '../api/client.js';
import { App } from './App.js';

// The SPA talks to the real Hono app (stubbed OIDC, :memory: SQLite) through
// the typed RPC client; only `fetch` is swapped to call `app.request()`.

let releaseSetup: (() => void) | null = null;
let setupFails = false;

const collector = defineModule({
  id: 'collector',
  name: 'Collector',
  channelDefault: false,
  permissions: [],
  configSchema: {
    global: z.object({
      url: z.url().optional(),
      apiKey: z.string().optional().meta({ secret: true }),
    }),
    channel: z.object({}),
  },
  async setup(ctx) {
    if (releaseSetup === null) await new Promise<void>((resolve) => (releaseSetup = resolve));
    if (setupFails) throw new Error('not configured');
    if (!ctx.globalConfig().url) ctx.setStatus('degraded', 'no URL yet');
  },
});
const echo = defineModule({
  id: 'echo',
  name: 'Echo',
  channelDefault: true,
  permissions: [],
  configSchema: { global: z.object({ prefix: z.string().default('> ') }), channel: z.object({}) },
  setup() {},
});

let t: TestApp;
let discordState: DiscordState;
let cookie: string;
let redirect: ReturnType<typeof vi.fn<(url: string) => void>>;

beforeEach(() => {
  releaseSetup = null;
  setupFails = false;
  discordState = 'ready';
  cookie = '';
  redirect = vi.fn<(url: string) => void>();
  window.history.replaceState(null, '', '/');
  t = createTestApp({ modules: [collector, echo], discord: { state: () => discordState } });
});
afterEach(() => {
  releaseSetup?.();
  t.close();
});

function renderApp() {
  const api = createApi({
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost');
      const headers = new Headers(init?.headers);
      if (cookie) headers.set('Cookie', cookie);
      return Promise.resolve(t.app.request(url.pathname + url.search, { ...init, headers }));
    },
    onUnauthorized: () => redirect(`/auth/login?returnTo=${encodeURIComponent(window.location.pathname)}`),
  });
  const user = userEvent.setup();
  render(<App api={api} />);
  return { user };
}

async function signedIn() {
  cookie = await t.signIn({ sub: 'sub-ada', name: 'Ada Admin' });
}

describe('auth gate', () => {
  it('sends the browser to sign in when there is no session', async () => {
    window.history.replaceState(null, '', '/modules/echo');
    renderApp();

    await waitFor(() => expect(redirect).toHaveBeenCalledWith('/auth/login?returnTo=%2Fmodules%2Fecho'));
    expect(screen.queryByText('Modules')).toBeNull();
  });

  it('offers a logout button that posts to /auth/logout', async () => {
    await signedIn();
    renderApp();

    const button = await screen.findByRole('button', { name: 'Log out' });
    const form = button.closest('form')!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/auth/logout');
    expect(screen.getByText('Ada Admin')).toBeTruthy();
  });
});

describe('⚙️ Modules screen', () => {
  it('lists every Module with a status dot and opens the first one', async () => {
    await signedIn();
    renderApp();

    const column = await screen.findByRole('navigation', { name: 'Modules' });
    const items = await within(column).findAllByRole('link');
    expect(items.map((i) => i.textContent)).toEqual(['Collector', 'Echo']);
    expect(within(items[0]!).getByTitle('switched off')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Collector' })).toBeTruthy();
  });

  it('opens a Module from the column and reflects it in the URL', async () => {
    await signedIn();
    const { user } = renderApp();

    await user.click(await screen.findByRole('link', { name: 'Echo' }));

    expect(await screen.findByRole('heading', { name: 'Echo' })).toBeTruthy();
    expect(window.location.pathname).toBe('/modules/echo');
    expect(screen.getByRole('textbox', { name: /Prefix/ })).toHaveProperty('value', '> ');
  });

  it('shows the switch busy while setup runs, then the status setup returned', async () => {
    await signedIn();
    const { user } = renderApp();
    const toggle = await screen.findByRole('switch', { name: 'Global switch' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await user.click(toggle);

    await waitFor(() => expect(toggle.getAttribute('aria-busy')).toBe('true'));
    releaseSetup!();
    await waitFor(() => expect(toggle.getAttribute('aria-busy')).toBe('false'));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    const pane = screen.getByRole('main');
    expect(within(pane).getByText('no URL yet')).toBeTruthy();
    const column = screen.getByRole('navigation', { name: 'Modules' });
    expect(within(column).getByTitle('degraded')).toBeTruthy();
  });

  it('shows the error status and last error when setup throws', async () => {
    await signedIn();
    setupFails = true;
    releaseSetup = () => {};
    const { user } = renderApp();

    await user.click(await screen.findByRole('switch', { name: 'Global switch' }));

    const pane = screen.getByRole('main');
    expect(await within(pane).findByText(/Last error: not configured/)).toBeTruthy();
  });

  it('saves Global config, showing field errors from a rejected save and who edited it', async () => {
    await signedIn();
    const { user } = renderApp();
    const url = await screen.findByRole('textbox', { name: /Url/ });

    await user.type(url, 'not a url');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByText(/Invalid URL/i)).closest('.field')).toBe(url.closest('.field'));

    await user.clear(url);
    await user.type(url, 'https://karakeep.test');
    await user.type(screen.getByLabelText(/Api key/), 'kk_123');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Last edited by Ada Admin/)).toBeTruthy();
    expect(screen.getByLabelText(/Api key/).closest('.field')?.textContent).toContain('set');
    expect(screen.getByLabelText(/Api key/)).toHaveProperty('value', '');
  });

  it('flags a Global config that needs review', async () => {
    await signedIn();
    t.handle.sqlite
      .prepare(
        "insert into module_settings (module_id, scope, channel_id, config, updated_at) values ('collector', 'global', '', ?, ?)",
      )
      .run(JSON.stringify({ url: 42 }), Date.now());
    renderApp();

    expect(await screen.findByText(/needs review/i)).toBeTruthy();
  });
});

describe('Discord connection', () => {
  it('shows a banner when Discord is down, while Modules keep working', async () => {
    await signedIn();
    discordState = 'down';
    renderApp();

    expect((await screen.findByRole('status', { name: 'Discord connection' })).textContent).toMatch(/disconnected/i);
    expect(await screen.findByRole('heading', { name: 'Collector' })).toBeTruthy();
  });

  it('shows no banner when Discord is ready', async () => {
    await signedIn();
    renderApp();

    await screen.findByRole('heading', { name: 'Collector' });
    expect(screen.queryByRole('status', { name: 'Discord connection' })).toBeNull();
  });
});
