// Pure game rules — no I/O, easy to unit-test.
import type { QuestionType, RegionStatus } from '../../../shared/types.ts';

export const QUESTIONS_PER_REGION = 3;

/**
 * Early-stopping rule (best of 3):
 *  2 correct → green, 2 wrong → red, 1:1 → keep going (tie-breaker question).
 */
export function resolveRegionStatus(correct: number, wrong: number): RegionStatus {
  if (correct >= 2) return 'green';
  if (wrong >= 2) return 'red';
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

export interface RankInput {
  correctAnswers: number;
  timeMs: number;
}

/**
 * Most correct answers first, then the fastest time.
 * Exact ties share a rank (1, 2, 2, 4 …).
 */
export function rankResults<T extends RankInput>(rows: readonly T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.correctAnswers - a.correctAnswers || a.timeMs - b.timeMs);
  let prev: T | undefined;
  let prevRank = 0;
  return sorted.map((row, i) => {
    const rank = prev && prev.correctAnswers === row.correctAnswers && prev.timeMs === row.timeMs ? prevRank : i + 1;
    prev = row;
    prevRank = rank;
    return { ...row, rank };
  });
}
