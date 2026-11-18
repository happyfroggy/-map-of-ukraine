import { Navigate, NavLink, Outlet, useNavigate } from 'react-router';
import { Brand } from '../components/ui.tsx';
import { adminTokenStore } from '../lib/storage.ts';

export function AdminLayout() {
  const navigate = useNavigate();
  if (!adminTokenStore.get()) return <Navigate to="/admin" replace />;

  const tab = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-1.5 text-sm font-semibold transition ${isActive ? 'bg-ua-blue text-white' : 'text-slate-600 hover:bg-slate-100'}`;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Brand small />
          <nav className="flex items-center gap-1">
            <NavLink to="/admin/game" className={tab}>
              Гра
            </NavLink>
            <NavLink to="/admin/questions" className={tab}>
              Питання
            </NavLink>
            <button
              type="button"
              className="ml-2 rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
              onClick={() => {
                adminTokenStore.set(null);
                navigate('/admin', { replace: true });
              }}
            >
              Вийти
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
