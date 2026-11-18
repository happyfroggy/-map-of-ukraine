import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { GameService } from '../src/domain/game.ts';
import { answerFor, freshDb } from './helpers.ts';

describe('GameService', () => {
  let game: GameService;
  let sessionId: number;
  let alice: number;
  let bob: number;

  beforeEach(() => {
    game = new GameService(freshDb());
    const s = game.createSession();
    sessionId = s.id;
    alice = game.joinPlayer(s.room_code, 'Аліса', 'Коваль').id;
    bob = game.joinPlayer(s.room_code, 'Богдан', 'Шевчук').id;
  });

  /** Plays a region with a fixed sequence of right/wrong answers. */
  function play(playerId: number, regionId: string, pattern: boolean[]) {
    let q = game.openRegion(playerId, regionId);
    const results = [];
    for (const correct of pattern) {
      const r = game.answer(playerId, regionId, q.id, answerFor(game.questions, q, correct));
      results.push(r);
      if (r.nextQuestion) q = r.nextQuestion;
    }
    return results;
  }

  it('has 25 regions, each with 3 seeded questions', () => {
    assert.equal(game.regionCount(), 25);
    assert.ok(game.questions.countsByRegion().every((r) => r.count === 3));
  });

  it('rejects gameplay before start and joining after start', () => {
    assert.throws(() => game.openRegion(alice, 'lviv'), /не розпочалася/);
    game.startSession(sessionId);
    const code = game.getSessionById(sessionId).room_code;
    assert.throws(() => game.joinPlayer(code, 'Пізній', 'Гравець'), /вже розпочалася/);
  });

  it('re-joining with the same name (any case) returns the same player', () => {
    const code = game.getSessionById(sessionId).room_code;
    assert.equal(game.joinPlayer(code, ' аліса ', 'КОВАЛЬ').id, alice);
    assert.equal(game.listPlayers(sessionId).length, 2);
  });

  it('2 correct → green, third question skipped', () => {
    game.startSession(sessionId);
    const [first, second] = play(alice, 'lviv', [true, true]);
    assert.equal(first!.regionStatus, 'in_progress');
    assert.equal(first!.nextQuestion?.number, 2);
    assert.equal(second!.regionStatus, 'green');
    assert.equal(second!.nextQuestion, null);
    assert.throws(() => game.openRegion(alice, 'lviv'), /уже завершено/);
  });

  it('2 wrong → red', () => {
    game.startSession(sessionId);
    const results = play(alice, 'lviv', [false, false]);
    assert.equal(results.at(-1)!.regionStatus, 'red');
    assert.equal(results.at(-1)!.correctAnswer.length > 0, true);
  });

  it('1:1 → tie-breaker decides', () => {
    game.startSession(sessionId);
    const a = play(alice, 'lviv', [true, false, true]);
    assert.equal(a[1]!.nextQuestion?.number, 3);
    assert.equal(a[2]!.regionStatus, 'green');
    const b = play(bob, 'lviv', [false, true, false]);
    assert.equal(b[2]!.regionStatus, 'red');
  });

  it('rejects stale/duplicate answers', () => {
    game.startSession(sessionId);
    const q = game.openRegion(alice, 'odesa');
    game.answer(alice, 'odesa', q.id, answerFor(game.questions, q, true));
    assert.throws(() => game.answer(alice, 'odesa', q.id, answerFor(game.questions, q, true)), /неактуальне/);
  });

  it('re-opening an unfinished region resumes the same question', () => {
    game.startSession(sessionId);
    const q1 = game.openRegion(alice, 'kyiv');
    assert.equal(game.openRegion(alice, 'kyiv').id, q1.id);
  });

  it('marks players finished, detects all-finished, and ranks results', () => {
    const t0 = 1_000_000;
    game.startSession(sessionId, t0);
    const regions = game.regions();

    regions.forEach((r, i) => {
      const q = game.openRegion(alice, r.id, t0);
      const r1 = game.answer(alice, r.id, q.id, answerFor(game.questions, q, true), t0);
      const r2 = game.answer(alice, r.id, r1.nextQuestion!.id, answerFor(game.questions, r1.nextQuestion!, true), t0 + 60_000);
      assert.equal(r2.playerFinished, i === regions.length - 1);
    });
    assert.equal(game.allPlayersFinished(sessionId), false);

    regions.forEach((r) => play(bob, r.id, [false, false]));
    assert.equal(game.allPlayersFinished(sessionId), true);

    const results = game.endSession(sessionId, t0 + 120_000);
    assert.equal(results[0]!.firstName, 'Аліса');
    assert.equal(results[0]!.correctAnswers, 50);
    assert.equal(results[0]!.greenRegions, 25);
    assert.equal(results[0]!.timeMs, 60_000);
    assert.equal(results[1]!.redRegions, 25);
    assert.equal(game.getSessionById(sessionId).status, 'finished');
  });

  it('force end: unfinished players get time until the end', () => {
    const t0 = 5_000;
    game.startSession(sessionId, t0);
    const results = game.endSession(sessionId, t0 + 90_000);
    assert.ok(results.every((r) => r.timeMs === 90_000 && !r.finished));
    assert.throws(() => game.openRegion(alice, 'lviv'), /завершено/);
  });

  it('refuses to start when a region lacks questions', () => {
    const [q] = game.questions.list('crimea');
    game.questions.delete(q!.id);
    assert.throws(() => game.startSession(sessionId), /Автономна Республіка Крим/);
  });
});
