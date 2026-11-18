import type { ReactNode } from 'react';

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`grid overflow-hidden rounded-md shadow-sm ${small ? 'h-6 w-8' : 'h-8 w-11'}`}>
        <span className="bg-ua-blue" />
        <span className="bg-ua-yellow" />
      </span>
      <span className={`font-extrabold tracking-tight text-slate-900 ${small ? 'text-base' : 'text-xl'}`}>Мапа України</span>
    </div>
  );
}

export function Spinner({ label = 'Завантаження…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 p-8 text-slate-500" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-ua-blue" />
      {label}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-red-200" role="alert">
      {children}
    </p>
  );
}

export function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500" title={connected ? 'Підключено' : 'Немає з’єднання'}>
      <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'animate-pulse bg-red-500'}`} />
      {connected ? 'онлайн' : 'перепідключення…'}
    </span>
  );
}

export function CenteredPage({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10">{children}</main>;
}

export const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
