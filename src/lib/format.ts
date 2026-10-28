export const fmtDate = (s?: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');

export const fmtDateTime = (s?: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const fmtNum = (n: number) => n.toLocaleString('pt-BR');

export const today = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso local

export function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
}

export function monthStart(iso: string, offset = 0) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleDateString('sv-SE');
}

export function monthEnd(iso: string) {
  const d = new Date(iso + 'T12:00:00');
  d.setMonth(d.getMonth() + 1, 0);
  return d.toLocaleDateString('sv-SE');
}

export const FIELD_LABELS: Record<string, string> = {
  kind: 'Tipo',
  complaintDate: 'Data da reclamação',
  customerName: 'Nome do cliente',
  customerPhone: 'Telefone',
  customerEmail: 'E-mail',
  companyName: 'Empresa (no print)',
  summary: 'Resumo',
  category: 'Categoria',
  subcategory: 'Subcategoria',
  product: 'Produto',
  feature: 'Funcionalidade afetada',
  problemDescription: 'Descrição do problema',
  reportedImpact: 'Impacto relatado',
  sentiment: 'Sentimento',
  severity: 'Gravidade',
  ocrText: 'Texto extraído',
  'hubspot.contactId': 'Contato no HubSpot',
  'validation.status': 'Status de validação',
  recurrenceOf: 'Recorrência de',
};

export const STATUS_LABELS: Record<string, string> = {
  pendente: 'Pendente',
  validado: 'Validado',
  revisao_necessaria: 'Revisão necessária',
  vinculado: 'Vinculado',
  sem_vinculo: 'Sem vínculo',
};

export const DECISION_LABELS: Record<string, string> = {
  confiavel: 'Correspondência confiável',
  ambiguo: 'Mais de um contato possível',
  possivel: 'Possível correspondência (só pelo nome)',
  sem_correspondencia: 'Nenhum contato encontrado',
};
