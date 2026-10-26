import { EventEmitter } from 'node:events';
import { Events } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { trackConnectionState } from './discord.js';

describe('trackConnectionState', () => {
  it('starts down until the client is ready', () => {
    const client = new EventEmitter();
    const status = trackConnectionState(client);

    expect(status.state()).toBe('down');
    client.emit(Events.ClientReady, client);
    expect(status.state()).toBe('ready');
  });

  it('goes down on disconnect and back to ready on reconnect', () => {
    const client = new EventEmitter();
    const status = trackConnectionState(client);
    client.emit(Events.ClientReady, client);

    client.emit(Events.ShardDisconnect, {}, 0);
    expect(status.state()).toBe('down');

    client.emit(Events.ShardReady, 0);
    expect(status.state()).toBe('ready');

    client.emit(Events.ShardReconnecting, 0);
    expect(status.state()).toBe('down');

    client.emit(Events.ShardResume, 0, 3);
    expect(status.state()).toBe('ready');
  });

  it('goes down when the session is invalidated', () => {
    const client = new EventEmitter();
    const status = trackConnectionState(client);
    client.emit(Events.ClientReady, client);

    client.emit(Events.Invalidated);
    expect(status.state()).toBe('down');
  });
});
