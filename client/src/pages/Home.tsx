import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Brand, CenteredPage } from '../components/ui.tsx';
import { playerTokenStore } from '../lib/storage.ts';

export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const hasGame = playerTokenStore.get() !== null;

  return (
    <CenteredPage>
      <div className="flex flex-col items-center gap-3 text-center">
        <Brand />
        <p className="text-slate-600">Інтерактивний квіз з історії, мови та літератури. Збивайте безпілотники над областями — правильними відповідями на питання!</p>
      </div>

      <form
        className="card flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const c = code.trim().toUpperCase();
          if (c) navigate(`/join/${encodeURIComponent(c)}`);
        }}
      >
        <div>
          <label htmlFor="code" className="label">
            Код кімнати
          </label>
          <input
            id="code"
            className="input text-center font-mono text-2xl tracking-[0.3em] uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 8))}
            placeholder="ABC123"
            autoComplete="off"
            autoCapitalize="characters"
          />
        </div>
        <button className="btn-primary" disabled={code.trim().length < 4}>
          Далі
        </button>
        <p className="text-center text-xs text-slate-500">Або відскануйте QR-код на екрані ведучого</p>
      </form>

      {hasGame && (
        <Link to="/play" className="btn-yellow">
          Повернутися до поточної гри
        </Link>
      )}

      <Link to="/admin" className="text-center text-sm text-slate-400 hover:text-slate-600">
        Вхід для ведучого
      </Link>
    </CenteredPage>
  );
}
