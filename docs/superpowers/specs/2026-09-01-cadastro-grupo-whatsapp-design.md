# Cadastro do cliente + grupo WhatsApp automático — Design

**Data:** 2026-09-01 · **Status:** aprovado por Felipe (desenho em chat), spec em revisão

## Objetivo

Substituir o PDF "Formulário de Cadastro" e a criação manual do grupo de WhatsApp por um
fluxo automático dentro do onboarding.pipeelo.com:

1. Felipe cria o link no `/admin` (como hoje) e manda pro cliente.
2. O cliente abre `/cadastro/:slug`, preenche os dados cadastrais, anexa os documentos e
   informa seu WhatsApp.
3. No envio, o sistema cria o grupo "Pipeelo & {nome fantasia}" na Evolution, coloca o
   contato principal como **admin**, manda a boas-vindas com o link do onboarding no
   grupo e avisa o Staff.
4. Ao concluir o onboarding, as pessoas da seção "Equipe e Acessos" entram no grupo.

Métrica: zero grupos criados à mão; tempo entre venda e link de onboarding no grupo cai
de horas para minutos.

## Decisões fechadas

| # | Decisão | Motivo |
|---|---|---|
| 1 | Link de cadastro **criado pelo admin**, autenticado por `slug + access_token` da sessão (mesmo `assertSessionAccess` dos demais endpoints). Sem página pública. | Só quem comprou recebe o link; evita estranho criando grupo no número da Pipeelo. |
| 2 | Grupo criado pela instância **Avisos** (número da Pipeelo). Contato principal do cliente vira **admin** do grupo. | É o número que já manda relatórios; o cliente pode adicionar gente sozinho. |
| 3 | Equipe completa entra **no fim** do onboarding (seção "Equipe e Acessos"), não no cadastro. Cadastro pede só o contato principal + até 2 extras opcionais. | Quem fecha a venda raramente sabe a equipe toda no dia 1. |
| 4 | Nome do grupo = `Pipeelo & {nome_fantasia}` (fallback `empresa_nome`). | Padrão que `findGroupByName` e o time já usam. |
| 5 | Geração do contrato e provisionamento de usuários continuam **manuais**. O cadastro só coleta e avisa. | Fora de escopo desta rodada. |
| 6 | Sem funções serverless novas na Vercel: os endpoints entram nos routers `api/sessions/[action].ts` e `api/admin/[action].ts` (limite de 12 funções do plano Hobby) e no `server/index.ts` (EasyPanel). | Restrição existente do repo. |

## Fluxo

```
/admin cria sessão ──► Felipe manda link /cadastro/{slug}?token=…
                                 │
                                 ▼
                     Cliente preenche 5 passos + envia
                                 │
              POST /api/sessions/cadastro-submit
                                 │
       ┌─────────────────────────┼─────────────────────────┐
       ▼                         ▼                         ▼
 salva cadastro           cria grupo Evolution        avisa Staff
 na sessão                + admin + boas-vindas       (grupo, docs, link admin)
                          + link curto do onboarding
                                 │
                                 ▼
                   Cliente responde onboarding (Identificação já vem preenchida)
                                 │
                        conclusão dos departamentos
                                 │
                 whatsapp-notify usa grupo_jid salvo
                 + adiciona equipe ao grupo + relatório no Staff
```

## Página `/cadastro/:slug`

Rota nova em `src/App.tsx`, página `src/pages/Cadastro.tsx`. Mesmo design system do
onboarding (Forest Floor + mint, Inter, uma etapa por tela, progresso visível). Estado
salvo em `localStorage` por slug para o cliente poder voltar depois.

Se a sessão já tem `cadastro_enviado_at`, a página mostra a tela de confirmação (com
link de convite do grupo) em vez do formulário.

### Passos e campos

| Passo | Campo | Tipo | Obrig. | Observação |
|---|---|---|---|---|
| 1 Empresa | `cnpj` | cnpj | sim | Ao completar 14 dígitos chama `POST /api/sessions/cnpj-lookup` (BrasilAPI, `api/_lib/brasilapi.ts` já existe) e preenche razão social e nome fantasia. Campos continuam editáveis. |
| | `razao_social` | text | sim | |
| | `nome_fantasia` | text | sim | Vira o nome do grupo. |
| | `inscricao_estadual` | text | sim | Aceita "Isento". |
| 2 Cobrança | `cobranca_email` | email | sim | |
| | `cobranca_telefone` | phone | sim | |
| | `dia_vencimento` | select 5/10/15/20/25 | sim | Pré-preenche com `dia_vencimento` da sessão se o admin já informou. |
| 3 Contrato | `contrato_email` | email | sim | Endereço para envio do contrato. |
| 4 Documentos | `doc_contrato_social` | upload (1+ arquivos) | sim | Contrato social ou última alteração. |
| | `doc_responsaveis` | upload (1+ arquivos) | sim | RG ou CNH dos responsáveis legais. O PDF listava "RG ou CNH" e "CNH" em dois itens; unificado. |
| 5 Responsável | `responsavel_nome` | text | sim | |
| | `responsavel_cargo` | text | sim | |
| | `responsavel_email` | email | sim | |
| | `responsavel_whatsapp` | phone | sim | Vira admin do grupo. |
| | `contatos_extras` | repeater (nome, whatsapp), máx. 2 | não | Entram no grupo como membros. |
| Aceite | `aceite_dados` | checkbox | sim | "Confirmo que os dados e documentos estão corretos." |

Upload: extensões `pdf, jpg, jpeg, png`, máx. 10 MB por arquivo. Reaproveita o endpoint
`upload-arquivo` com `departamento: 'cadastro'` — exige incluir `'cadastro'` em
`DEPARTAMENTOS` do schema de resposta e parametrizar extensões/limite por contexto em
`api/_lib/schemas/upload.ts` (hoje fixo em xlsx/xls/csv e 5 MB). Path no bucket
`onboarding-uploads`: `{session_id}/cadastro/{campo}/{timestamp}-{nome}`.

## Backend

### `POST /api/sessions/cadastro-submit`

Auth: `assertSessionAccess(slug, token)`. Rate limit: `createSessionLimiter()`.
Body validado por Zod (`api/_lib/schemas/cadastro.ts`). Idempotente: se
`cadastro_enviado_at` já existe, responde 200 com o estado atual sem recriar grupo.

Sequência, com o que cada falha faz:

1. **Salvar cadastro** na sessão (colunas novas, ver Banco). Falha → 500, nada mais roda.
2. **Criar grupo** via `createGroup(subject, participants)` em `api/_lib/evolution.ts`
   (`POST /group/create/{instance}`, retorna `groupJid` + `inviteCode`). Participantes:
   `responsavel_whatsapp` + `contatos_extras`, normalizados para `55DDDNÚMERO@s.whatsapp.net`.
   Grava `grupo_jid` e `grupo_invite_url`. Falha da Evolution → grava
   `grupo_erro`, responde 200 com `grupo: { status: 'erro' }`, avisa Staff. O cadastro
   fica salvo; admin recria depois pelo botão do `/admin`.
3. **Promover admin**: `updateParticipants(groupJid, 'promote', [responsavel])`. Falha
   não bloqueia; registra em `grupo_erro`.
4. **Conferir quem entrou**: `GET /group/participants` e comparar. Quem ficou de fora
   (privacidade "quem pode me adicionar") recebe o `inviteUrl` por e-mail
   (`sendTransactionalEmail`, template novo `cadastro-convite-grupo`) e a tela de
   confirmação mostra o mesmo link.
5. **Boas-vindas no grupo**: gera short link (mesma tabela `short_links` e helper do
   `_whatsapp-send-welcome.ts`, extraído para `api/_lib/short-links.ts`) e manda o
   `WELCOME_TEMPLATE` já existente. Marca `notificacao_boas_vindas_enviada_at`.
   Falha → não bloqueia; admin reenvia pelo botão existente "Enviar boas-vindas".
6. **Aviso no Staff** (`STAFF_GROUP_JID`, env nova no EasyPanel):

   ```
   📋 Cadastro recebido: {nome_fantasia}
   Grupo: {subject} ({criado ✅ | falhou ❌ motivo})
   Admin: {responsavel_nome} — {whatsapp}
   Documentos: {n} arquivos
   Contrato → {contrato_email} · Vencimento dia {dia}
   Painel: https://onboarding.pipeelo.com/admin?s={slug}
   ```

Resposta: `{ ok, grupo: { status: 'criado' | 'erro', jid?, invite_url?, nao_adicionados: [] } }`.

### `POST /api/sessions/cnpj-lookup`

Auth por `slug + token`. Chama `fetchCnpj` e devolve `{ razao_social, nome_fantasia }`.
Rate limit igual ao de criação de sessão. BrasilAPI fora do ar → 200 com campos vazios;
o cliente digita à mão.

### `POST /api/admin/cadastro-recriar-grupo`

Auth admin. Reexecuta os passos 2 a 6 para uma sessão com `grupo_erro`. Botão no
`/admin` ao lado de "Enviar boas-vindas".

### Cliente Evolution (`api/_lib/evolution.ts`)

Funções novas, todas com a mesma `getConfig()`:

- `createGroup(subject, participantJids)` → `{ groupJid, inviteCode }`
- `updateParticipants(groupJid, action, jids)` com `action: 'add' | 'promote'`
- `getParticipants(groupJid)` → lista de JIDs
- `getInviteUrl(groupJid)` → `https://chat.whatsapp.com/{code}`
- `toJid(phoneBr)` → normaliza `(43) 99666-1541` para `5543996661541@s.whatsapp.net`;
  rejeita número sem DDD ou com menos de 10 dígitos.

### Conclusão do onboarding (`api/_lib/whatsapp-notify.ts`)

- Se a sessão tem `grupo_jid`, usa direto. `findGroupByName` vira fallback para sessões
  antigas.
- Depois da mensagem de conclusão, nova etapa `addTeamToGroup(session)`: lê a resposta
  `equipe_pessoas` do `sac_geral`, filtra quem tem `whatsapp` preenchido e
  `adicionar_grupo === 'sim'`, chama `updateParticipants('add')`, confere com
  `getParticipants`, e manda no Staff:

  ```
  👥 Equipe adicionada ao grupo {subject}: {n} de {total}
  Não entraram (privacidade): {nomes} — convite enviado por e-mail
  ```

  Quem não entrou recebe o `inviteUrl` no e-mail informado na seção Equipe. Falhas aqui
  nunca desfazem o claim da notificação principal (mesma política atual).

## Onboarding existente

- **Identificação:** `Onboarding.tsx` já injeta pseudo-respostas `_session_*`. Passa a
  injetar também `_cadastro_cnpj`, `_cadastro_razao_social`, `_cadastro_nome_fantasia`.
  As perguntas `cnpj`, `razao_social` e `nome_fantasia` ganham `prefill_de: "_cadastro_*"`
  no `questions.json`; o renderer usa o valor como default quando a resposta ainda não
  existe. O cliente confirma ou corrige.
- **Equipe e Acessos:** o repeater `equipe_pessoas` ganha `whatsapp` (phone, opcional,
  largura 3) e `adicionar_grupo` (select sim/não, default sim, largura 3). Bump de
  `versao` do `questions.json` (3.5.0 → 3.6.0) e `total_perguntas`.
- **Admin (`AdminOnboarding.tsx`):** o botão "Copiar link" ganha a opção
  "Link de cadastro" (`/cadastro/{slug}?token=`). A linha da sessão mostra o estado do
  cadastro (pendente / enviado / grupo com erro) e o JID do grupo. Botão "Recriar grupo"
  quando `grupo_erro`.

## Banco (`supabase/migrations/20260901120000_cadastro_grupo_whatsapp.sql`)

Colunas novas em `onboarding_sessions`, todas nullable:

| Coluna | Tipo |
|---|---|
| `cadastro` | jsonb — todos os campos do formulário, incluindo metadata dos uploads |
| `cadastro_enviado_at` | timestamptz |
| `grupo_jid` | text |
| `grupo_invite_url` | text |
| `grupo_criado_at` | timestamptz |
| `grupo_erro` | text |
| `notificacao_boas_vindas_enviada_at` | timestamptz |

O `cadastro` fica em jsonb porque é lido inteiro (tela de confirmação, aviso no Staff,
contrato manual) e não filtra nada. `grupo_jid` fica em coluna própria porque a
notificação de conclusão consulta por ele. Índice único parcial em `grupo_jid`.

A RLS atual (fase 1) já bloqueia acesso anônimo à tabela; o front continua sem falar com
o banco (HARD-01 preservado).

## Envs novas (EasyPanel, serviço `onboarding-pipeelo`)

- `STAFF_GROUP_JID` — grupo Staff Pipeelo (`120363428470826804@g.us`).
- `PUBLIC_BASE_URL` — `https://onboarding.pipeelo.com`, para montar links nos e-mails.

`EVOLUTION_API_*` já existem.

## Testes

Vitest, seguindo os testes vizinhos (`api/sessions/*.test.ts`, `api/_lib/__tests__`):

- `cadastro-submit`: payload válido cria grupo, promove admin, salva colunas, manda
  boas-vindas e Staff (Evolution e Supabase mockados). Reenvio é idempotente. Evolution
  500 na criação → cadastro salvo, `grupo_erro` preenchido, Staff avisado, resposta 200.
  Participante ausente em `getParticipants` → e-mail de convite disparado.
- `evolution.toJid`: máscaras brasileiras, número sem DDD, número com 55 na frente.
- `whatsapp-notify.addTeamToGroup`: filtra por `adicionar_grupo`, ignora sem whatsapp,
  relata quem não entrou.
- `cnpj-lookup`: BrasilAPI ok, BrasilAPI fora (campos vazios), CNPJ inválido (400).
- Schema Zod do cadastro: obrigatórios, máx. 2 contatos extras, aceite obrigatório.

Verificação manual antes do deploy: sessão de teste no `/admin`, cadastro completo com o
número do Felipe, conferir grupo criado com ele como admin, boas-vindas no grupo, aviso
no Staff. Depois excluir o grupo de teste. Deploy pelo push em `main` (EasyPanel) e
conferir `build-info.json` com sonda `cadastro-grupo`.

## Fora de escopo

- Gerar o contrato automaticamente a partir do cadastro.
- Criar usuários e departamentos no admin.pipeelo.com.
- Ler o conteúdo dos documentos enviados (OCR, validação).
- Página pública de cadastro sem token.
- Migrar sessões antigas (sem `grupo_jid`) — continuam usando a busca por nome.
