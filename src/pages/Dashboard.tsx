import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar, PieChart, Pie, Cell,
} from 'recharts';
import { AlertCircle, Headset, Hourglass, Inbox, PlusCircle, Repeat, Sparkles, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { useTaxonomy } from '../app-context';
import { api, qs, type ApiError } from '../lib/api';
import type { Dashboard } from '../lib/types';
import { PageHeader } from '../components/Layout';
import { Badge, Button, Card, Empty, ErrorBox, Spinner, cx } from '../components/ui';
import { FilterBar, useFilters } from '../components/Filters';
import { useDebounced } from '../lib/useDebounced';
import { fmtDate, fmtNum } from '../lib/format';

const PALETTE = ['#0072CE', '#41B6E6', '#6431E2', '#FF40B3', '#002D72', '#8FB3E3', '#B58CF5', '#FF9AD5'];
const SEVERITY_COLORS: Record<string, string> = { baixa: '#41B6E6', media: '#0072CE', alta: '#6431E2', critica: '#FF40B3', nao_identificado: '#C7D3E6' };
const SENTIMENT_COLORS: Record<string, string> = { neutro: '#B8CCEA', levemente_insatisfeito: '#41B6E6', insatisfeito: '#6431E2', muito_insatisfeito: '#FF40B3', nao_identificado: '#DCE3EE' };

const axis = { fontSize: 11, fill: '#5b6b85' };
const tooltipStyle = { borderRadius: 12, border: '1px solid #e2e9f4', fontSize: 12, boxShadow: '0 4px 16px rgba(0,45,114,.08)' };

function Kpi({ label, value, sub, icon, tone = 'blue', to }: { label: string; value: string; sub?: React.ReactNode; icon: React.ReactNode; tone?: 'blue' | 'purple' | 'pink' | 'navy' | 'amber'; to?: string }) {
  const tones = { blue: 'bg-[#e6f1fb] text-nibo', purple: 'bg-[#efe9fd] text-roxo', pink: 'bg-[#ffe8f5] text-[#c4127c]', navy: 'bg-[#e5ebf5] text-petroleo', amber: 'bg-amber-50 text-amber-700' };
  const body = (
    <div className="bg-white rounded-2xl border border-linha p-4 h-full hover:border-gelo transition-colors">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className={cx('size-8 rounded-xl grid place-items-center', tones[tone])}>{icon}</span>
      </div>
      <p className="text-[28px] leading-none font-semibold text-petroleo mt-3 tabular-nums">{value}</p>
      {sub && <div className="text-xs text-slate-500 mt-2">{sub}</div>}
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

function Delta({ value, previous }: { value: number | null; previous: number }) {
  if (value === null) return <span>sem base no período anterior</span>;
  const up = value > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cx('inline-flex items-center gap-1 font-medium', value === 0 ? 'text-slate-500' : up ? 'text-[#c4127c]' : 'text-emerald-700')}>
      {value !== 0 && <Icon className="size-3.5" />}
      {value > 0 ? '+' : ''}{value.toLocaleString('pt-BR')}% <span className="font-normal text-slate-500">vs. {previous} antes</span>
    </span>
  );
}

export function DashboardPage() {
  const taxonomy = useTaxonomy();
  const navigate = useNavigate();
  const { filters, update, clear } = useFilters();
  const query = useDebounced(qs(filters));
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api<Dashboard>('/api/dashboard' + query, { signal: ctrl.signal })
      .then(setData)
      .catch((e) => e.name !== 'AbortError' && setError(e))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [query, tick]);

  const historyLink = (extra: Record<string, string>) => '/reclamacoes' + qs({ from: data?.period.from, to: data?.period.to, kind: 'reclamacao', ...extra });

  return (
    <>
      <PageHeader
        title="Dashboard de reclamações"
        subtitle={data ? `Período: ${fmtDate(data.period.from)} a ${fmtDate(data.period.to)} · comparado a ${fmtDate(data.period.previousFrom)}–${fmtDate(data.period.previousTo)}` : 'Indicadores calculados a partir dos registros salvos'}
        actions={<Button size="lg" icon={<PlusCircle className="size-5" />} onClick={() => navigate('/nova')}>Nova reclamação</Button>}
      />

      <div className="space-y-5">
        <FilterBar filters={filters} update={update} clear={clear} taxonomy={taxonomy} />
        <ErrorBox error={error} onRetry={() => setTick((t) => t + 1)} />
        {loading && !data && <Spinner />}

        {data && data.totalRecords === 0 && (
          <Card>
            <Empty icon={<Inbox className="size-6" />} title="Nenhuma reclamação registrada ainda">
              Os indicadores aparecem aqui assim que o primeiro print for analisado e salvo.
              <div className="mt-4"><Button icon={<PlusCircle className="size-4" />} onClick={() => navigate('/nova')}>Registrar a primeira</Button></div>
            </Empty>
          </Card>
        )}

        {data && data.totalRecords > 0 && (
          <div className={cx('space-y-5 transition-opacity', loading && 'opacity-60')}>
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              <Kpi label="Reclamações no período" value={fmtNum(data.kpis.total)} icon={<AlertCircle className="size-4" />} sub={<Delta value={data.kpis.totalDelta} previous={data.kpis.totalPrevious} />} to={historyLink({})} />
              <Kpi label="Sobre atendimento" value={fmtNum(data.kpis.service)} tone="purple" icon={<Headset className="size-4" />} sub={`${data.kpis.servicePrevious} no período anterior`} />
              <Kpi label="Clientes únicos" value={fmtNum(data.kpis.uniqueCustomers)} tone="navy" icon={<Users className="size-4" />} sub="por ID do HubSpot ou telefone" />
              <Kpi label="Clientes recorrentes" value={fmtNum(data.kpis.recurrentCustomers)} tone="pink" icon={<Repeat className="size-4" />} sub="mais de 1 reclamação no período" />
              <Kpi label="Pendentes de validação" value={`${data.kpis.pendingPct.toLocaleString('pt-BR')}%`} tone="amber" icon={<Hourglass className="size-4" />} sub={`${data.kpis.pending} registros`} to={historyLink({ validationStatus: 'pendente' })} />
              <Kpi label="Sem vínculo HubSpot" value={fmtNum(data.kpis.unlinked)} tone="amber" icon={<Users className="size-4" />} sub="identificação a revisar" to={historyLink({ hubspotStatus: 'sem_vinculo' })} />
            </div>

            <Card title={<span className="inline-flex items-center gap-2"><Sparkles className="size-4 text-roxo" /> Leitura do período</span>} subtitle="Frases montadas a partir dos números acima — não são geradas por IA.">
              <ul className="space-y-1.5 text-sm text-slate-700 list-disc pl-5 marker:text-celeste">
                {data.insights.map((s) => <li key={s}>{s}</li>)}
              </ul>
              {data.nonComplaints.length > 0 && (
                <p className="text-xs text-slate-500 mt-3">
                  Também foram registrados no período (não contam como reclamação): {data.nonComplaints.map((n) => `${(n.label || n.name).toLowerCase()}: ${n.count}`).join(' · ')}.
                </p>
              )}
            </Card>

            <div className="grid xl:grid-cols-3 gap-5">
              <Card title="Evolução mensal" subtitle="Últimos 12 meses com os filtros atuais (exceto datas)" className="xl:col-span-2">
                <div className="h-72">
                  <ResponsiveContainer>
                    <LineChart data={data.monthly} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                      <CartesianGrid stroke="#eef2f8" vertical={false} />
                      <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="total" name="Reclamações" stroke="#0072CE" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="service" name="Sobre atendimento" stroke="#FF40B3" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card title="Gravidade" subtitle="Estimada pela IA e conferida na revisão">
                <Donut items={data.bySeverity} colors={SEVERITY_COLORS} />
              </Card>
            </div>

            <div className="grid xl:grid-cols-2 gap-5">
              <Card title="Produtos com mais reclamações">
                <HBar items={data.byProduct.slice(0, 8)} color="#0072CE" onClick={(name) => update({ product: name })} />
              </Card>
              <Card title="Categorias: período atual × anterior" subtitle="Clique numa barra para filtrar">
                <div style={{ height: Math.max(180, data.byCategory.length * 44) }}>
                  <ResponsiveContainer>
                    <BarChart data={data.byCategory} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid stroke="#eef2f8" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" width={170} tick={axis} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="count" name="Atual" fill="#6431E2" radius={[0, 6, 6, 0]} cursor="pointer" onClick={(d: any) => update({ category: d.name, subcategory: '' })} />
                      <Bar dataKey="previous" name="Anterior" fill="#B8CCEA" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <div className="grid xl:grid-cols-3 gap-5">
              <Card title="Problemas mais recorrentes" subtitle="Categoria › subcategoria › produto" className="xl:col-span-2">
                {data.topProblems.length === 0 ? <p className="text-sm text-slate-500">Sem dados no período.</p> : (
                  <ol className="space-y-2">
                    {data.topProblems.map((p, i) => {
                      const max = data.topProblems[0].count;
                      return (
                        <li key={i}>
                          <Link to={historyLink({ category: p.category, subcategory: p.subcategory, product: p.product })} className="block group">
                            <div className="flex items-center justify-between gap-3 text-sm">
                              <span className="min-w-0 truncate"><span className="text-slate-400 tabular-nums mr-2">{i + 1}.</span><span className="text-petroleo group-hover:text-nibo font-medium">{p.subcategory}</span> <span className="text-slate-500">· {p.category} · {p.product}</span></span>
                              <span className="font-semibold tabular-nums text-petroleo">{p.count}</span>
                            </div>
                            <div className="h-1.5 bg-[#eef3fa] rounded-full mt-1.5"><div className="h-full rounded-full bg-gradient-to-r from-nibo to-celeste" style={{ width: `${(p.count / max) * 100}%` }} /></div>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Card>
              <Card title="Sentimento">
                <Donut items={data.bySentiment} colors={SENTIMENT_COLORS} />
              </Card>
            </div>

            <div className="grid xl:grid-cols-3 gap-5">
              <Card title="Clientes que reclamaram" subtitle="Ordenado pela quantidade no período" className="xl:col-span-2">
                {data.customers.length === 0 ? <p className="text-sm text-slate-500">Sem dados no período.</p> : (
                  <div className="overflow-x-auto scroll-thin max-h-[420px]">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-white">
                        <tr className="text-left text-xs text-slate-500 border-b border-linha">
                          <th className="py-2 pr-3 font-medium">Cliente</th><th className="py-2 pr-3 font-medium">Empresa</th>
                          <th className="py-2 pr-3 font-medium">Principal categoria</th><th className="py-2 pr-3 font-medium">Última</th><th className="py-2 font-medium text-right">Qtd.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.customers.map((c) => (
                          <tr key={c.key} className="border-b border-linha/70 last:border-0 hover:bg-[#f7faff]">
                            <td className="py-2 pr-3">
                              <Link className="text-petroleo hover:text-nibo font-medium" to={'/reclamacoes' + qs({ customer: c.contactId || c.key.replace(/^\w+:/, ''), kind: 'reclamacao' })}>{c.name || 'Não identificado'}</Link>
                              {!c.contactId && <Badge tone="amber" className="ml-2">sem vínculo</Badge>}
                            </td>
                            <td className="py-2 pr-3 text-slate-600">{c.company || '—'}</td>
                            <td className="py-2 pr-3 text-slate-600 text-xs">{c.topCategory}</td>
                            <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{fmtDate(c.last)}</td>
                            <td className="py-2 text-right font-semibold tabular-nums">{c.count > 1 ? <Badge tone="pink">{c.count}</Badge> : c.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
              <Card title="Empresas com mais reclamações">
                <HBar items={data.byCompany} color="#41B6E6" onClick={(name) => update({ company: name })} />
              </Card>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function HBar({ items, color, onClick }: { items: { name: string; count: number }[]; color: string; onClick?: (name: string) => void }) {
  if (!items.length) return <p className="text-sm text-slate-500">Sem dados no período.</p>;
  return (
    <div style={{ height: Math.max(160, items.length * 38) }}>
      <ResponsiveContainer>
        <BarChart data={items} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid stroke="#eef2f8" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={170} tick={axis} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, 'Reclamações']} />
          <Bar dataKey="count" fill={color} radius={[0, 6, 6, 0]} cursor={onClick ? 'pointer' : undefined} onClick={(d: any) => onClick?.(d.name)} label={{ position: 'right', fontSize: 11, fill: '#002D72' }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Donut({ items, colors }: { items: { name: string; count: number; label?: string }[]; colors: Record<string, string> }) {
  const total = items.reduce((s, i) => s + i.count, 0);
  if (!total) return <p className="text-sm text-slate-500">Sem dados no período.</p>;
  return (
    <div>
      <div className="h-48 relative">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={items} dataKey="count" nameKey="label" innerRadius="62%" outerRadius="90%" paddingAngle={2} stroke="none">
              {items.map((i, idx) => <Cell key={i.name} fill={colors[i.name] || PALETTE[idx % PALETTE.length]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center"><p className="text-2xl font-semibold text-petroleo">{total}</p><p className="text-[11px] text-slate-500">registros</p></div>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {items.map((i, idx) => (
          <li key={i.name} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-slate-700"><span className="size-2.5 rounded-full" style={{ background: colors[i.name] || PALETTE[idx % PALETTE.length] }} />{i.label || i.name}</span>
            <span className="tabular-nums text-slate-600">{i.count} · {Math.round((i.count / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
