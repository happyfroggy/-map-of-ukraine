import { useEffect, useRef, useState } from 'react';
import type { AnswerResult, PublicQuestion } from '../../../shared/types.ts';
import { errorMessage } from '../lib/format.ts';
import { ErrorNote } from './ui.tsx';

interface Props {
  regionName: string;
  question: PublicQuestion;
  onAnswer: (question: PublicQuestion, answer: number | string) => Promise<AnswerResult>;
  onClose: () => void;
}

const OPTION_LETTERS = ['А', 'Б', 'В', 'Г'];

export function QuestionModal({ regionName, question: initial, onAnswer, onClose }: Props) {
  const [question, setQuestion] = useState(initial);
  const [history, setHistory] = useState<boolean[]>([]);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  useEffect(() => {
    if (result) nextRef.current?.focus();
    else if (question.type === 'text') inputRef.current?.focus();
  }, [result, question]);

  async function submit(answer: number | string) {
    if (busy || result) return;
    setBusy(true);
    setError('');
    try {
      const r = await onAnswer(question, answer);
      setResult(r);
      setHistory((h) => [...h, r.correct]);
    } catch (err) {
      setChosen(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function next() {
    if (result?.nextQuestion) {
      setQuestion(result.nextQuestion);
      setResult(null);
      setChosen(null);
      setText('');
    } else onClose();
  }

  const finished = result && result.regionStatus !== 'in_progress';
  const retry = question.round > 1;
  const tieBreaker = !retry && question.number === 3;
  const correctSoFar = history.filter(Boolean).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="question-title"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-wide text-ua-blue uppercase">{regionName}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              Питання {question.number} з {question.total}
              {tieBreaker && ' · вирішальне'}
              {retry && ' · повторна спроба'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5" aria-label="Відповіді в цьому регіоні">
              {Array.from({ length: question.total }, (_, i) => (
                <span
                  key={i}
                  className={`h-2.5 w-2.5 rounded-full ${
                    history[i] === true ? 'bg-green-500' : history[i] === false ? 'bg-red-500' : 'bg-slate-200'
                  }`}
                />
              ))}
            </div>
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Закрити">
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
                <path d="M6.3 5.3a1 1 0 0 0-1.4 1.4L8.6 10l-3.7 3.3a1 1 0 1 0 1.4 1.4L10 11.4l3.3 3.3a1 1 0 0 0 1.4-1.4L11.4 10l3.3-3.3a1 1 0 0 0-1.4-1.4L10 8.6 6.3 5.3z" />
              </svg>
            </button>
          </div>
        </div>

        {retry && question.number === 1 && !result && (
          <p className="mb-4 rounded-xl bg-blue-50 px-3.5 py-2.5 text-sm text-blue-900 ring-1 ring-blue-200">
            Друга спроба дослідити регіон: потрібно <b>{question.toWin} правильні відповіді з {question.total}</b>.
          </p>
        )}

        <h2 id="question-title" className="mb-5 text-lg leading-snug font-bold text-slate-900 sm:text-xl">
          {question.prompt}
        </h2>

        {question.type === 'choice' && question.options ? (
          <div className="grid gap-2.5">
            {question.options.map((opt, i) => {
              const isCorrect = result && opt === result.correctAnswer;
              const isWrongPick = result && chosen === i && !result.correct;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={busy || !!result}
                  onClick={() => {
                    setChosen(i);
                    void submit(i);
                  }}
                  className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left font-medium transition ${
                    isCorrect ? 'border-green-500 bg-green-50 text-green-900'
                    : isWrongPick ? 'border-red-500 bg-red-50 text-red-900'
                    : chosen === i ? 'border-ua-blue bg-blue-50'
                    : 'border-slate-200 hover:border-ua-blue hover:bg-blue-50/50 disabled:hover:border-slate-200 disabled:hover:bg-transparent'
                  } ${result && !isCorrect && !isWrongPick ? 'opacity-50' : ''}`}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-sm font-bold text-slate-600">
                    {OPTION_LETTERS[i]}
                  </span>
                  {opt}
                </button>
              );
            })}
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) void submit(text);
            }}
            className="flex flex-col gap-3 sm:flex-row"
          >
            <input
              ref={inputRef}
              className={`input ${result ? (result.correct ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50') : ''}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy || !!result}
              placeholder="Ваша відповідь"
              autoComplete="off"
              autoCapitalize="off"
              maxLength={200}
            />
            {!result && (
              <button className="btn-primary shrink-0" disabled={busy || !text.trim()}>
                Відповісти
              </button>
            )}
          </form>
        )}

        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>

        {result && (
          <div className="mt-2 flex flex-col gap-4">
            <div className={`rounded-2xl px-4 py-3 ${result.correct ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'}`}>
              <p className="font-bold">{result.correct ? '✓ Правильно!' : '✗ Неправильно'}</p>
              {!result.correct && (
                <p className="mt-0.5 text-sm">
                  Правильна відповідь: <span className="font-semibold">{result.correctAnswer}</span>
                </p>
              )}
            </div>
            {finished && result.regionStatus === 'green' && (
              <p className="text-center text-lg font-extrabold text-green-600">Регіон досліджено!</p>
            )}
            {finished && result.regionStatus === 'red' && (
              <div className="text-center">
                <p className="text-lg font-extrabold text-blue-600">Регіон досліджено неправильно</p>
                <p className="mt-1 text-sm text-slate-500">
                  Поверніться до нього пізніше: щоб дослідити, потрібно 3 правильні відповіді з 4.
                </p>
              </div>
            )}
            {!finished && !retry && history.length === 2 && (
              <p className="text-center text-sm font-medium text-amber-700">Рахунок 1:1 — далі вирішальне питання</p>
            )}
            {!finished && retry && (
              <p className="text-center text-sm font-medium text-slate-600">
                Правильних: {correctSoFar} з {question.toWin} потрібних
              </p>
            )}
            <button ref={nextRef} type="button" className={finished ? 'btn-ghost' : 'btn-primary'} onClick={next}>
              {result.nextQuestion ? 'Наступне питання →' : 'До мапи'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
