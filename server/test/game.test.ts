import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { GameService } from '../src/domain/game.ts';
import { answerFor, freshDb } from './helpers.ts';

describe('GameService', () => {
  let game: GameService;
  let sessionId: number;
  let roomCode: string;
  let alice: number;
  let bob: number;

  beforeEach(async () => {
    game = new GameService(await freshDb());
    const s = await game.createSession();
    sessionId = s.id;
    roomCode = s.room_code;
    alice = (await game.joinPlayer(roomCode, 'Аліса', 'Коваль')).id;
    bob = (await game.joinPlayer(roomCode, 'Богдан', 'Шевчук')).id;
  });

  /** Plays a region with a fixed sequence of right/wrong answers. */
  async function play(playerId: number, regionId: string, pattern: boolean[], now?: number) {
    let q = await game.openRegion(playerId, regionId, now);
    const results = [];
    for (const correct of pattern) {
      const r = await game.answer(playerId, regionId, q.id, await answerFor(game.questions, q, correct), now);
      results.push(r);
      if (r.nextQuestion) q = r.nextQuestion;
    }
    return results;
  }

  it('has 25 regions, each with 3 seeded questions', async () => {
    assert.equal(await game.regionCount(), 25);
    assert.ok((await game.questions.countsByRegion()).every((r) => r.count === 3));
  });

  it('rejects gameplay before start and joining after start', async () => {
    await assert.rejects(game.openRegion(alice, 'lviv'), /не розпочалася/);
    await game.startSession(sessionId);
    await assert.rejects(game.joinPlayer(roomCode, 'Пізній', 'Гравець'), /вже розпочалася/);
  });

  it('re-joining with the same name (any case) returns the same player', async () => {
    assert.equal((await game.joinPlayer(roomCode, ' аліса ', 'КОВАЛЬ')).id, alice);
    assert.equal((await game.listPlayers(sessionId)).length, 2);
  });

  it('2 correct → green, third question skipped', async () => {
    await game.startSession(sessionId);
    const [first, second] = await play(alice, 'lviv', [true, true]);
    assert.equal(first!.regionStatus, 'in_progress');
    assert.equal(first!.nextQuestion?.number, 2);
    assert.equal(second!.regionStatus, 'green');
    assert.equal(second!.nextQuestion, null);
    await assert.rejects(game.openRegion(alice, 'lviv'), /уже завершено/);
  });

  it('2 wrong → red', async () => {
    await game.startSession(sessionId);
    const results = await play(alice, 'lviv', [false, false]);
    assert.equal(results.at(-1)!.regionStatus, 'red');
    assert.ok(results.at(-1)!.correctAnswer.length > 0);
  });

  it('1:1 → tie-breaker decides', async () => {
    await game.startSession(sessionId);
    const a = await play(alice, 'lviv', [true, false, true]);
    assert.equal(a[1]!.nextQuestion?.number, 3);
    assert.equal(a[2]!.regionStatus, 'green');
    const b = await play(bob, 'lviv', [false, true, false]);
    assert.equal(b[2]!.regionStatus, 'red');
  });

  it('rejects stale/duplicate answers', async () => {
    await game.startSession(sessionId);
    const q = await game.openRegion(alice, 'odesa');
    const answer = await answerFor(game.questions, q, true);
    await game.answer(alice, 'odesa', q.id, answer);
    await assert.rejects(game.answer(alice, 'odesa', q.id, answer), /неактуальне/);
  });

  it('concurrent double submit counts only once', async () => {
    await game.startSession(sessionId);
    const q = await game.openRegion(alice, 'odesa');
    const answer = await answerFor(game.questions, q, true);
    const outcomes = await Promise.allSettled([game.answer(alice, 'odesa', q.id, answer), game.answer(alice, 'odesa', q.id, answer)]);
    assert.deepEqual(outcomes.map((o) => o.status).sort(), ['fulfilled', 'rejected']);
    assert.equal((await game.progress(sessionId))[0]!.correctAnswers, 1);
  });

  it('re-opening an unfinished region resumes the same question', async () => {
    await game.startSession(sessionId);
    const q1 = await game.openRegion(alice, 'kyiv');
    assert.equal((await game.openRegion(alice, 'kyiv')).id, q1.id);
  });

  it('marks players finished, detects all-finished, and ranks results', async () => {
    const t0 = 1_000_000;
    await game.startSession(sessionId, t0);
    const regions = await game.regions();

    for (const [i, r] of regions.entries()) {
      const q = await game.openRegion(alice, r.id, t0);
      const r1 = await game.answer(alice, r.id, q.id, await answerFor(game.questions, q, true), t0);
      const next = r1.nextQuestion!;
      const r2 = await game.answer(alice, r.id, next.id, await answerFor(game.questions, next, true), t0 + 60_000);
      assert.equal(r2.playerFinished, i === regions.length - 1);
    }
    assert.equal(await game.allPlayersFinished(sessionId), false);

    for (const r of regions) await play(bob, r.id, [false, false], t0);
    assert.equal(await game.allPlayersFinished(sessionId), true);

    const { results, ended } = await game.endSession(sessionId, t0 + 120_000);
    assert.equal(ended, true);
    assert.equal(results[0]!.firstName, 'Аліса');
    assert.equal(results[0]!.correctAnswers, 50);
    assert.equal(results[0]!.greenRegions, 25);
    assert.equal(results[0]!.timeMs, 60_000);
    assert.equal(results[1]!.redRegions, 25);
    assert.equal((await game.getSessionById(sessionId)).status, 'finished');
    assert.equal((await game.endSession(sessionId)).ended, false, 'second end is a no-op');
  });

  it('force end: unfinished players get time until the end', async () => {
    const t0 = 5_000;
    await game.startSession(sessionId, t0);
    const { results } = await game.endSession(sessionId, t0 + 90_000);
    assert.ok(results.every((r) => r.timeMs === 90_000 && !r.finished));
    await assert.rejects(game.openRegion(alice, 'lviv'), /завершено/);
  });

  it('refuses to start when a region lacks questions', async () => {
    const [q] = await game.questions.list('crimea');
    await game.questions.delete(q!.id);
    await assert.rejects(game.startSession(sessionId), /Автономна Республіка Крим/);
  });
});
