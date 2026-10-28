// Configuração central lida das variáveis de ambiente + taxonomia padrão.

export const UNIDENTIFIED = 'Não identificado';
export const NEEDS_REVIEW = 'Revisão necessária';

export const KINDS = ['reclamacao', 'duvida', 'sugestao', 'elogio', 'informativo', 'nao_identificado'];
export const SEVERITIES = ['baixa', 'media', 'alta', 'critica', 'nao_identificado'];
export const SENTIMENTS = ['neutro', 'levemente_insatisfeito', 'insatisfeito', 'muito_insatisfeito', 'nao_identificado'];
export const VALIDATION_STATUSES = ['pendente', 'validado', 'revisao_necessaria'];
export const MATCH_STATUSES = ['vinculado', 'sem_vinculo'];
export const SOURCES = ['print_suporte', 'manual'];

export function env(name, fallback = undefined) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

export function isDemoMode() {
  return env('DEMO_MODE', 'false') === 'true';
}

export function settings() {
  return {
    demo: isDemoMode(),
    geminiKey: env('GEMINI_API_KEY'),
    geminiModel: env('GEMINI_MODEL', 'gemini-3.5-flash'),
    hubspotToken: env('HUBSPOT_ACCESS_TOKEN'),
    // "v3" usa os caminhos /crm/v3/...; uma data (ex.: "2026-09") usa /crm/objects/2026-09/...
    hubspotApiVersion: env('HUBSPOT_API_VERSION', 'v3'),
    hubspotPortalId: env('HUBSPOT_PORTAL_ID'),
    allowedDomain: env('ALLOWED_EMAIL_DOMAIN', 'nibo.com.br'),
    allowedEmails: listEnv('ALLOWED_EMAILS'),
    adminEmails: listEnv('ADMIN_EMAILS'),
    retentionDays: Number(env('IMAGE_RETENTION_DAYS', '90')),
    cronSecret: env('CRON_SECRET'),
    storageBucket: env('FIREBASE_STORAGE_BUCKET'),
  };
}

function listEnv(name) {
  return String(env(name, ''))
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Taxonomia inicial. É gravada no banco na primeira leitura e depois editada
 * pela tela "Configurações" — o código não depende destes nomes.
 * `service: true` marca categorias que contam como "reclamação de atendimento".
 */
export const DEFAULT_TAXONOMY = {
  version: 1,
  categories: [
    { id: 'produto', name: 'Problema no produto', service: false, subcategories: ['Erro técnico', 'Falha de funcionalidade', 'Lentidão ou instabilidade', 'Dados incorretos', 'Usabilidade'] },
    { id: 'atendimento', name: 'Atendimento e suporte', service: true, subcategories: ['Demora na resposta', 'Resolução insatisfatória', 'Falta de retorno', 'Postura do atendimento', 'Transferências ou repetição do problema'] },
    { id: 'cobranca', name: 'Cobrança e financeiro', service: false, subcategories: ['Cobrança indevida', 'Boleto ou pagamento', 'Cancelamento', 'Reajuste de preço'] },
    { id: 'integracoes', name: 'Integrações', service: false, subcategories: ['Integração bancária', 'Integração com órgãos do governo', 'Integração com outros sistemas'] },
    { id: 'funcionalidade', name: 'Funcionalidade ausente ou limitada', service: false, subcategories: ['Recurso inexistente', 'Limitação de recurso'] },
    { id: 'implantacao', name: 'Implantação e onboarding', service: false, subcategories: ['Configuração inicial', 'Treinamento'] },
    { id: 'outros', name: 'Outros', service: false, subcategories: ['Outros'] },
  ],
  // Lista inicial — ajuste em Configurações para os nomes oficiais dos produtos.
  products: ['Radar e-CAC', 'Nibo Contador', 'Nibo Gestão Financeira', 'Atendimento Nibo (WhatsApp)'],
};

export const LABELS = {
  kind: { reclamacao: 'Reclamação', duvida: 'Dúvida', sugestao: 'Sugestão', elogio: 'Elogio', informativo: 'Informativo', nao_identificado: UNIDENTIFIED },
  severity: { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica', nao_identificado: UNIDENTIFIED },
  sentiment: { neutro: 'Neutro', levemente_insatisfeito: 'Levemente insatisfeito', insatisfeito: 'Insatisfeito', muito_insatisfeito: 'Muito insatisfeito', nao_identificado: UNIDENTIFIED },
};
