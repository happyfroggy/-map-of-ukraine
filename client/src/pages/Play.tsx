import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { PlayerState, PublicPlayer, PublicQuestion } from '../../../shared/types.ts';
import { QuestionModal } from '../components/QuestionModal.tsx';
import { ResultsView } from '../components/Results.tsx';
import { Brand, CenteredPage, ConnectionDot, ErrorNote, Spinner, fullName } from '../components/ui.tsx';
import { errorMessage, formatDuration, useNow } from '../lib/format.ts';
import { createSocket, request, type GameSocket } from '../lib/socket.ts';
import { playerTokenStore } from '../lib/storage.ts';
import { useRegions } from '../lib/useRegions.ts';
import { MapLegend, STATUS_LABELS, UkraineMap } from '../map/UkraineMap.tsx';

/** Owns the player's socket: resumes by token on every (re)connect and tracks room events. */
function usePlayerGame() {
  const navigate = useNavigate();
  const socketRef = useRef<GameSocket | null>(null);
  const [state, setState] = useState<PlayerState | null>(null);
  const [lobby, setLobby] = useState<PublicPlayer[]>([]);
  const [connected, setConnected] = useState(false);
  const [fatal, setFatal] = useState('');
  const clockOffset = useRef(0); // serverTime - localTime

  useEffect(() => {
    const token = playerTokenStore.get();
    if (!token) {
      navigate('/', { replace: true });
      return;
    }
    const socket = createSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      request(socket, 'player:resume', { token })
        .then((s) => {
          clockOffset.current = s.serverNow - Date.now();
          setState(s);
        })
        .catch((err) => {
          if (!socket.connected) return; // timed out while offline — will retry on reconnect
          playerTokenStore.set(null);
          setFatal(errorMessage(err));
        });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('lobby:players', setLobby);
    socket.on('game:started', ({ session, serverNow }) => {
      clockOffset.current = serverNow - Date.now();
      setState((s) => s && { ...s, session });
    });
    socket.on('game:ended', ({ session, results }) => setState((s) => s && { ...s, session, results }));
    socket.connect();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [navigate]);

  return { socketRef, state, setState, lobby, connected, fatal, clockOffset };
}

export function Play() {
  const { socketRef, state, setState, lobby, connected, fatal, clockOffset } = usePlayerGame();
  const regions = useRegions();
  const names = useMemo(() => Object.fromEntries(regions.map((r) => [r.id, r.name])), [regions]);
  const [open, setOpen] = useState<{ regionId: string; question: PublicQuestion } | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  const status = state?.session.status;
  const now = useNow(status === 'active' && !state?.finishedAt) + clockOffset.current;

  // Close any open question when the game ends.
  useEffect(() => {
    if (status === 'finished') setOpen(null);
  }, [status]);

  const selectRegion = useCallback(
    async (regionId: string) => {
      const socket = socketRef.current;
      if (!socket || opening) return;
      setOpening(true);
      setError('');
      try {
        const question = await request(socket, 'region:open', { regionId });
        setState((s) => s && { ...s, regions: { ...s.regions, [regionId]: 'in_progress' } }); // new visit or retry
        setOpen({ regionId, question });
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setOpening(false);
      }
    },
    [opening, setState, socketRef],
  );

  const answer = useCallback(
    async (question: PublicQuestion, value: number | string) => {
      const result = await request(socketRef.current!, 'region:answer', {
        regionId: question.regionId,
        questionId: question.id,
        answer: value,
      });
      setState(
        (s) =>
          s && {
            ...s,
            regions: { ...s.regions, [question.regionId]: result.regionStatus },
            finishedAt: result.playerFinished ? Date.now() + clockOffset.current : s.finishedAt,
          },
      );
      return result;
    },
    [clockOffset, setState, socketRef],
  );

  if (fatal) {
    return (
      <CenteredPage>
        <div className="card flex flex-col gap-4 text-center">
          <ErrorNote>{fatal}</ErrorNote>
          <Link to="/" className="btn-primary">
            На головну
          </Link>
        </div>
      </CenteredPage>
    );
  }
  if (!state) return <Spinner label="Підключення до гри…" />;

  const me = state.player;
  const counts = Object.values(state.regions).reduce(
    (acc, s) => ({ ...acc, [s]: acc[s] + 1 }),
    { green: 0, red: 0, in_progress: 0 },
  );
  const total = regions.length || 25;
  const elapsed = state.session.startedAt ? (state.finishedAt ?? now) - state.session.startedAt : 0;

  // ----- results -----
  if (status === 'finished') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <ResultsView results={state.results ?? []} highlightId={me.id} />
        <div className="mt-8 flex justify-center">
          <Link
            to="/"
            className="btn-ghost"
            onClick={() => playerTokenStore.set(null)}
          >
            На головну
          </Link>
        </div>
      </main>
    );
  }

  // ----- lobby -----
  if (status === 'lobby') {
    return (
      <CenteredPage>
        <div className="flex items-center justify-between">
          <Brand small />
          <ConnectionDot connected={connected} />
        </div>
        <div className="card flex flex-col items-center gap-3 text-center">
          <span className="relative flex h-4 w-4">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ua-yellow opacity-75" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-ua-yellow" />
          </span>
          <h1 className="text-xl font-bold">Очікуємо початку гри</h1>
          <p className="text-sm text-slate-500">
            Ви в кімнаті <span className="font-mono font-semibold">{state.session.roomCode}</span> як{' '}
            <span className="font-semibold text-slate-800">{fullName(me)}</span>
          </p>
        </div>
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-slate-500">Учасники · {lobby.length}</h2>
          <ul className="flex flex-wrap gap-2">
            {lobby.map((p) => (
              <li
                key={p.id}
                className={`rounded-full px-3 py-1 text-sm ${p.id === me.id ? 'bg-ua-blue text-white' : 'bg-slate-100 text-slate-700'}`}
              >
                {fullName(p)}
              </li>
            ))}
          </ul>
        </div>
      </CenteredPage>
    );
  }

  // ----- map -----
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-6 sm:py-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Brand small />
          <ConnectionDot connected={connected} />
        </div>
        <div className="flex items-center gap-2 text-sm sm:gap-3">
          <span className="hidden font-medium text-slate-600 sm:inline">{fullName(me)}</span>
          <Stat label="Час" value={formatDuration(elapsed)} />
          <Stat label="Досліджено" value={`${counts.green}/${total}`} className="text-green-600" />
          {counts.red > 0 && <Stat label="Неправильно" value={counts.red} className="text-blue-600" />}
        </div>
      </header>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="flex h-full">
          <div className="bg-green-500 transition-all" style={{ width: `${(counts.green / total) * 100}%` }} />
          <div className="bg-blue-500 transition-all" style={{ width: `${(counts.red / total) * 100}%` }} />
        </div>
      </div>

      {state.finishedAt ? (
        <div className="rounded-2xl bg-ua-blue px-4 py-3 text-center font-semibold text-white">
          Ви дослідили всі регіони за {formatDuration(elapsed)}! Очікуємо інших учасників…
        </div>
      ) : (
        <p className="text-center text-sm text-slate-500">
          Оберіть регіон на мапі, щоб відповісти на його питання.
          {counts.red > 0 && ` Сині регіони (${STATUS_LABELS.red.toLowerCase()}) можна пройти ще раз — потрібно 3 правильні з 4.`}
        </p>
      )}
      <ErrorNote>{error}</ErrorNote>

      <div className="card bg-sky-50 p-2 sm:p-4">
        <UkraineMap statuses={state.regions} names={names} onSelect={selectRegion} disabled={opening || !!state.finishedAt} />
      </div>
      <MapLegend />

      {open && (
        <QuestionModal
          key={open.regionId}
          regionName={names[open.regionId] ?? ''}
          question={open.question}
          onAnswer={answer}
          onClose={() => setOpen(null)}
        />
      )}
    </main>
  );
}

function Stat({ label, value, className = '' }: { label: string; value: string | number; className?: string }) {
  return (
    <span className="rounded-xl bg-white px-2.5 py-1.5 tabular-nums shadow-sm ring-1 ring-slate-200">
      <span className="text-xs text-slate-400">{label} </span>
      <span className={`font-bold ${className}`}>{value}</span>
    </span>
  );
}
