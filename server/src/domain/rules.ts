// Pure game rules — no I/O, easy to unit-test.
import { createHash } from 'node:crypto';
import type { QuestionType, RegionStatus } from '../../../shared/types.ts';

/** Every region starts with this many drones; each correct answer shoots one down. */
export const DRONES_PER_REGION = 3;

/** A region needs this many distinct questions (one per drone) to be playable. */
export const QUESTIONS_PER_REGION = DRONES_PER_REGION;

/** A region turns green once all its drones are down. */
export const dronesLeft = (correct: number): number => Math.max(0, DRONES_PER_REGION - correct);
export const regionStatus = (correct: number): RegionStatus => (dronesLeft(correct) === 0 ? 'green' : 'in_progress');

const APOSTROPHES = /[’ʼ‘`´']/g;
const IGNORED_PUNCTUATION = /[«»"“”„.,!?;:()]/g;

/** Case-insensitive, whitespace/punctuation-tolerant form of a free-text answer. */
export function normalizeAnswer(input: string): string {
  return input
    .normalize('NFC')
    .replace(APOSTROPHES, "'")
    .replace(IGNORED_PUNCTUATION, ' ')
    .toLocaleLowerCase('uk-UA')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface AnswerKey {
  type: QuestionType;
  correctIndex: number | null;
  acceptedAnswers: string[] | null;
}

export function isAnswerCorrect(key: AnswerKey, given: number | string): boolean {
  if (key.type === 'choice') {
    return typeof given === 'number' && given === key.correctIndex;
  }
  const normalized = normalizeAnswer(String(given));
  if (!normalized) return false;
  return (key.acceptedAnswers ?? []).some((a) => normalizeAnswer(a) === normalized);
}

/**
 * Deterministic shuffle of option positions for one player's question, so
 * neighbours see A/B/C/D in different orders but a re-opened question keeps its order.
 * Returns `order` where displayed option i is original option order[i].
 */
export function optionOrder(seed: string, n: number): number[] {
  const bytes = createHash('sha256').update(seed).digest();
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = bytes[i]! % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

export interface RankInput {
  /** Drones shot down (= correct answers). */
  correctAnswers: number;
  mistakes: number;
  timeMs: number;
}

/**
 * Most drones shot down first, then fewer mistakes, then the fastest time.
 * Exact ties share a rank (1, 2, 2, 4 …).
 */
export function rankResults<T extends RankInput>(rows: readonly T[]): (T & { rank: number })[] {
  const cmp = (a: T, b: T) => b.correctAnswers - a.correctAnswers || a.mistakes - b.mistakes || a.timeMs - b.timeMs;
  const sorted = [...rows].sort(cmp);
  let prev: T | undefined;
  let prevRank = 0;
  return sorted.map((row, i) => {
    const rank = prev && cmp(prev, row) === 0 ? prevRank : i + 1;
    prev = row;
    prevRank = rank;
    return { ...row, rank };
  });
}
