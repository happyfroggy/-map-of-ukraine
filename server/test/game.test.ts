import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { PublicQuestion } from '../../shared/types.ts';
import { GameService } from '../src/domain/game.ts';
import { answerFor, freshDb } from './helpers.ts';

describe('GameService (drones)', () => {
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

  /** Answers the region's drones following a right/wrong pattern; returns every result and question asked. */
  async function play(playerId: number, regionId: string, pattern: boolean[], now?: number) {
    let q: PublicQuestion = await game.openRegion(playerId, regionId, now);
    const results = [];
    const asked = [q];
    for (const correct of pattern) {
      const r = await game.answer(playerId, regionId, q.id, await answerFor(game.questions, q, correct), now);
      results.push(r);
      if (!r.nextQuestion) break;
      q = r.nextQuestion;
      asked.push(q);
    }
    return { results, asked };
  }

  const progressOf = async (id: number) => (await game.progress(sessionId)).find((p) => p.id === id)!;

  it('has 25 regions, each with 4 seeded questions', async () => {
    assert.equal(await game.regionCount(), 25);
    assert.ok((await game.questions.countsByRegion()).every((r) => r.count === 4));
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

  it('each correct answer shoots down a drone; 3 down → region cleared', async () => {
    await game.startSession(sessionId);
    const first = await game.openRegion(alice, 'lviv');
    assert.equal(first.dronesLeft, 3);
    assert.equal(first.dronesTotal, 3);
    const { results, asked } = await play(alice, 'lviv', [true, true, true]);
    assert.deepEqual(results.map((r) => r.dronesLeft), [2, 1, 0]);
    assert.deepEqual(results.map((r) => r.regionCleared), [false, false, true]);
    assert.equal(results[2]!.nextQuestion, null);
    assert.equal(new Set(asked.map((q) => q.id)).size, 3, 'a different question for each drone');
    await assert.rejects(game.openRegion(alice, 'lviv'), /збито всі дрони/);
    const p = await progressOf(alice);
    assert.deepEqual([p.correctAnswers, p.greenRegions, p.mistakes], [3, 1, 0]);
  });

  it('a wrong answer keeps the drone and brings a different question', async () => {
    await game.startSession(sessionId);
    const { results, asked } = await play(alice, 'odesa', [false]);
    assert.equal(results[0]!.correct, false);
    assert.equal(results[0]!.dronesLeft, 3);
    assert.ok(results[0]!.correctAnswer.length > 0);
    assert.notEqual(results[0]!.nextQuestion!.id, asked[0]!.id);
    assert.equal((await progressOf(alice)).mistakes, 1);
  });

  it('many mistakes never crash, never re-ask a question answered correctly, and the region can still be cleared', async () => {
    await game.startSession(sessionId);
    const pattern = [true, false, false, false, false, false, false, true, false, true];
    const { asked, results } = await play(alice, 'kyiv', pattern);
    assert.equal(results.length, pattern.length);
    const correctOnes = new Set<number>();
    asked.forEach((q, i) => {
      assert.ok(!correctOnes.has(q.id), 'a question answered correctly was asked again');
      if (pattern[i]) correctOnes.add(q.id);
    });
    const p = await progressOf(alice);
    assert.deepEqual([p.correctAnswers, p.greenRegions, p.mistakes], [3, 1, 7]);
    const regionIds = new Set((await game.questions.list('kyiv')).map((x) => x.id));
    assert.ok(asked.every((q) => regionIds.has(q.id)), 'only questions of this region');
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
    assert.equal((await progressOf(alice)).correctAnswers, 1);
  });

  it('re-opening a region resumes the same question with the same option order', async () => {
    await game.startSession(sessionId);
    const first = await game.openRegion(alice, 'kyiv');
    const again = await game.openRegion(alice, 'kyiv');
    assert.equal(again.id, first.id);
    assert.deepEqual(again.options, first.options);
  });

  it('finishes a player when all regions are cleared; ranks by drones, then mistakes, then time', async () => {
    const t0 = 1_000_000;
    await game.startSession(sessionId, t0);
    const regions = await game.regions();

    // Alice: no mistakes, but slower. Bob: one mistake per region, faster.
    for (const [i, r] of regions.entries()) {
      const last = i === regions.length - 1;
      const { results } = await play(alice, r.id, [true, true, true], last ? t0 + 300_000 : t0);
      assert.equal(results.at(-1)!.playerFinished, last);
    }
    assert.equal(await game.allPlayersFinished(sessionId), false);
    for (const r of regions) await play(bob, r.id, [false, true, true, true], t0 + 100_000);
    assert.equal(await game.allPlayersFinished(sessionId), true);

    const { results, ended } = await game.endSession(sessionId, t0 + 400_000);
    assert.equal(ended, true);
    assert.deepEqual(results.map((r) => [r.firstName, r.rank, r.correctAnswers, r.mistakes]), [
      ['Аліса', 1, 75, 0],
      ['Богдан', 2, 75, 25],
    ]);
    assert.equal(results[0]!.timeMs, 300_000);
    assert.equal(results[1]!.timeMs, 100_000);
    assert.equal((await game.endSession(sessionId)).ended, false, 'second end is a no-op');
  });

  it('force end: unfinished players get time until the end, ranked by drones shot', async () => {
    const t0 = 5_000;
    await game.startSession(sessionId, t0);
    await play(bob, 'lviv', [true, true]);
    const { results } = await game.endSession(sessionId, t0 + 90_000);
    assert.equal(results[0]!.firstName, 'Богдан');
    assert.ok(results.every((r) => r.timeMs === 90_000 && !r.finished));
    await assert.rejects(game.openRegion(alice, 'lviv'), /завершено/);
  });

  it('refuses to start when a region has fewer questions than drones', async () => {
    const [q1, q2] = await game.questions.list('crimea');
    await game.questions.delete(q1!.id);
    await game.questions.delete(q2!.id);
    await assert.rejects(game.startSession(sessionId), /Автономна Республіка Крим/);
  });
});
