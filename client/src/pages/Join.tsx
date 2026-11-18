import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { SessionInfo } from '../../../shared/types.ts';
import { Brand, CenteredPage, ErrorNote, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { errorMessage } from '../lib/format.ts';
import { createSocket, request } from '../lib/socket.ts';
import { playerTokenStore } from '../lib/storage.ts';

export function Join() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<SessionInfo>(`/sessions/${encodeURIComponent(code)}`)
      .then(setSession)
      .catch((err) => setLoadError(errorMessage(err)));
  }, [code]);

  const firstErr = touched && !firstName.trim() ? "Вкажіть ім'я" : '';
  const lastErr = touched && !lastName.trim() ? 'Вкажіть прізвище' : '';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!firstName.trim() || !lastName.trim()) return;
    setBusy(true);
    setError('');
    const socket = createSocket();
    socket.connect();
    try {
      const { token } = await request(socket, 'player:join', { roomCode: code, firstName, lastName });
      playerTokenStore.set(token);
      navigate('/play', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      socket.disconnect();
      setBusy(false);
    }
  }

  return (
    <CenteredPage>
      <div className="flex justify-center">
        <Brand />
      </div>

      {!session && !loadError && <Spinner />}

      {loadError && (
        <div className="card flex flex-col gap-4 text-center">
          <ErrorNote>{loadError}</ErrorNote>
          <Link to="/" className="btn-ghost">
            Ввести інший код
          </Link>
        </div>
      )}

      {session && session.status !== 'lobby' && (
        <div className="card flex flex-col gap-4 text-center">
          <p className="font-semibold">{session.status === 'active' ? 'Ця гра вже розпочалася.' : 'Ця гра вже завершилася.'}</p>
          {playerTokenStore.get() && (
            <Link to="/play" className="btn-primary">
              Повернутися до своєї гри
            </Link>
          )}
          <Link to="/" className="btn-ghost">
            На головну
          </Link>
        </div>
      )}

      {session?.status === 'lobby' && (
        <form className="card flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <div className="text-center">
            <p className="text-sm text-slate-500">Кімната</p>
            <p className="font-mono text-2xl font-bold tracking-[0.25em]">{session.roomCode}</p>
          </div>
          <div>
            <label htmlFor="firstName" className="label">
              Ім'я
            </label>
            <input
              id="firstName"
              className={`input ${firstErr ? 'border-red-400' : ''}`}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              maxLength={50}
              autoFocus
            />
            {firstErr && <p className="mt-1 text-sm text-red-600">{firstErr}</p>}
          </div>
          <div>
            <label htmlFor="lastName" className="label">
              Прізвище
            </label>
            <input
              id="lastName"
              className={`input ${lastErr ? 'border-red-400' : ''}`}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              maxLength={50}
            />
            {lastErr && <p className="mt-1 text-sm text-red-600">{lastErr}</p>}
          </div>
          <ErrorNote>{error}</ErrorNote>
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Приєднуємось…' : 'Приєднатися до гри'}
          </button>
        </form>
      )}
    </CenteredPage>
  );
}
