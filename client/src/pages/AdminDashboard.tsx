import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { AdminSnapshot, CreatedSession } from '../../../shared/types.ts';
import { ResultsView } from '../components/Results.tsx';
import { ConnectionDot, ErrorNote, Spinner, fullName } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { errorMessage, formatDuration, useNow } from '../lib/format.ts';
import { createSocket, request, type GameSocket } from '../lib/socket.ts';
import { adminRoomStore, adminTokenStore } from '../lib/storage.ts';

export function AdminDashboard() {
  const [room, setRoom] = useState<CreatedSession | null>(() => adminRoomStore.get());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function createRoom() {
    setCreating(true);
    setError('');
    try {
      const created = await api<CreatedSession>('/admin/sessions', { method: 'POST', admin: true });
      adminRoomStore.set(created);
      setRoom(created);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  const closeRoom = useCallback(() => {
    adminRoomStore.set(null);
    setRoom(null);
  }, []);

  if (!room) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 py-10 text-center">
        <h1 className="text-2xl font-extrabold">Нова гра</h1>
        <p className="text-slate-500">Створіть кімнату — учасники приєднаються за QR-кодом або кодом кімнати.</p>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary py-3 text-lg" onClick={createRoom} disabled={creating}>
          {creating ? 'Створюємо…' : 'Створити гру'}
        </button>
      </div>
    );
  }
  return <RoomControl key={room.session.roomCode} room={room} onClose={closeRoom} />;
}

function RoomControl({ room, onClose }: { room: CreatedSession; onClose: () => void }) {
  const navigate = useNavigate();
  const roomCode = room.session.roomCode;
  const socketRef = useRef<GameSocket | null>(null);
  const [snap, setSnap] = useState<AdminSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const socket = createSocket({ adminToken: adminTokenStore.get() ?? '' });
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      request(socket, 'admin:watch', { roomCode })
        .then(setSnap)
        .catch((err: Error) => {
          if (/авторизація/.test(err.message)) {
            adminTokenStore.set(null);
            navigate('/admin', { replace: true });
          } else if (/не знайдено/.test(err.message)) onClose();
          else setError(err.message);
        });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('admin:progress', (players) => setSnap((s) => s && { ...s, players }));
    socket.on('game:started', ({ session }) => setSnap((s) => s && { ...s, session }));
    socket.on('game:ended', ({ session, results }) => setSnap((s) => s && { ...s, session, results }));
    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [roomCode, navigate, onClose]);

  const status = snap?.session.status;
  const now = useNow(status === 'active');

  async function run(action: 'admin:start' | 'admin:end') {
    if (!socketRef.current) return;
    setBusy(true);
    setError('');
    try {
      await request(socketRef.current, action, { roomCode });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmEnd(false);
    }
  }

  if (!snap) return <Spinner label="Підключення до кімнати…" />;
  const { players, totalRegions } = snap;
  const finishedCount = players.filter((p) => p.finishedAt).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">
            Кімната <span className="font-mono tracking-widest text-ua-blue">{roomCode}</span>
          </h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-slate-500">
            <StatusBadge status={snap.session.status} />
            <ConnectionDot connected={connected} />
          </div>
        </div>
        {status === 'active' && snap.session.startedAt && (
          <div className="text-right">
            <div className="font-mono text-3xl font-bold tabular-nums">{formatDuration(now - snap.session.startedAt)}</div>
            <div className="text-sm text-slate-500">
              Завершили: {finishedCount} / {players.length}
            </div>
          </div>
        )}
      </div>

      <ErrorNote>{error}</ErrorNote>

      {status === 'lobby' && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
          <div className="card flex flex-col items-center gap-4 text-center">
            <img src={room.qrCode} alt={`QR-код для приєднання: ${room.joinUrl}`} className="aspect-square w-full max-w-sm rounded-xl" />
            <div className="font-mono text-4xl font-black tracking-[0.3em]">{roomCode}</div>
            <div className="flex w-full items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 text-left text-sm">{room.joinUrl}</code>
              <button
                type="button"
                className="btn-ghost shrink-0 px-3 py-2 text-sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(room.joinUrl).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? 'Скопійовано' : 'Копіювати'}
              </button>
            </div>
          </div>

          <div className="card flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Учасники</h2>
              <span className="rounded-full bg-ua-blue px-3 py-0.5 text-sm font-bold text-white">{players.length}</span>
            </div>
            {players.length ? (
              <ul className="flex flex-wrap gap-2">
                {players.map((p) => (
                  <li key={p.id} className="rounded-full bg-slate-100 px-3 py-1 text-sm">
                    {fullName(p)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-slate-400">Поки що ніхто не приєднався…</p>
            )}
            <div className="mt-auto flex flex-wrap gap-3 pt-2">
              <button className="btn-primary flex-1 py-3 text-lg" disabled={busy || !players.length} onClick={() => run('admin:start')}>
                ▶ Почати гру
              </button>
              <button className="btn-ghost" onClick={onClose} disabled={busy}>
                Скасувати
              </button>
            </div>
          </div>
        </div>
      )}

      {status === 'active' && (
        <>
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3 font-semibold">Учасник</th>
                  <th className="px-4 py-3 font-semibold">Прогрес</th>
                  <th className="px-4 py-3 text-right font-semibold">Правильних</th>
                  <th className="px-4 py-3 text-right font-semibold">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...players]
                  .sort((a, b) => b.correctAnswers - a.correctAnswers)
                  .map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 font-medium">{fullName(p)}</td>
                      <td className="w-2/5 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div className="bg-green-500 transition-all" style={{ width: `${(p.greenRegions / totalRegions) * 100}%` }} />
                            <div className="bg-red-500 transition-all" style={{ width: `${(p.redRegions / totalRegions) * 100}%` }} />
                          </div>
                          <span className="w-12 text-right text-xs text-slate-500 tabular-nums">
                            {p.greenRegions + p.redRegions}/{totalRegions}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">{p.correctAnswers}</td>
                      <td className="px-4 py-3 text-right">
                        {p.finishedAt ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                            ✓ {formatDuration(p.finishedAt - (snap.session.startedAt ?? p.finishedAt))}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">грає…</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-3">
            {confirmEnd ? (
              <>
                <span className="self-center text-sm font-medium text-slate-600">Завершити гру для всіх учасників?</span>
                <button className="btn-ghost" onClick={() => setConfirmEnd(false)} disabled={busy}>
                  Ні
                </button>
                <button className="btn-danger" onClick={() => run('admin:end')} disabled={busy}>
                  Так, завершити
                </button>
              </>
            ) : (
              <button className="btn-danger" onClick={() => setConfirmEnd(true)}>
                ■ Завершити гру
              </button>
            )}
          </div>
        </>
      )}

      {status === 'finished' && (
        <>
          <ResultsView results={snap.results ?? []} />
          <div className="flex justify-center">
            <button className="btn-primary" onClick={onClose}>
              Нова гра
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AdminSnapshot['session']['status'] }) {
  const map = {
    lobby: ['bg-yellow-100 text-yellow-800', 'Очікування гравців'],
    active: ['bg-green-100 text-green-800', 'Гра триває'],
    finished: ['bg-slate-200 text-slate-700', 'Завершено'],
  } as const;
  const [cls, label] = map[status];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}
