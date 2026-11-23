import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RETRY_ROUND, isAnswerCorrect, normalizeAnswer, optionOrder, rankResults, resolveRegionStatus } from '../src/domain/rules.ts';

describe('resolveRegionStatus (early stopping)', () => {
  it('2 correct → green, 2 wrong → red', () => {
    assert.equal(resolveRegionStatus(2, 0), 'green');
    assert.equal(resolveRegionStatus(0, 2), 'red');
  });
  it('1:1 needs a tie-breaker; it decides the outcome', () => {
    assert.equal(resolveRegionStatus(1, 1), 'in_progress');
    assert.equal(resolveRegionStatus(2, 1), 'green');
    assert.equal(resolveRegionStatus(1, 2), 'red');
  });
  it('single answer keeps the region open', () => {
    assert.equal(resolveRegionStatus(1, 0), 'in_progress');
    assert.equal(resolveRegionStatus(0, 1), 'in_progress');
  });
});

describe('retry round (3 correct out of 4)', () => {
  it('3 correct → green, even after one mistake', () => {
    assert.equal(resolveRegionStatus(3, 0, RETRY_ROUND), 'green');
    assert.equal(resolveRegionStatus(3, 1, RETRY_ROUND), 'green');
    assert.equal(resolveRegionStatus(2, 1, RETRY_ROUND), 'in_progress');
  });
  it('2 mistakes → red immediately (3 of 4 no longer possible)', () => {
    assert.equal(resolveRegionStatus(0, 2, RETRY_ROUND), 'red');
    assert.equal(resolveRegionStatus(1, 2, RETRY_ROUND), 'red');
    assert.equal(resolveRegionStatus(1, 1, RETRY_ROUND), 'in_progress');
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
  it('sorts by explored regions desc, then time asc; ties share a rank', () => {
    const ranked = rankResults([
      { id: 'slow', greenRegions: 10, timeMs: 9000 },
      { id: 'best', greenRegions: 12, timeMs: 9999 },
      { id: 'fast', greenRegions: 10, timeMs: 5000 },
      { id: 'tie', greenRegions: 10, timeMs: 9000 },
    ]);
    assert.deepEqual(ranked.map((r) => [r.id, r.rank]), [
      ['best', 1],
      ['fast', 2],
      ['slow', 3],
      ['tie', 3],
    ]);
  });
});
