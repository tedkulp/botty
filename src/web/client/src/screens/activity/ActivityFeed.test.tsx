import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineModule } from '../../../../../core/modules/index.js';
import { createTestApp, type TestApp } from '../../../../server/testing.js';
import { createApi } from '../../api/client.js';
import { App } from '../../app/App.js';

// Activity feeds against the real Hono app and the real SQLite Activity store.

const collector = defineModule({
  id: 'collector',
  name: 'Collector',
  channelDefault: false,
  permissions: [],
  configSchema: {
    global: z.object({ tags: z.array(z.string()).default([]) }),
    channel: z.object({ listId: z.string().optional() }),
  },
  setup() {},
});

const ADMIN = { sub: 'sub-ada', name: 'Ada Admin' };

let t: TestApp;
let cookie: string;

beforeEach(async () => {
  t = createTestApp({ modules: [collector] });
  cookie = await t.signIn(ADMIN);
  t.guilds.addGuild({ id: 'g1', name: 'Homelab' });
  t.guilds.addGuild({ id: 'g2', name: 'Board games' });
  t.guilds.addChannel({ id: '21', guildId: 'g1', name: 'general' });
  t.guilds.addChannel({ id: '22', guildId: 'g1', name: 'links' });
  t.guilds.addChannel({ id: '31', guildId: 'g2', name: 'dice' });
});
afterEach(() => t.close());

function renderApp(path: string) {
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

const feed = () => screen.findByRole('region', { name: 'Activity' });
const items = (region: HTMLElement) => within(region).queryAllByRole('listitem');

describe('Module page Activity feed', () => {
  it('lists entries under the Global config and picks up new ones only on refresh', async () => {
    t.activity.write({ moduleId: 'collector', level: 'info', message: 'older entry' });
    const { user } = renderApp('/modules/collector');

    const region = await feed();
    expect(await within(region).findByText('older entry')).toBeTruthy();

    const toggle = within(screen.getByRole('main')).getByRole('switch', { name: 'Global switch' });
    await user.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    // No live push.
    expect(within(region).queryByText('switched on globally')).toBeNull();

    await user.click(within(region).getByRole('button', { name: 'Refresh activity' }));

    const first = (await within(region).findByText('switched on globally')).closest('li')!;
    expect(first.textContent).toContain('Ada Admin');
    expect(items(region)[0]).toBe(first);
  });

  it('filters by server and channel, showing names from the cache and raw ids otherwise', async () => {
    t.activity.write({ moduleId: 'collector', guildId: 'g1', channelId: '22', level: 'info', message: 'in links' });
    t.activity.write({ moduleId: 'collector', guildId: 'g1', channelId: '21', level: 'warn', message: 'in general' });
    t.activity.write({ moduleId: 'collector', guildId: 'g2', channelId: '31', level: 'info', message: 'in dice' });
    t.activity.write({ moduleId: 'collector', guildId: 'g9', channelId: '99', level: 'error', message: 'somewhere gone' });
    const { user } = renderApp('/modules/collector');
    const region = await feed();
    await within(region).findByText('in links');
    expect(items(region)).toHaveLength(4);
    expect(within(region).getByText('somewhere gone').closest('li')!.textContent).toContain('g9 · #99');

    await user.selectOptions(within(region).getByRole('combobox', { name: 'Server' }), 'Homelab');
    await waitFor(() => expect(items(region)).toHaveLength(2));
    expect(within(region).getByText('in links').closest('li')!.textContent).toContain('Homelab · #links');

    const channel = within(region).getByRole('combobox', { name: 'Channel' });
    await waitFor(() => expect(within(channel).getByRole('option', { name: '#links' })).toBeTruthy());
    await user.selectOptions(channel, '#links');
    await waitFor(() => expect(items(region)).toHaveLength(1));
    expect(within(region).getByText('in links')).toBeTruthy();
  });

  it('loads older entries with "load more" until there are none', async () => {
    for (let i = 1; i <= 55; i++) t.activity.write({ moduleId: 'collector', level: 'info', message: `entry ${i}` });
    const { user } = renderApp('/modules/collector');
    const region = await feed();
    await within(region).findByText('entry 55');
    expect(items(region)).toHaveLength(50);
    expect(within(region).queryByText('entry 5')).toBeNull();

    await user.click(within(region).getByRole('button', { name: 'Load more' }));

    expect(await within(region).findByText('entry 1')).toBeTruthy();
    expect(items(region)).toHaveLength(55);
    expect(within(region).queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('renders the link as a jump-link', async () => {
    const link = 'https://discord.com/channels/g1/22/m1';
    t.activity.write({ moduleId: 'collector', guildId: 'g1', channelId: '22', level: 'info', message: 'Ada: saved bm_1', link });
    renderApp('/modules/collector');
    const region = await feed();

    const jump = await within(region).findByRole('link', { name: 'jump to message' });

    expect(jump.getAttribute('href')).toBe(link);
  });
});

describe('Channel Module row "recent" expander', () => {
  it("shows the Module's latest 10 entries for that channel, refreshed on demand", async () => {
    for (let i = 1; i <= 12; i++)
      t.activity.write({ moduleId: 'collector', guildId: 'g1', channelId: '22', level: 'info', message: `links ${i}` });
    t.activity.write({ moduleId: 'collector', guildId: 'g1', channelId: '21', level: 'info', message: 'in general' });
    const { user } = renderApp('/guilds/g1/channels/22');
    const row = (await screen.findByRole('heading', { name: 'Collector' })).closest('section')!;
    expect(within(row).queryByText('links 12')).toBeNull();

    await user.click(within(row).getByRole('button', { name: 'recent' }));

    const recent = await within(row).findByRole('region', { name: 'Recent Collector activity' });
    await within(recent).findByText('links 12');
    expect(items(recent)).toHaveLength(10);
    expect(within(recent).queryByText('in general')).toBeNull();
    expect(within(recent).queryByText('links 2')).toBeNull();

    const toggle = within(row).getByRole('switch', { name: 'Collector in #links' });
    await user.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(within(recent).queryByText('switched on in channel')).toBeNull();

    await user.click(within(recent).getByRole('button', { name: 'Refresh recent activity' }));

    const first = (await within(recent).findByText('switched on in channel')).closest('li')!;
    expect(first.textContent).toContain('Ada Admin');
  });
});
