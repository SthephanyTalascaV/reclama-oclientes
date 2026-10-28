import { useState } from 'react';
import { CheckCircle2, Plus, Trash2, XCircle } from 'lucide-react';
import { useApp, useTaxonomy } from '../app-context';
import { api, type ApiError } from '../lib/api';
import type { Category } from '../lib/types';
import { PageHeader } from '../components/Layout';
import { Alert, Badge, Button, Card, ErrorBox, Input } from '../components/ui';
import { fmtDateTime } from '../lib/format';

export function SettingsPage() {
  const { health, user, reloadTaxonomy } = useApp();
  const taxonomy = useTaxonomy();
  const [cats, setCats] = useState<Category[]>(() => structuredClone(taxonomy.categories));
  const [products, setProducts] = useState<string[]>(() => [...taxonomy.products]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [ok, setOk] = useState(false);
  const canEdit = Boolean(user?.admin);

  const save = async () => {
    setSaving(true);
    setError(null);
    setOk(false);
    try {
      await api('/api/taxonomy', { method: 'PUT', body: { categories: cats, products } });
      await reloadTaxonomy();
      setOk(true);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  };

  const setCat = (i: number, patch: Partial<Category>) => setCats(cats.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const I = health?.integrations;

  return (
    <>
      <PageHeader title="Configurações" subtitle="Status das integrações e categorias usadas pela IA e pelo dashboard." />
      <div className="grid xl:grid-cols-3 gap-5">
        <div className="space-y-5">
          <Card title="Integrações">
            {health?.demo && <Alert tone="warn" title="Modo demonstração ativo">IA, HubSpot e banco estão simulados. Desligue DEMO_MODE em produção.</Alert>}
            {I && (
              <ul className="space-y-3 text-sm mt-3">
                <Status ok={I.firebase.configured && I.firebase.storageBucket} label="Firebase (banco e prints)" envs={I.firebase.required} />
                <Status ok={I.ai.configured} label={`IA — ${I.ai.provider} (${I.ai.model})`} envs={I.ai.required} />
                <Status ok={I.hubspot.configured} label="HubSpot (busca de contatos)" envs={I.hubspot.required} extra={!I.hubspot.portalId && I.hubspot.configured ? 'Defina HUBSPOT_PORTAL_ID para links diretos ao contato.' : undefined} />
                <Status ok={I.security.appSecret} label="Assinatura das análises" envs={['APP_SECRET']} />
                <Status ok={I.security.cronSecret} label="Limpeza automática dos prints" envs={['CRON_SECRET']} extra={`Retenção: ${health!.retentionDays} dias`} />
              </ul>
            )}
            <p className="text-xs text-slate-500 mt-4">Acesso liberado para @{I?.security.allowedDomain}. {I?.security.adminsConfigured ? 'Administradores definidos em ADMIN_EMAILS.' : 'ADMIN_EMAILS vazio: todos os usuários podem editar categorias.'}</p>
          </Card>
        </div>

        <div className="xl:col-span-2 space-y-5">
          <Card
            title="Categorias e subcategorias"
            subtitle={taxonomy.updatedAt ? `Versão ${taxonomy.version} · atualizada por ${taxonomy.updatedBy} em ${fmtDateTime(taxonomy.updatedAt)}` : 'A IA só pode escolher entre os nomes desta lista.'}
            action={canEdit && <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setCats([...cats, { id: '', name: '', service: false, subcategories: [''] }])}>Categoria</Button>}
          >
            <div className="space-y-4">
              {cats.map((c, i) => (
                <div key={i} className="rounded-xl border border-linha p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Input className="flex-1 min-w-[200px] font-medium" value={c.name} disabled={!canEdit} onChange={(e) => setCat(i, { name: e.target.value })} placeholder="Nome da categoria" />
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input type="checkbox" className="accent-[#0072ce]" checked={c.service} disabled={!canEdit} onChange={(e) => setCat(i, { service: e.target.checked })} />
                      Conta como “atendimento”
                    </label>
                    {canEdit && <button className="text-slate-400 hover:text-red-600 p-1" aria-label="Remover categoria" onClick={() => setCats(cats.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {c.subcategories.map((s, k) => (
                      <div key={k} className="flex items-center gap-1">
                        <Input className="h-8 text-xs w-56" value={s} disabled={!canEdit} onChange={(e) => setCat(i, { subcategories: c.subcategories.map((x, m) => (m === k ? e.target.value : x)) })} placeholder="Subcategoria" />
                        {canEdit && c.subcategories.length > 1 && <button className="text-slate-400 hover:text-red-600" aria-label="Remover subcategoria" onClick={() => setCat(i, { subcategories: c.subcategories.filter((_, m) => m !== k) })}><XCircle className="size-4" /></button>}
                      </div>
                    ))}
                    {canEdit && <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setCat(i, { subcategories: [...c.subcategories, ''] })}>Subcategoria</Button>}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Produtos" action={canEdit && <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setProducts([...products, ''])}>Produto</Button>}>
            <div className="flex flex-wrap gap-2">
              {products.map((p, i) => (
                <div key={i} className="flex items-center gap-1">
                  <Input className="h-9 text-sm w-64" value={p} disabled={!canEdit} onChange={(e) => setProducts(products.map((x, j) => (j === i ? e.target.value : x)))} />
                  {canEdit && <button className="text-slate-400 hover:text-red-600" aria-label="Remover produto" onClick={() => setProducts(products.filter((_, j) => j !== i))}><XCircle className="size-4" /></button>}
                </div>
              ))}
            </div>
          </Card>

          <Alert tone="info">Renomear uma categoria não altera registros antigos — eles mantêm o nome usado na época. Para reclassificar, edite os registros no histórico.</Alert>
          <ErrorBox error={error} />
          {ok && <Alert tone="success">Configuração salva. As próximas análises já usam a lista nova.</Alert>}
          {canEdit ? (
            <div className="flex justify-end"><Button loading={saving} onClick={save}>Salvar configuração</Button></div>
          ) : <Badge tone="neutral">Somente administradores podem editar</Badge>}
        </div>
      </div>
    </>
  );
}

function Status({ ok, label, envs, extra }: { ok: boolean; label: string; envs: string[]; extra?: string }) {
  return (
    <li className="flex gap-3">
      {ok ? <CheckCircle2 className="size-5 text-emerald-600 shrink-0" /> : <XCircle className="size-5 text-amber-600 shrink-0" />}
      <div>
        <p className="font-medium text-petroleo">{label}</p>
        <p className="text-xs text-slate-500">{ok ? 'Configurado' : <>Falta configurar: <code>{envs.join(', ')}</code></>}</p>
        {extra && <p className="text-xs text-slate-500">{extra}</p>}
      </div>
    </li>
  );
}
