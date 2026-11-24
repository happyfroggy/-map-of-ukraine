import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DRONES_PER_REGION, dronesLeft, isAnswerCorrect, normalizeAnswer, optionOrder, rankResults, regionStatus } from '../src/domain/rules.ts';

describe('drones', () => {
  it('3 drones per region; each correct answer removes one; 0 left → green', () => {
    assert.equal(DRONES_PER_REGION, 3);
    assert.deepEqual([0, 1, 2, 3, 4].map(dronesLeft), [3, 2, 1, 0, 0]);
    assert.deepEqual([0, 2, 3].map(regionStatus), ['in_progress', 'in_progress', 'green']);
  });
});

describe('optionOrder', () => {
  it('is a stable permutation that varies by seed', () => {
    assert.deepEqual(optionOrder('a', 4), optionOrder('a', 4));
    assert.deepEqual([...optionOrder('a', 4)].sort(), [0, 1, 2, 3]);
    const distinct = new Set(Array.from({ length: 50 }, (_, i) => optionOrder(`seed-${i}`, 4).join('')));
    assert.ok(distinct.size > 5, 'different players get different orders');
  });
});

describe('text answers', () => {
  it('ignores case, surrounding/inner whitespace and punctuation', () => {
    assert.equal(normalizeAnswer('  ТРЕМБІТА. '), 'трембіта');
    assert.equal(normalizeAnswer('кошовий   отаман'), 'кошовий отаман');
    assert.equal(normalizeAnswer('«Кобзар»'), 'кобзар');
  });
  it('treats all apostrophe variants as equal', () => {
    const variants = ["Кам'янець", 'Кам’янець', 'Камʼянець', 'Кам`янець'];
    assert.equal(new Set(variants.map(normalizeAnswer)).size, 1);
  });
  it('matches any accepted answer', () => {
    const key = { type: 'text' as const, correctIndex: null, acceptedAnswers: ['Косач', 'Лариса Косач'] };
    assert.ok(isAnswerCorrect(key, ' косач '));
    assert.ok(isAnswerCorrect(key, 'ЛАРИСА косач'));
    assert.ok(!isAnswerCorrect(key, 'Українка'));
    assert.ok(!isAnswerCorrect(key, '   '));
  });
});

describe('choice answers', () => {
  const key = { type: 'choice' as const, correctIndex: 2, acceptedAnswers: null };
  it('requires the exact numeric index', () => {
    assert.ok(isAnswerCorrect(key, 2));
    assert.ok(!isAnswerCorrect(key, 1));
    assert.ok(!isAnswerCorrect(key, '2'));
  });
});

describe('rankResults', () => {
  it('ranks by drones shot ↓, then mistakes ↑, then time ↑; exact ties share a rank', () => {
    const ranked = rankResults([
      { id: 'sloppy', correctAnswers: 75, mistakes: 9, timeMs: 1000 },
      { id: 'clean-slow', correctAnswers: 75, mistakes: 0, timeMs: 9000 },
      { id: 'fewer', correctAnswers: 60, mistakes: 0, timeMs: 500 },
      { id: 'clean-fast', correctAnswers: 75, mistakes: 0, timeMs: 5000 },
      { id: 'tie', correctAnswers: 75, mistakes: 0, timeMs: 9000 },
    ]);
    assert.deepEqual(ranked.map((r) => [r.id, r.rank]), [
      ['clean-fast', 1],
      ['clean-slow', 2],
      ['tie', 2],
      ['sloppy', 4],
      ['fewer', 5],
    ]);
  });
});
