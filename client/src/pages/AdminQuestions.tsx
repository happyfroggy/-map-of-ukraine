import { useCallback, useEffect, useState } from 'react';
import type { AdminQuestion, QuestionInput, QuestionType } from '../../../shared/types.ts';
import { ErrorNote, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { errorMessage } from '../lib/format.ts';
import { useRegions } from '../lib/useRegions.ts';

interface RegionCount {
  regionId: string;
  name: string;
  count: number;
}

const REQUIRED = 3;

export function AdminQuestions() {
  const regions = useRegions();
  const [counts, setCounts] = useState<RegionCount[]>([]);
  const [regionId, setRegionId] = useState('');
  const [questions, setQuestions] = useState<AdminQuestion[] | null>(null);
  const [editing, setEditing] = useState<AdminQuestion | 'new' | null>(null);
  const [error, setError] = useState('');

  const loadCounts = useCallback(() => {
    api<RegionCount[]>('/admin/questions/counts', { admin: true })
      .then(setCounts)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const loadQuestions = useCallback((id: string) => {
    setQuestions(null);
    api<AdminQuestion[]>(`/admin/questions?regionId=${encodeURIComponent(id)}`, { admin: true })
      .then(setQuestions)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(loadCounts, [loadCounts]);
  useEffect(() => {
    if (!regionId && regions[0]) setRegionId(regions[0].id);
  }, [regions, regionId]);
  useEffect(() => {
    if (regionId) loadQuestions(regionId);
    setEditing(null);
  }, [regionId, loadQuestions]);

  const refresh = () => {
    loadCounts();
    loadQuestions(regionId);
  };

  const regionName = regions.find((r) => r.id === regionId)?.name ?? '';
  const lacking = counts.filter((c) => c.count < REQUIRED);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">Банк питань</h1>
        <p className="text-sm text-slate-500">
          Для кожного регіону потрібно щонайменше {REQUIRED} питання. Якщо їх більше, кожен гравець отримає випадкові {REQUIRED}.
        </p>
      </div>
      {lacking.length > 0 && (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-amber-200">
          Недостатньо питань: {lacking.map((c) => `${c.name} (${c.count})`).join(', ')}. Гру не вдасться розпочати.
        </p>
      )}
      <ErrorNote>{error}</ErrorNote>

      <div className="grid gap-5 md:grid-cols-[260px_1fr]">
        {/* Region picker: list on desktop, select on mobile */}
        <select className="input md:hidden" value={regionId} onChange={(e) => setRegionId(e.target.value)}>
          {counts.map((c) => (
            <option key={c.regionId} value={c.regionId}>
              {c.name} ({c.count})
            </option>
          ))}
        </select>
        <nav className="card hidden max-h-[75vh] overflow-y-auto p-2 md:block">
          {counts.map((c) => (
            <button
              key={c.regionId}
              type="button"
              onClick={() => setRegionId(c.regionId)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                c.regionId === regionId ? 'bg-ua-blue font-semibold text-white' : 'hover:bg-slate-100'
              }`}
            >
              {c.name}
              <span
                className={`rounded-full px-2 text-xs font-bold ${
                  c.count < REQUIRED ? 'bg-red-100 text-red-700' : c.regionId === regionId ? 'bg-white/20' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {c.count}
              </span>
            </button>
          ))}
        </nav>

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">{regionName}</h2>
            {editing === null && (
              <button className="btn-primary" onClick={() => setEditing('new')}>
                + Додати питання
              </button>
            )}
          </div>

          {editing && (
            <QuestionEditor
              key={editing === 'new' ? 'new' : editing.id}
              regionId={regionId}
              initial={editing === 'new' ? null : editing}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                refresh();
              }}
            />
          )}

          {questions === null ? (
            <Spinner />
          ) : questions.length === 0 ? (
            <p className="card text-center text-slate-400">У цьому регіоні ще немає питань</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {questions.map((q) => (
                <QuestionItem key={q.id} q={q} onEdit={() => setEditing(q)} onDeleted={refresh} onError={setError} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function QuestionItem({ q, onEdit, onDeleted, onError }: { q: AdminQuestion; onEdit: () => void; onDeleted: () => void; onError: (m: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await api(`/admin/questions/${q.id}`, { method: 'DELETE', admin: true });
      onDeleted();
    } catch (err) {
      onError(errorMessage(err));
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <li className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">{q.prompt}</p>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          {q.type === 'choice' ? 'Тест' : 'Текст'}
        </span>
      </div>
      {q.type === 'choice' ? (
        <ol className="grid gap-1 text-sm sm:grid-cols-2">
          {q.options?.map((o, i) => (
            <li key={i} className={i === q.correctIndex ? 'font-semibold text-green-700' : 'text-slate-600'}>
              {i === q.correctIndex ? '✓ ' : '• '}
              {o}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-green-700">
          <span className="text-slate-500">Приймаються: </span>
          {q.acceptedAnswers?.join(' · ')}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {confirm ? (
          <>
            <span className="self-center text-sm text-slate-600">Видалити питання?</span>
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setConfirm(false)} disabled={busy}>
              Ні
            </button>
            <button className="btn-danger px-3 py-1.5 text-sm" onClick={remove} disabled={busy}>
              Видалити
            </button>
          </>
        ) : (
          <>
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={onEdit}>
              Редагувати
            </button>
            <button className="btn-ghost px-3 py-1.5 text-sm text-red-600" onClick={() => setConfirm(true)}>
              Видалити
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function QuestionEditor({
  regionId,
  initial,
  onCancel,
  onSaved,
}: {
  regionId: string;
  initial: AdminQuestion | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<QuestionType>(initial?.type ?? 'choice');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [options, setOptions] = useState<string[]>(initial?.options ?? ['', '', '', '']);
  const [correctIndex, setCorrectIndex] = useState(initial?.correctIndex ?? 0);
  const [answers, setAnswers] = useState((initial?.acceptedAnswers ?? []).join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: QuestionInput =
      type === 'choice'
        ? { regionId, type, prompt, options, correctIndex }
        : { regionId, type, prompt, acceptedAnswers: answers.split('\n').map((s) => s.trim()).filter(Boolean) };
    setBusy(true);
    setError('');
    try {
      if (initial) await api(`/admin/questions/${initial.id}`, { method: 'PUT', body, admin: true });
      else await api('/admin/questions', { method: 'POST', body, admin: true });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-4 ring-2 ring-ua-blue/30">
      <h3 className="font-bold">{initial ? 'Редагування питання' : 'Нове питання'}</h3>

      <div className="inline-flex self-start rounded-xl bg-slate-100 p-1">
        {(['choice', 'text'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${type === t ? 'bg-white shadow-sm' : 'text-slate-500'}`}
          >
            {t === 'choice' ? 'Тест (4 варіанти)' : 'Текстова відповідь'}
          </button>
        ))}
      </div>

      <div>
        <label htmlFor="prompt" className="label">
          Текст питання
        </label>
        <textarea id="prompt" className="input min-h-20" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={500} required />
      </div>

      {type === 'choice' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="label">Варіанти (позначте правильний)</legend>
          {options.map((o, i) => (
            <label key={i} className="flex items-center gap-3">
              <input
                type="radio"
                name="correct"
                checked={correctIndex === i}
                onChange={() => setCorrectIndex(i)}
                className="h-5 w-5 accent-green-600"
              />
              <input
                className={`input ${correctIndex === i ? 'border-green-500' : ''}`}
                value={o}
                onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={`Варіант ${i + 1}`}
                maxLength={200}
                required
              />
            </label>
          ))}
        </fieldset>
      ) : (
        <div>
          <label htmlFor="answers" className="label">
            Правильні відповіді (кожна з нового рядка)
          </label>
          <textarea id="answers" className="input min-h-20" value={answers} onChange={(e) => setAnswers(e.target.value)} required />
          <p className="mt-1 text-xs text-slate-500">Регістр, зайві пробіли, лапки та різні апострофи не враховуються.</p>
        </div>
      )}

      <ErrorNote>{error}</ErrorNote>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
          Скасувати
        </button>
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Збереження…' : 'Зберегти'}
        </button>
      </div>
    </form>
  );
}
