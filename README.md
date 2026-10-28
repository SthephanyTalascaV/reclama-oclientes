# Inteligência de Reclamações — Nibo CS

Ferramenta interna que transforma prints de conversas com o suporte em registros estruturados, vinculados ao contato correto do HubSpot, com dashboard de indicadores.

## Arquitetura

```
Navegador (React + TS + Tailwind + Recharts)
   │  login Google (Firebase Auth) → envia ID token
   ▼
/api/*  →  api/index.js  (1 função serverless na Vercel, roteamento interno em server/app.js)
   ├── Firebase Admin: verifica o token, domínio @nibo.com.br
   ├── Gemini (multimodal): lê o print e devolve JSON validado por schema
   ├── HubSpot CRM (somente leitura): busca e pontua contatos
   ├── Firestore: reclamações, histórico de alterações, taxonomia
   └── Cloud Storage: prints (privados, links assinados de 10 min, retenção automática)
```

Decisões principais
- **Uma única função serverless** (`api/index.js`) — cabe no limite de funções da Vercel.
- **O navegador nunca acessa o banco direto.** As regras do Firestore e do Storage negam tudo; só a API (Admin SDK) lê e grava. Assim validação, histórico e deduplicação ficam garantidos num lugar só.
- **A IA só sugere.** A saída do modelo é revalidada no servidor contra a taxonomia; o que estiver fora vira "Não identificado"/"Revisão necessária". A análise volta assinada (HMAC) e o salvamento confere a assinatura — o "extraído pela IA" gravado é exatamente o que a IA produziu.
- **Três camadas de dado separadas em cada registro:** `ocrText` (texto original do print, imutável), `ai.output` (análise original da IA, imutável) e os campos atuais, com `fieldSources` dizendo campo a campo se veio da IA ou foi alterado por uma pessoa.
- **Os números do dashboard e as frases de "Leitura do período" são calculados no servidor** a partir dos registros (`server/lib/metrics.js`). Nenhum número é gerado por IA.

## Identificação do cliente no HubSpot

Endpoints usados (conferidos na documentação oficial — https://developers.hubspot.com/docs/api-reference/search/guide):

| Uso | Endpoint |
|---|---|
| Buscar contatos | `POST /crm/v3/objects/contacts/search` (`filterGroups` ou `query`) |
| Ler contato por ID | `GET /crm/v3/objects/contacts/{id}` |
| Empresas do contato | `GET /crm/v4/objects/contacts/{id}/associations/companies` |
| Nome das empresas | `POST /crm/v3/objects/companies/batch/read` |

Escopos do app privado: `crm.objects.contacts.read`, `crm.objects.companies.read`.

Ordem de busca: ID do contato → e-mail exato → telefone (token final do número nos campos `phone`, `mobilephone`, `hs_whatsapp_phone_number` + busca textual pelo número nacional) → nome completo.

Normalização de telefone: a chave é **DDD + 8 últimos dígitos**. No HubSpot do Nibo o mesmo número aparece como `+5551995010911`, `+55-61-99666-7677`, `16991581859`, e o WhatsApp às vezes sem o nono dígito (`+555195010911`) — todos geram a mesma chave.

Regra de decisão (`scoreCandidates`, testada):
- **confiável** — identificador forte (ID, e-mail ou telefone com DDD) e sem empate → vem pré‑selecionado, mas a pessoa confirma ao salvar.
- **ambíguo** — dois contatos com o mesmo identificador (acontece de verdade: contatos distintos compartilhando o mesmo telefone). Nada é sugerido; a pessoa escolhe.
- **possível** — só o nome bate. Exige escolha explícita.
- **sem correspondência** — pode salvar sem vínculo; o registro fica marcado `needsIdentificationReview`.

Antes de gravar um vínculo, a API confere se o contato existe no HubSpot.

## Banco de dados (Firestore)

```
config/taxonomy                      categorias, subcategorias (+ flag "conta como atendimento"), produtos, versão
complaints/{id}
  createdAt, updatedAt, createdBy{email,name}, source
  kind (reclamacao|duvida|sugestao|elogio|informativo|nao_identificado), isComplaint
  complaintDate (data da conversa, se visível)        → data de referência do dashboard (senão, createdAt)
  customer{name, phone, phoneE164, email, companyName}, phoneKey
  hubspot{status vinculado|sem_vinculo, needsIdentificationReview, contactId, contactName, companyId, companyName, url,
          matchDecision, matchScore, matchReasons, linkedBy, linkedAt}
  summary, problemDescription, reportedImpact
  classification{category, subcategory, product, feature, sentiment, severity}, serviceRelated
  ocrText                      texto original extraído (imutável)
  ai{model, analyzedAt, legibility, fieldsNeedingReview, kindReason, severityReason, evidence, output}   (imutável)
  fieldSources{campo: ia|usuario}
  validation{status pendente|validado|revisao_necessaria, by, at}
  images[{path, hash, mime, size, expiresAt, deleted}], imageHashes, imagesExpireAt
  recurrenceOf (id de outro registro — liga sem fundir), duplicateAcknowledged
  searchText (tokens para busca)
complaints/{id}/history/{hid}        at, by, action (criado|editado|imagens_removidas), changes[{field,from,to}], note
```

Duplicidade: o hash SHA‑256 de cada print é verificado na análise e de novo no salvamento (HTTP 409 até a pessoa confirmar que é um registro novo). Recorrência: a tela de revisão mostra reclamações anteriores do mesmo telefone/contato e permite marcar "recorrência de", mantendo os registros separados.

## Rodar localmente

Requer Node 20+.

```bash
npm install
npm run dev:demo     # MODO DEMONSTRAÇÃO: dados fictícios, sem login, IA e HubSpot simulados
# ou, com as credenciais reais em .env.local:
npm run dev          # API em :3001, interface em http://localhost:5173
```

No Windows/PowerShell, `dev:demo` usa sintaxe de shell Unix; rode assim:
```powershell
$env:DEMO_MODE="true"; node server/dev-server.js   # terminal 1
npx vite                                          # terminal 2
```

## Configuração (o que você precisa criar)

Copie `.env.example` para `.env.local` e preencha. Na Vercel, cadastre as mesmas variáveis em *Settings → Environment Variables*.

1. **Firebase** (console.firebase.google.com)
   - Crie o projeto (ou use um existente), ative **Authentication → Google**, **Firestore** (modo produção) e **Storage**.
   - Em *Authentication → Settings → Authorized domains*, adicione o domínio da Vercel.
   - *Configurações do projeto → Seus apps → Web*: copie apiKey, authDomain, projectId e appId para `VITE_FIREBASE_*`.
   - *Contas de serviço → Gerar nova chave privada*: converta o JSON em base64 e coloque em `FIREBASE_SERVICE_ACCOUNT_BASE64`. Nunca suba esse JSON no Git.
   - `FIREBASE_STORAGE_BUCKET` = nome do bucket (aparece na tela do Storage).
   - Publique as regras: `npx firebase-tools deploy --only firestore:rules,storage` (usa `firebase.json`).
2. **Gemini**: crie a chave em aistudio.google.com → `GEMINI_API_KEY`. `GEMINI_MODEL` padrão: `gemini-3.5-flash`.
3. **HubSpot**: crie um app privado (ou chave de serviço) com os 2 escopos de leitura acima → `HUBSPOT_ACCESS_TOKEN`. `HUBSPOT_PORTAL_ID` só monta o link do contato.
4. **Segurança**: `APP_SECRET` e `CRON_SECRET` com valores longos e aleatórios. `ADMIN_EMAILS` define quem edita categorias e exclui registros.

A tela **Configurações** mostra o status de cada integração e o nome exato da variável que falta.

## Publicar na Vercel

```bash
npm i -g vercel
vercel link
vercel env add ...      # ou pelo painel
vercel --prod
```
`vercel.json` já define: build do Vite, rewrites de `/api/*` para a função única, fallback SPA, headers de segurança e o **Cron diário** `/api/cron/retention` (a Vercel envia `Authorization: Bearer $CRON_SECRET`), que apaga prints vencidos e registra no histórico.

## Testes

```bash
npm test          # 14 testes: normalização de telefone, regra de correspondência, validação da saída da IA,
                  # fluxo completo da API (analisar → buscar → salvar → duplicidade → adulteração → editar → histórico → dashboard)
npm run build     # typecheck + build de produção
```

## Segurança e LGPD
- Login Google restrito ao domínio (`ALLOWED_EMAIL_DOMAIN`) + verificação do token no servidor a cada requisição.
- Nenhum segredo no frontend (variáveis `VITE_*` são só a configuração pública do Firebase).
- Prints em bucket privado, links assinados de 10 min, retenção configurável (`IMAGE_RETENTION_DAYS`, padrão 90). O texto extraído permanece — avalie com o jurídico se ele também precisa de prazo.
- Logs técnicos em JSON com `requestId`, sem PII (telefone mascarado). O código aparece nas mensagens de erro para facilitar suporte.
- Exclusão definitiva de registro (e prints) por administradores, para atender pedidos de titulares.

## Limitações conhecidas
- Busca e dashboard carregam até 5.000 registros e filtram no servidor — suficiente para o volume esperado; acima disso, migrar agregações para consultas indexadas ou BigQuery.
- Sem limite de requisições por usuário (rate limit) na API.
