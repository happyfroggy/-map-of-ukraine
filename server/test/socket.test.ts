import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { AckResponse, ClientToServerEvents, ServerToClientEvents } from '../../shared/types.ts';
import { createAppServer } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { answerFor, freshDb } from './helpers.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Emits an event and resolves with the ack payload (throws on { ok: false }). */
function call<T>(socket: Client, event: keyof ClientToServerEvents, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    (socket.emit as (...args: unknown[]) => void)(event, payload, (res: AckResponse<T>) =>
      res.ok ? resolve(res.data) : reject(new Error(res.error)),
    );
  });
}
const once = <T>(socket: Client, event: keyof ServerToClientEvents) =>
  new Promise<T>((resolve) => socket.once(event, ((data: T) => resolve(data)) as never));

describe('HTTP + Socket.io end-to-end', () => {
  const config = { ...loadConfig({ ADMIN_PASSWORD: 'secret' }), port: 0 };
  let app: ReturnType<typeof createAppServer>;
  let base = '';
  const sockets: Client[] = [];
  const client = (auth: Record<string, string> = {}) => {
    const s: Client = connect(base, { auth, transports: ['websocket'], forceNew: true });
    sockets.push(s);
    return s;
  };

  before(async () => {
    app = createAppServer({ db: await freshDb(), config });
    await new Promise<void>((r) => app.server.listen(0, r));
    base = `http://localhost:${(app.server.address() as AddressInfo).port}`;
  });
  after(() => {
    sockets.forEach((s) => s.disconnect());
    app.io.close();
  });

  it('runs a full game: login → create room → join → start → answer → force end', async () => {
    // Admin login
    const bad = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'nope' }) });
    assert.equal(bad.status, 401);
    const { token } = await (await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'secret' }),
    })).json() as { token: string };

    // Protected routes
    assert.equal((await fetch(`${base}/api/admin/questions`)).status, 401);
    const auth = { authorization: `Bearer ${token}` };
    const questions = await (await fetch(`${base}/api/admin/questions`, { headers: auth })).json() as unknown[];
    assert.equal(questions.length, 75);

    // Create room with QR
    const created = await (await fetch(`${base}/api/admin/sessions`, { method: 'POST', headers: auth })).json() as {
      session: { roomCode: string }; joinUrl: string; qrCode: string;
    };
    const roomCode = created.session.roomCode;
    assert.match(created.joinUrl, new RegExp(`/join/${roomCode}$`));
    assert.match(created.qrCode, /^data:image\/png;base64,/);

    // Admin watches; player joins → lobby broadcast
    const admin = client({ adminToken: token });
    await call(admin, 'admin:watch', { roomCode });
    const player = client();
    const lobby = once<unknown[]>(admin, 'lobby:players');
    await assert.rejects(call(player, 'player:join', { roomCode, firstName: '  ', lastName: 'X' }), /ім'я/);
    const joined = await call<{ token: string }>(player, 'player:join', { roomCode: roomCode.toLowerCase(), firstName: 'Олена', lastName: 'Бондар' });
    assert.equal((await lobby).length, 1);

    // Players can't use admin events
    await assert.rejects(call(player, 'admin:start', { roomCode }), /авторизація/);

    // Start → synchronized broadcast
    const started = once<{ session: { status: string } }>(player, 'game:started');
    await call(admin, 'admin:start', { roomCode });
    assert.equal((await started).session.status, 'active');

    // Reconnect with the token on a new socket, then play a region
    const player2 = client();
    const state = await call<{ session: { status: string } }>(player2, 'player:resume', { token: joined.token });
    assert.equal(state.session.status, 'active');
    const q = await call<{ id: number; options: string[] | null }>(player2, 'region:open', { regionId: 'lviv' });
    const progress = once<{ correctAnswers: number }[]>(admin, 'admin:progress');
    const res = await call<{ correct: boolean }>(player2, 'region:answer', {
      regionId: 'lviv', questionId: q.id, answer: await answerFor(app.game.questions, q as never, true),
    });
    assert.equal(res.correct, true);
    assert.equal((await progress)[0]!.correctAnswers, 1);

    // Force end → everyone gets results
    const ended = once<{ results: { rank: number }[] }>(player2, 'game:ended');
    await call(admin, 'admin:end', { roomCode });
    assert.equal((await ended).results[0]!.rank, 1);
    const results = await (await fetch(`${base}/api/sessions/${roomCode}/results`)).json() as unknown[];
    assert.equal(results.length, 1);
  });
});
