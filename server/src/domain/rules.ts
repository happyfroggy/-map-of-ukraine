// Pure game rules — no I/O, easy to unit-test.
import { createHash } from 'node:crypto';
import type { QuestionType, RegionStatus } from '../../../shared/types.ts';

export interface RoundRule {
  /** Questions drawn for the round. */
  questions: number;
  /** Correct answers needed to explore the region. */
  toWin: number;
}

/** First visit: best of 3 (2 correct → explored). */
export const FIRST_ROUND: RoundRule = { questions: 3, toWin: 2 };
/** Returning to a wrongly explored region: 3 correct out of 4. */
export const RETRY_ROUND: RoundRule = { questions: 4, toWin: 3 };

export const roundRule = (round: number): RoundRule => (round <= 1 ? FIRST_ROUND : RETRY_ROUND);

/** Minimum questions per region to start a game. */
export const QUESTIONS_PER_REGION = FIRST_ROUND.questions;

/**
 * Early stopping: the round ends as soon as the outcome is certain —
 * enough correct answers (green), or too many wrong ones to still win (red).
 */
export function resolveRegionStatus(correct: number, wrong: number, rule: RoundRule = FIRST_ROUND): RegionStatus {
  if (correct >= rule.toWin) return 'green';
  if (wrong > rule.questions - rule.toWin) return 'red';
  return 'in_progress';
}

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
  greenRegions: number;
  timeMs: number;
}

/**
 * Most explored regions first, then the fastest time.
 * Exact ties share a rank (1, 2, 2, 4 …).
 */
export function rankResults<T extends RankInput>(rows: readonly T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.greenRegions - a.greenRegions || a.timeMs - b.timeMs);
  let prev: T | undefined;
  let prevRank = 0;
  return sorted.map((row, i) => {
    const rank = prev && prev.greenRegions === row.greenRegions && prev.timeMs === row.timeMs ? prevRank : i + 1;
    prev = row;
    prevRank = rank;
    return { ...row, rank };
  });
}
