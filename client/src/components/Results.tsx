import type { ResultRow } from '../../../shared/types.ts';
import { formatDuration } from '../lib/format.ts';
import { fullName } from './ui.tsx';

const PLACES = [
  { place: 2, height: 'h-24 sm:h-32', color: 'from-slate-300 to-slate-400', medal: '🥈' },
  { place: 1, height: 'h-32 sm:h-44', color: 'from-yellow-300 to-yellow-500', medal: '🥇' },
  { place: 3, height: 'h-16 sm:h-24', color: 'from-orange-300 to-orange-500', medal: '🥉' },
];

export function Podium({ results }: { results: ResultRow[] }) {
  // Visual order 2-1-3; uses list position (ties keep their shared rank number).
  return (
    <div className="flex items-end justify-center gap-2 sm:gap-4">
      {PLACES.map(({ place, height, color, medal }) => {
        const r = results[place - 1];
        return (
          <div key={place} className="flex w-1/3 max-w-44 flex-col items-center">
            {r ? (
              <div className="mb-2 text-center">
                <div className="text-3xl sm:text-4xl">{medal}</div>
                <div className="mt-1 line-clamp-2 text-sm font-bold text-slate-900 sm:text-base">{fullName(r)}</div>
                <div className="text-xs text-slate-500">
                  {r.correctAnswers} збито · {r.mistakes} пом. · {formatDuration(r.timeMs)}
                </div>
              </div>
            ) : (
              <div className="mb-2 text-sm text-slate-300">—</div>
            )}
            <div className={`flex w-full items-start justify-center rounded-t-xl bg-gradient-to-b pt-2 text-2xl font-black text-white/90 shadow-inner ${color} ${height}`}>
              {r?.rank ?? place}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Leaderboard({ results, highlightId }: { results: ResultRow[]; highlightId?: number }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase">
          <tr>
            <th className="px-4 py-3 font-semibold">Місце</th>
            <th className="px-4 py-3 font-semibold">Учасник</th>
            <th className="px-4 py-3 text-right font-semibold">Збито дронів</th>
            <th className="px-4 py-3 text-right font-semibold">Помилок</th>
            <th className="px-4 py-3 text-right font-semibold">Очищено областей</th>
            <th className="px-4 py-3 text-right font-semibold">Час</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {results.map((r) => (
            <tr key={r.id} className={r.id === highlightId ? 'bg-yellow-50 font-semibold' : ''}>
              <td className="px-4 py-3 font-bold text-slate-700">{r.rank}</td>
              <td className="px-4 py-3">
                {fullName(r)}
                {r.id === highlightId && <span className="ml-2 text-xs font-medium text-ua-blue">(ви)</span>}
              </td>
              <td className="px-4 py-3 text-right font-bold text-orange-600 tabular-nums">{r.correctAnswers}</td>
              <td className="px-4 py-3 text-right text-red-500 tabular-nums">{r.mistakes}</td>
              <td className="px-4 py-3 text-right text-green-600 tabular-nums">{r.greenRegions}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatDuration(r.timeMs)}
                {!r.finished && <span className="ml-1 text-xs text-slate-400" title="Не збив усіх дронів">*</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {results.some((r) => !r.finished) && (
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">* не збив усіх дронів до кінця гри — час рахується до завершення гри</p>
      )}
    </div>
  );
}

export function ResultsView({ results, highlightId }: { results: ResultRow[]; highlightId?: number }) {
  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-center text-2xl font-extrabold sm:text-3xl">Результати гри</h2>
      {results.length ? <Podium results={results} /> : <p className="text-center text-slate-500">Немає учасників</p>}
      <Leaderboard results={results} highlightId={highlightId} />
    </div>
  );
}
