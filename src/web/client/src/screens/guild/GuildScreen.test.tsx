import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { DiscordState } from '../../../../../core/discord.js';
import { defineModule } from '../../../../../core/modules/index.js';
import { createTestApp, grants, type TestApp } from '../../../../server/testing.js';
import { createApi } from '../../api/client.js';
import { App } from '../../app/App.js';

// The guild and channel screens against the real Hono app, with a fake
// guild/channel cache standing in for discord.js.

const collector = defineModule({
  id: 'collector',
  name: 'Collector',
  channelDefault: false,
  permissions: ['ViewChannel', 'ReadMessageHistory', 'AddReactions'],
  configSchema: {
    global: z.object({}),
    channel: z.object({ tags: z.array(z.string()).default([]), listId: z.string().optional() }),
  },
  setup() {},
});
const echo = defineModule({
  id: 'echo',
  name: 'Echo',
  channelDefault: true,
  permissions: ['ViewChannel', 'SendMessages'],
  configSchema: { global: z.object({}), channel: z.object({}) },
  setup() {},
});

const ADMIN = { sub: 'sub-ada', name: 'Ada Admin' };

let t: TestApp;
let discordState: DiscordState;
let cookie: string;

beforeEach(async () => {
  discordState = 'ready';
  window.history.replaceState(null, '', '/');
  t = createTestApp({ modules: [collector, echo], discord: { state: () => discordState } });
  cookie = await t.signIn(ADMIN);
  const g = t.guilds;
  g.addGuild({ id: 'g1', name: 'Homelab', icon: 'https://cdn.test/g1.png' });
  g.addGuild({ id: 'g2', name: 'Board games' });
  g.addChannel({ id: '20', guildId: 'g1', name: 'Text', kind: 'category', position: 1 });
  g.addChannel({ id: '21', guildId: 'g1', name: 'general', parentId: '20', position: 0 });
  g.addChannel({ id: '22', guildId: 'g1', name: 'links', parentId: '20', position: 1 });
  g.addChannel({ id: '40', guildId: 'g1', name: 'rust stuff', kind: 'thread', parentId: '22' });
  g.addChannel({ id: '23', guildId: 'g1', name: '___hidden___', parentId: '20', position: 2, obfuscated: true });
  g.addChannel({ id: '24', guildId: 'g1', name: 'quiet', parentId: '20', position: 3, permissions: grants('ViewChannel') });
});
afterEach(() => t.close());

function renderApp(path = '/') {
  window.history.replaceState(null, '', path);
  const api = createApi({
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost');
      const headers = new Headers(init?.headers);
      headers.set('Cookie', cookie);
      return Promise.resolve(t.app.request(url.pathname + url.search, { ...init, headers }));
    },
    onUnauthorized: () => {},
  });
  const user = userEvent.setup();
  render(<App api={api} />);
  return { user };
}

const tree = () => screen.findByRole('navigation', { name: 'Homelab' });

describe('server rail', () => {
  it('shows a button per guild; selecting one opens its overview', async () => {
    await t.runtime.setModuleGlobalEnabled('collector', true, ADMIN);
    t.runtime.setModuleChannelEnabled('collector', { channelId: '22', guildId: 'g1' }, true, ADMIN);
    const { user } = renderApp();

    const rail = await screen.findByRole('navigation', { name: 'Servers' });
    const homelab = await within(rail).findByRole('button', { name: 'Homelab' });
    expect(within(rail).getByRole('button', { name: 'Board games' })).toBeTruthy();
    expect(homelab.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/g1.png');

    await user.click(homelab);

    expect(window.location.pathname).toBe('/guilds/g1');
    const pane = screen.getByRole('main');
    expect(await within(pane).findByText('Collector: enabled in 1 channel')).toBeTruthy();
    expect(within(pane).getByText('Echo: enabled in 0 channels')).toBeTruthy();
  });
});

describe('channel tree', () => {
  it('groups channels by category with an icon per Enabled Module, threads as "follows parent" and locked channels', async () => {
    await t.runtime.setModuleGlobalEnabled('echo', true, ADMIN);
    t.runtime.setModuleChannelEnabled('echo', { channelId: '21', guildId: 'g1' }, false, ADMIN);
    renderApp('/guilds/g1');

    const nav = await tree();
    expect(await within(nav).findByText('Text')).toBeTruthy();
    const links = await within(nav).findByRole('link', { name: /links/ });
    expect(within(links).getByTitle('Echo')).toBeTruthy();
    const general = within(nav).getByRole('link', { name: /general/ });
    expect(within(general).queryByTitle('Echo')).toBeNull();

    const thread = within(nav).getByText(/rust stuff/).closest('li')!;
    expect(thread.textContent).toMatch(/follows parent/);
    expect(within(thread).queryByRole('link')).toBeNull();

    const locked = within(nav).getByText(/hidden channel/).closest('li')!;
    expect(within(locked).queryByRole('link')).toBeNull();
    expect(locked.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('channel pane', () => {
  it('keeps a channel switch flipped while the Module is off globally, with a "switched off globally" pill', async () => {
    const { user } = renderApp('/guilds/g1');

    await user.click(await within(await tree()).findByRole('link', { name: /links/ }));

    expect(window.location.pathname).toBe('/guilds/g1/channels/22');
    const row = (await screen.findByRole('heading', { name: 'Collector' })).closest('section')!;
    const toggle = within(row).getByRole('switch', { name: 'Collector in #links' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(within(row).getByText('switched off globally')).toBeTruthy();

    await user.click(toggle);

    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(within(row).getByText('switched off globally')).toBeTruthy();
    // Persisted: a fresh read agrees.
    const res = await t.app.request('/api/channels/22/modules', { headers: { Cookie: cookie } });
    const body = (await res.json()) as { modules: Array<{ id: string; channelEnabled: boolean }> };
    expect(body.modules.find((m) => m.id === 'collector')?.channelEnabled).toBe(true);
  });

  it('shows "enabled" when both switches are on', async () => {
    await t.runtime.setModuleGlobalEnabled('echo', true, ADMIN);
    renderApp('/guilds/g1/channels/22');

    const row = (await screen.findByRole('heading', { name: 'Echo' })).closest('section')!;
    expect(within(row).getByText('enabled')).toBeTruthy();
  });

  it('warns about missing permissions', async () => {
    renderApp('/guilds/g1/channels/24');

    const row = (await screen.findByRole('heading', { name: 'Collector' })).closest('section')!;
    expect(within(row).getByRole('alert').textContent).toMatch(/ReadMessageHistory, AddReactions/);
  });

  it('configures Channel config behind a "configure" expander and shows who edited it', async () => {
    const { user } = renderApp('/guilds/g1/channels/22');
    const row = (await screen.findByRole('heading', { name: 'Collector' })).closest('section')!;
    expect(within(row).queryByRole('button', { name: 'Save' })).toBeNull();

    await user.click(within(row).getByRole('button', { name: 'configure' }));
    await user.type(within(row).getByRole('textbox', { name: /List id/ }), 'list-7');
    await user.click(within(row).getByRole('button', { name: 'Save' }));

    expect(await within(row).findByText(/Last edited by Ada Admin/)).toBeTruthy();
    expect(t.activity.listActivity({ moduleId: 'collector' })[0]).toMatchObject({ moduleId: 'collector', channelId: '22', message: 'Channel config edited' });
  });
});

describe('orphans', () => {
  it('shows rows for vanished channels as "unavailable" with a delete button', async () => {
    t.runtime.setModuleChannelEnabled('collector', { channelId: '77', guildId: 'g1' }, true, ADMIN);
    const { user } = renderApp('/guilds/g1');

    const pane = await screen.findByRole('main');
    const orphan = (await within(pane).findByText(/unavailable channel 77/)).closest('li')!;
    expect(orphan.textContent).toMatch(/Collector/);

    await user.click(within(orphan).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(within(pane).queryByText(/unavailable channel 77/)).toBeNull());
    const res = await t.app.request('/api/orphans', { headers: { Cookie: cookie } });
    expect(((await res.json()) as { orphans: unknown[] }).orphans).toEqual([]);
  });

  it('shows a vanished guild in the rail, whose pane lists its orphans', async () => {
    t.runtime.updateChannelConfig('echo', { channelId: '88', guildId: 'g9' }, {}, ADMIN);
    const { user } = renderApp();

    const rail = await screen.findByRole('navigation', { name: 'Servers' });
    await user.click(await within(rail).findByRole('button', { name: 'Unavailable server g9' }));

    const pane = await screen.findByRole('main');
    expect(await within(pane).findByText(/unavailable channel 88/)).toBeTruthy();
  });
});

describe('Discord down', () => {
  it('disables server icons and replaces the channel tree with "unavailable"; ⚙️ Modules keeps working', async () => {
    const { user } = renderApp('/guilds/g1');
    const rail = await screen.findByRole('navigation', { name: 'Servers' });
    await within(rail).findByRole('button', { name: 'Homelab' });

    discordState = 'down';
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(within(rail).getByRole('button', { name: 'Homelab' })).toHaveProperty('disabled', true));
    expect(await within(await tree()).findByText(/Channels are unavailable/)).toBeTruthy();

    await user.click(within(rail).getByRole('button', { name: 'Modules' }));
    expect(await screen.findByRole('heading', { name: 'Collector' })).toBeTruthy();
  });
});
