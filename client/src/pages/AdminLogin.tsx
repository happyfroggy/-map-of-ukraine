import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Brand, CenteredPage, ErrorNote } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { errorMessage } from '../lib/format.ts';
import { adminTokenStore } from '../lib/storage.ts';

export function AdminLogin() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (adminTokenStore.get()) return <Navigate to="/admin/game" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token } = await api<{ token: string }>('/admin/login', { method: 'POST', body: { password } });
      adminTokenStore.set(token);
      navigate('/admin/game', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CenteredPage>
      <div className="flex flex-col items-center gap-2">
        <Brand />
        <p className="text-sm text-slate-500">Панель ведучого</p>
      </div>
      <form className="card flex flex-col gap-4" onSubmit={onSubmit}>
        <div>
          <label htmlFor="password" className="label">
            Пароль
          </label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </div>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary" disabled={busy || !password}>
          {busy ? 'Вхід…' : 'Увійти'}
        </button>
      </form>
      <Link to="/" className="text-center text-sm text-slate-400 hover:text-slate-600">
        ← На головну
      </Link>
    </CenteredPage>
  );
}
