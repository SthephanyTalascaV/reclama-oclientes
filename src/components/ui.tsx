import type { ButtonHTMLAttributes, ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';

export const cx = (...c: unknown[]) => c.filter((x) => typeof x === 'string' && x).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-nibo text-white hover:bg-[#005fae] shadow-sm',
  secondary: 'bg-white text-petroleo border border-linha hover:border-gelo hover:bg-[#f7faff]',
  ghost: 'text-petroleo hover:bg-[#eaf1fb]',
  danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
};

export function Button({ variant = 'primary', size = 'md', loading, icon, children, className, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }) {
  const sizes = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-[15px] gap-2' };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap', sizes[size], VARIANTS[variant], className)}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Card({ title, subtitle, action, children, className, padded = true }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('bg-white rounded-2xl border border-linha shadow-[0_1px_2px_rgba(0,45,114,0.04)]', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div>
            {title && <h2 className="text-[15px] font-semibold text-petroleo">{title}</h2>}
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cx(padded && 'p-5', title && padded && 'pt-3')}>{children}</div>
    </section>
  );
}

const TONES = {
  neutral: 'bg-slate-100 text-slate-700',
  blue: 'bg-[#e6f1fb] text-nibo',
  navy: 'bg-[#e5ebf5] text-petroleo',
  purple: 'bg-[#efe9fd] text-roxo',
  pink: 'bg-[#ffe8f5] text-[#c4127c]',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
};
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', TONES[tone], className)}>{children}</span>;
}

export function Field({ label, hint, children, flag, source }: { label: string; hint?: ReactNode; children: ReactNode; flag?: boolean; source?: 'ia' | 'usuario' }) {
  return (
    <label className="block">
      <span className="flex items-center gap-2 text-xs font-medium text-slate-600 mb-1">
        {label}
        {flag && <Badge tone="amber">conferir</Badge>}
        {source === 'ia' && <Badge tone="blue" title="Valor extraído pela IA">IA</Badge>}
        {source === 'usuario' && <Badge tone="purple" title="Valor alterado por uma pessoa">editado</Badge>}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

const inputCls = (flag?: boolean) =>
  cx('w-full rounded-xl border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-nibo focus:outline-none focus:ring-2 focus:ring-[#0072ce22]', flag ? 'border-amber-300 bg-amber-50/40' : 'border-linha');

export const Input = ({ flag, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { flag?: boolean }) => <input {...p} className={cx(inputCls(flag), 'h-10', className)} />;
export const Textarea = ({ flag, className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { flag?: boolean }) => <textarea {...p} className={cx(inputCls(flag), 'py-2 min-h-[72px] resize-y', className)} />;
export const Select = ({ flag, className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { flag?: boolean }) => (
  <select {...p} className={cx(inputCls(flag), 'h-10 pr-8', className)}>{children}</select>
);

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
      <Loader2 className="size-5 animate-spin text-nibo" /> {label || 'Carregando…'}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, action }: { tone?: 'info' | 'warn' | 'error' | 'success'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const map = {
    info: ['bg-[#eef5fc] border-[#cfe2f6] text-petroleo', Info],
    warn: ['bg-amber-50 border-amber-200 text-amber-900', AlertTriangle],
    error: ['bg-red-50 border-red-200 text-red-900', XCircle],
    success: ['bg-emerald-50 border-emerald-200 text-emerald-900', CheckCircle2],
  } as const;
  const [cls, Icon] = map[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-xl border px-4 py-3 text-sm', cls)}>
      <Icon className="size-5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: { message: string; requestId?: string } | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <Alert tone="error" title="Algo deu errado" action={onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Tentar de novo</Button>}>
      {error.message}
      {error.requestId && <span className="block text-xs opacity-70 mt-1">Código para suporte: {error.requestId}</span>}
    </Alert>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-6">
      {icon && <div className="size-12 rounded-2xl bg-[#eef5fc] text-nibo grid place-items-center mb-3">{icon}</div>}
      <p className="font-medium text-petroleo">{title}</p>
      {children && <div className="text-sm text-slate-500 mt-1 max-w-md">{children}</div>}
    </div>
  );
}

export function severityTone(s: string): Tone {
  return ({ baixa: 'green', media: 'amber', alta: 'pink', critica: 'red' } as Record<string, Tone>)[s] || 'neutral';
}

export function statusTone(s: string): Tone {
  return ({ validado: 'green', pendente: 'amber', revisao_necessaria: 'red', vinculado: 'blue', sem_vinculo: 'amber' } as Record<string, Tone>)[s] || 'neutral';
}
