# Cadastro do cliente + grupo WhatsApp automático — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página `/cadastro/:slug` que coleta os dados cadastrais do cliente, cria o grupo "Pipeelo & {empresa}" na Evolution com o contato principal como admin, manda a boas-vindas com o link do onboarding e, no fim do onboarding, adiciona a equipe ao grupo.

**Architecture:** Front React (Vite) sem acesso ao banco (HARD-01) fala só com `/api/sessions/*`. Backend em handlers Vercel-style registrados nos routers `api/sessions/[action].ts`, `api/admin/[action].ts` e em `server/index.ts` (EasyPanel). Lógica de grupo isolada em `api/_lib/cadastro-grupo.ts`, reaproveitada pelo submit do cliente e pelo botão "Recriar grupo" do admin. Cliente Evolution em `api/_lib/evolution.ts` ganha as operações de grupo.

**Tech Stack:** React 18 + Vite + TypeScript, shadcn/ui, Zod, Supabase (service role no servidor), Evolution API v2 (instância Avisos), Resend + React Email, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-01-cadastro-grupo-whatsapp-design.md`

## Global Constraints

- Sem função serverless nova na Vercel: todo endpoint novo entra em `api/sessions/[action].ts` ou `api/admin/[action].ts` **e** em `server/index.ts`.
- Front nunca importa `supabase` diretamente (`npm run audit:no-supabase-from` tem que continuar passando).
- Nome do grupo: `Pipeelo & {nome_fantasia}`.
- Idioma de UI, commits e mensagens: pt-BR. Voz Pipeelo: calma, direta, sem hype.
- Tom das mensagens de WhatsApp para o cliente: sem jargão interno.
- Upload do cadastro: extensões `pdf, jpg, jpeg, png`, máx. 10 MB por arquivo, bucket `onboarding-uploads`.
- Contatos extras no cadastro: máximo 2.
- Envs novas: `STAFF_GROUP_JID`, `PUBLIC_BASE_URL`. Já existentes: `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_INSTANCE`, `EVOLUTION_API_KEY`.
- Commits pequenos, mensagem `tipo: descrição` em pt-BR. Working tree tem lixo de outras sessões (`.planning/`, `package-lock.json`): faça `git add` só dos arquivos da tarefa.
- Rodar `npm test` (Vitest) antes de cada commit. Rodar `npm run build` antes do commit final.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260901120000_cadastro_grupo_whatsapp.sql` | Colunas novas em `onboarding_sessions` |
| `api/_lib/schemas/cadastro.ts` | Zod do cadastro + tipo `Cadastro` |
| `api/_lib/evolution.ts` | + `toJid`, `createGroup`, `updateParticipants`, `getParticipants`, `getInviteUrl` |
| `api/_lib/short-links.ts` | `ensureShortLink` extraído do welcome/short-links-create |
| `api/_lib/welcome-template.ts` | `WELCOME_TEMPLATE` extraído |
| `api/_lib/staff-notify.ts` | `notifyStaff(text)` |
| `api/_lib/cadastro-grupo.ts` | `criarGrupoParaSessao` (cria grupo, promove, confere, boas-vindas, Staff) |
| `api/_lib/equipe-grupo.ts` | `addTeamToGroup` usado na conclusão |
| `api/_lib/whatsapp-notify.ts` | usa `grupo_jid` salvo + chama `addTeamToGroup` |
| `api/_lib/schemas/upload.ts` + `api/sessions/_upload-arquivo.ts` | contexto `cadastro` (pdf/imagem, 10 MB) |
| `api/sessions/_cnpj-lookup.ts` | lookup autenticado por slug+token |
| `api/sessions/_cadastro-submit.ts` | handler do envio |
| `api/admin/_cadastro-recriar-grupo.ts` | reexecuta criação do grupo |
| `src/emails/ConviteGrupo.tsx` + `api/_lib/email-sender.ts` | e-mail com link de convite |
| `src/lib/phone.ts` | `maskPhone` compartilhado |
| `src/lib/api-client.ts` | `sessionApi.cnpjLookup`, `sessionApi.cadastroSubmit`, `adminSessionApi.recriarGrupo`, `SessionDTO` |
| `src/pages/Cadastro.tsx` + `src/components/cadastro/UploadMultiplo.tsx` | página de cadastro |
| `src/App.tsx` | rota `/cadastro/:slug` |
| `src/pages/AdminOnboarding.tsx` | link de cadastro, estado do grupo, botão recriar |
| `src/lib/questions.json` + `src/components/onboarding/QuestionRenderer.tsx` | campos `whatsapp` e `adicionar_grupo` na equipe; `phone` no repeater |
| `src/pages/Onboarding.tsx` | prefill da Identificação a partir do cadastro |
| `server/index.ts`, `api/sessions/[action].ts`, `api/admin/[action].ts` | rotas |
| `public/build-info.json` | sonda de deploy |

---

### Task 1: Migration, schema Zod do cadastro e tipos do front

**Files:**
- Create: `supabase/migrations/20260901120000_cadastro_grupo_whatsapp.sql`
- Create: `api/_lib/schemas/cadastro.ts`
- Test: `api/_lib/__tests__/schemas-cadastro.test.ts`
- Modify: `src/lib/api-client.ts` (tipo `SessionDTO`)

**Interfaces:**
- Produces: `CadastroSchema`, `CadastroSubmitSchema`, `PhoneBrSchema`, `UploadMetaSchema`, tipos `Cadastro`, `UploadMeta`, `DIAS_VENCIMENTO`.
- Produces: campos novos em `SessionDTO`: `cadastro`, `cadastro_enviado_at`, `grupo_jid`, `grupo_invite_url`, `grupo_criado_at`, `grupo_erro`, `notificacao_boas_vindas_enviada_at`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Cadastro do cliente (formulário /cadastro/:slug) + grupo WhatsApp criado pela Evolution.
-- `cadastro` guarda o formulário inteiro (lido sempre por completo). `grupo_jid` em coluna
-- própria porque a notificação de conclusão consulta por ele.
ALTER TABLE public.onboarding_sessions
  ADD COLUMN IF NOT EXISTS cadastro jsonb,
  ADD COLUMN IF NOT EXISTS cadastro_enviado_at timestamptz,
  ADD COLUMN IF NOT EXISTS grupo_jid text,
  ADD COLUMN IF NOT EXISTS grupo_invite_url text,
  ADD COLUMN IF NOT EXISTS grupo_criado_at timestamptz,
  ADD COLUMN IF NOT EXISTS grupo_erro text,
  ADD COLUMN IF NOT EXISTS notificacao_boas_vindas_enviada_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_sessions_grupo_jid_uidx
  ON public.onboarding_sessions (grupo_jid)
  WHERE grupo_jid IS NOT NULL;
```

- [ ] **Step 2: Escrever o teste do schema (falha porque o módulo não existe)**

```ts
// api/_lib/__tests__/schemas-cadastro.test.ts
import { describe, it, expect } from 'vitest';
import { CadastroSchema, PhoneBrSchema } from '../schemas/cadastro';

const upload = { path: 'sess/cadastro/doc/1-a.pdf', nome_original: 'a.pdf', tamanho: 10 };

const valido = {
  cnpj: '11.222.333/0001-81',
  razao_social: 'Provedor Exemplo Ltda',
  nome_fantasia: 'Provedor Exemplo',
  inscricao_estadual: 'Isento',
  cobranca_email: 'financeiro@exemplo.com.br',
  cobranca_telefone: '(43) 3322-1100',
  dia_vencimento: 10,
  contrato_email: 'juridico@exemplo.com.br',
  doc_contrato_social: [upload],
  doc_responsaveis: [upload],
  responsavel_nome: 'Ana Souza',
  responsavel_cargo: 'Diretora',
  responsavel_email: 'ana@exemplo.com.br',
  responsavel_whatsapp: '(43) 99666-1541',
  contatos_extras: [{ nome: 'João', whatsapp: '(43) 99111-2233' }],
  aceite_dados: true,
};

describe('PhoneBrSchema', () => {
  it('normaliza máscara brasileira para dígitos', () => {
    expect(PhoneBrSchema.parse('(43) 99666-1541')).toBe('43996661541');
  });
  it('remove o 55 da frente', () => {
    expect(PhoneBrSchema.parse('+55 43 99666-1541')).toBe('43996661541');
  });
  it('rejeita sem DDD', () => {
    expect(() => PhoneBrSchema.parse('996661541')).toThrow();
  });
});

describe('CadastroSchema', () => {
  it('aceita payload completo e normaliza cnpj e e-mails', () => {
    const r = CadastroSchema.parse(valido);
    expect(r.cnpj).toBe('11222333000181');
    expect(r.cobranca_email).toBe('financeiro@exemplo.com.br');
    expect(r.responsavel_whatsapp).toBe('43996661541');
  });
  it('rejeita mais de 2 contatos extras', () => {
    const extras = [1, 2, 3].map((i) => ({ nome: `P${i}`, whatsapp: '(43) 99111-223' + i }));
    expect(() => CadastroSchema.parse({ ...valido, contatos_extras: extras })).toThrow();
  });
  it('exige aceite', () => {
    expect(() => CadastroSchema.parse({ ...valido, aceite_dados: false })).toThrow();
  });
  it('exige ao menos 1 documento de cada', () => {
    expect(() => CadastroSchema.parse({ ...valido, doc_contrato_social: [] })).toThrow();
  });
  it('rejeita dia de vencimento fora da lista', () => {
    expect(() => CadastroSchema.parse({ ...valido, dia_vencimento: 12 })).toThrow();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run api/_lib/__tests__/schemas-cadastro.test.ts`
Expected: FAIL — "Cannot find module '../schemas/cadastro'".

- [ ] **Step 4: Implementar o schema**

```ts
// api/_lib/schemas/cadastro.ts
import { z } from 'zod';
import { CnpjSchema, EmailSchema } from './identificacao';

export const DIAS_VENCIMENTO = [5, 10, 15, 20, 25] as const;

/**
 * Telefone BR em dígitos: DDD(2) + 8 ou 9 dígitos. Aceita máscara, espaços,
 * +55 na frente. Saída: "43996661541".
 */
export const PhoneBrSchema = z
  .string()
  .transform((s) => {
    let d = s.replace(/\D/g, '');
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
    return d;
  })
  .refine((d) => d.length === 10 || d.length === 11, 'telefone_invalido');

export const UploadMetaSchema = z.object({
  path: z.string().min(1),
  nome_original: z.string().min(1).max(200),
  tamanho: z.number().int().positive(),
});
export type UploadMeta = z.infer<typeof UploadMetaSchema>;

export const ContatoExtraSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  whatsapp: PhoneBrSchema,
});

export const CadastroSchema = z.object({
  cnpj: CnpjSchema,
  razao_social: z.string().trim().min(3).max(200),
  nome_fantasia: z.string().trim().min(2).max(120),
  inscricao_estadual: z.string().trim().min(2).max(40),
  cobranca_email: EmailSchema,
  cobranca_telefone: PhoneBrSchema,
  dia_vencimento: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(25)]),
  contrato_email: EmailSchema,
  doc_contrato_social: z.array(UploadMetaSchema).min(1).max(10),
  doc_responsaveis: z.array(UploadMetaSchema).min(1).max(10),
  responsavel_nome: z.string().trim().min(3).max(120),
  responsavel_cargo: z.string().trim().min(2).max(80),
  responsavel_email: EmailSchema,
  responsavel_whatsapp: PhoneBrSchema,
  contatos_extras: z.array(ContatoExtraSchema).max(2).default([]),
  aceite_dados: z.literal(true),
});
export type Cadastro = z.infer<typeof CadastroSchema>;

export const CadastroSubmitSchema = z.object({
  slug: z.string().min(1),
  token: z.string().min(16),
  cadastro: CadastroSchema,
});
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run api/_lib/__tests__/schemas-cadastro.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 6: Adicionar os campos ao `SessionDTO`**

Em `src/lib/api-client.ts`, dentro de `SessionDTO`, antes de `created_at?: string;`:

```ts
  cadastro?: Record<string, unknown> | null;
  cadastro_enviado_at?: string | null;
  grupo_jid?: string | null;
  grupo_invite_url?: string | null;
  grupo_criado_at?: string | null;
  grupo_erro?: string | null;
  notificacao_boas_vindas_enviada_at?: string | null;
```

- [ ] **Step 7: Aplicar a migration no Supabase do projeto**

Rodar via MCP `supabase` (projeto do onboarding, ref `nhnz…`, o mesmo do bucket `onboarding-uploads`) o SQL do Step 1. Conferir:

```sql
select column_name from information_schema.columns
 where table_name='onboarding_sessions' and column_name in ('cadastro','grupo_jid','grupo_erro');
```
Expected: 3 linhas.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260901120000_cadastro_grupo_whatsapp.sql api/_lib/schemas/cadastro.ts api/_lib/__tests__/schemas-cadastro.test.ts src/lib/api-client.ts
git commit -m "feat(cadastro): migration e schema Zod do cadastro do cliente"
```

---

### Task 2: Operações de grupo no cliente Evolution

**Files:**
- Modify: `api/_lib/evolution.ts`
- Test: `api/_lib/__tests__/evolution-grupo.test.ts`

**Interfaces:**
- Produces:
  - `toJid(phoneDigits: string): string` — `"43996661541"` → `"5543996661541@s.whatsapp.net"`; lança `Error('telefone_invalido')` se não tiver 10 ou 11 dígitos.
  - `createGroup(subject: string, participants: string[]): Promise<{ groupJid: string; inviteCode: string | null }>`
  - `updateParticipants(groupJid: string, action: 'add' | 'promote', participants: string[]): Promise<void>`
  - `getParticipants(groupJid: string): Promise<string[]>` — JIDs.
  - `getInviteUrl(groupJid: string): Promise<string>`
  - `groupSubject(nomeFantasia: string): string` — `"Pipeelo & Provedor"`.

- [ ] **Step 1: Escrever os testes (mock de `fetch`)**

```ts
// api/_lib/__tests__/evolution-grupo.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  toJid, groupSubject, createGroup, updateParticipants, getParticipants, getInviteUrl,
  EvolutionApiError,
} from '../evolution';

const ENV = { EVOLUTION_API_BASE_URL: 'https://evo.test/', EVOLUTION_API_INSTANCE: 'Avisos', EVOLUTION_API_KEY: 'k' };

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({
    ok: status < 400, status,
    json: async () => body, text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('evolution grupo', () => {
  beforeEach(() => { Object.assign(process.env, ENV); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('toJid monta o JID com 55', () => {
    expect(toJid('43996661541')).toBe('5543996661541@s.whatsapp.net');
    expect(toJid('4333221100')).toBe('554333221100@s.whatsapp.net');
  });
  it('toJid rejeita número curto', () => {
    expect(() => toJid('99666')).toThrow('telefone_invalido');
  });
  it('groupSubject aplica o padrão', () => {
    expect(groupSubject('  Provedor X ')).toBe('Pipeelo & Provedor X');
  });

  it('createGroup chama /group/create e lê groupJid', async () => {
    const f = mockFetch(201, { groupJid: '1@g.us', inviteCode: 'abc' });
    const r = await createGroup('Pipeelo & X', ['5543996661541@s.whatsapp.net']);
    expect(r).toEqual({ groupJid: '1@g.us', inviteCode: 'abc' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://evo.test/group/create/Avisos');
    expect(JSON.parse(String(init.body))).toEqual({
      subject: 'Pipeelo & X', participants: ['5543996661541@s.whatsapp.net'],
    });
  });
  it('createGroup aceita resposta no formato metadata (id)', async () => {
    mockFetch(201, { id: '2@g.us', subject: 'x' });
    const r = await createGroup('x', []);
    expect(r).toEqual({ groupJid: '2@g.us', inviteCode: null });
  });
  it('createGroup propaga erro HTTP', async () => {
    mockFetch(500, { message: 'boom' });
    await expect(createGroup('x', [])).rejects.toBeInstanceOf(EvolutionApiError);
  });

  it('updateParticipants usa PUT /group/updateParticipant com groupJid na query', async () => {
    const f = mockFetch(200, {});
    await updateParticipants('1@g.us', 'promote', ['a@s.whatsapp.net']);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://evo.test/group/updateParticipant/Avisos?groupJid=1%40g.us');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ action: 'promote', participants: ['a@s.whatsapp.net'] });
  });

  it('getParticipants devolve só os JIDs', async () => {
    mockFetch(200, { participants: [{ id: 'a@s.whatsapp.net', admin: 'admin' }, { id: 'b@s.whatsapp.net' }] });
    expect(await getParticipants('1@g.us')).toEqual(['a@s.whatsapp.net', 'b@s.whatsapp.net']);
  });
  it('getParticipants aceita array puro', async () => {
    mockFetch(200, [{ id: 'a@s.whatsapp.net' }]);
    expect(await getParticipants('1@g.us')).toEqual(['a@s.whatsapp.net']);
  });

  it('getInviteUrl monta URL a partir do inviteCode', async () => {
    mockFetch(200, { inviteCode: 'XyZ' });
    expect(await getInviteUrl('1@g.us')).toBe('https://chat.whatsapp.com/XyZ');
  });
  it('getInviteUrl prefere inviteUrl quando vem pronto', async () => {
    mockFetch(200, { inviteCode: 'XyZ', inviteUrl: 'https://chat.whatsapp.com/XyZ' });
    expect(await getInviteUrl('1@g.us')).toBe('https://chat.whatsapp.com/XyZ');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run api/_lib/__tests__/evolution-grupo.test.ts`
Expected: FAIL — `toJid` não exportado.

- [ ] **Step 3: Implementar no fim de `api/_lib/evolution.ts`**

```ts
// ---- Grupos ---------------------------------------------------------------

export function toJid(phoneDigits: string): string {
  const d = phoneDigits.replace(/\D/g, '');
  if (d.length !== 10 && d.length !== 11) throw new Error('telefone_invalido');
  return `55${d}@s.whatsapp.net`;
}

export function groupSubject(nomeFantasia: string): string {
  return `Pipeelo & ${nomeFantasia.trim().replace(/\s+/g, ' ')}`;
}

async function evoRequest<T>(path: string, init: RequestInit & { query?: Record<string, string> } = {}): Promise<T> {
  const { baseUrl, instance, apiKey } = getConfig();
  const qs = init.query ? '?' + new URLSearchParams(init.query).toString() : '';
  const url = `${baseUrl}/${path}/${encodeURIComponent(instance)}${qs}`;
  const r = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    body: init.body,
  });
  if (!r.ok) throw new EvolutionApiError(r.status, await r.text());
  return (await r.json()) as T;
}

/**
 * POST /group/create/{instance}. A Evolution v2 responde ora `{ groupJid, inviteCode }`,
 * ora o metadata do grupo (`{ id, subject, ... }`). Aceitamos os dois.
 */
export async function createGroup(
  subject: string,
  participants: string[]
): Promise<{ groupJid: string; inviteCode: string | null }> {
  const data = await evoRequest<{ groupJid?: string; id?: string; inviteCode?: string }>('group/create', {
    method: 'POST',
    body: JSON.stringify({ subject, participants }),
  });
  const groupJid = data.groupJid ?? data.id;
  if (!groupJid) throw new EvolutionApiError(502, 'group_create_sem_jid');
  return { groupJid, inviteCode: data.inviteCode ?? null };
}

export async function updateParticipants(
  groupJid: string,
  action: 'add' | 'promote',
  participants: string[]
): Promise<void> {
  if (participants.length === 0) return;
  await evoRequest('group/updateParticipant', {
    method: 'PUT',
    query: { groupJid },
    body: JSON.stringify({ action, participants }),
  });
}

export async function getParticipants(groupJid: string): Promise<string[]> {
  const data = await evoRequest<{ participants?: Array<{ id: string }> } | Array<{ id: string }>>(
    'group/participants',
    { query: { groupJid } }
  );
  const list = Array.isArray(data) ? data : data.participants ?? [];
  return list.map((p) => p.id);
}

export async function getInviteUrl(groupJid: string): Promise<string> {
  const data = await evoRequest<{ inviteCode?: string; inviteUrl?: string }>('group/inviteCode', {
    query: { groupJid },
  });
  if (data.inviteUrl) return data.inviteUrl;
  if (!data.inviteCode) throw new EvolutionApiError(502, 'invite_code_vazio');
  return `https://chat.whatsapp.com/${data.inviteCode}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run api/_lib/__tests__/evolution-grupo.test.ts`
Expected: PASS (11 testes).

- [ ] **Step 5: Commit**

```bash
git add api/_lib/evolution.ts api/_lib/__tests__/evolution-grupo.test.ts
git commit -m "feat(evolution): criar grupo, participantes, promover admin e link de convite"
```

---

### Task 3: Extrair short link e template de boas-vindas para `_lib`

**Files:**
- Create: `api/_lib/short-links.ts`
- Create: `api/_lib/welcome-template.ts`
- Modify: `api/admin/_whatsapp-send-welcome.ts`
- Modify: `api/admin/_short-links-create.ts`
- Test: `api/_lib/__tests__/short-links.test.ts`

**Interfaces:**
- Produces: `ensureShortLink(supabase, { session_id, modo, target_url, host?, proto? }): Promise<{ code: string; short_url: string }>`
- Produces: `WELCOME_TEMPLATE(link: string): string`, `onboardingTargetUrl({ slug, access_token, modo }): string`

- [ ] **Step 1: Escrever o teste**

```ts
// api/_lib/__tests__/short-links.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ensureShortLink, onboardingTargetUrl } from '../short-links';

function makeSupabase(existing: { code: string; target_url: string } | null, insertErr: { code: string } | null = null) {
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  const insert = vi.fn(async () => ({ error: insertErr }));
  const maybeSingle = vi.fn(async () => ({ data: existing, error: null }));
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle, update, insert };
  const from = vi.fn(() => chain);
  return { client: { from } as never, chain };
}

describe('ensureShortLink', () => {
  it('reaproveita o code existente e atualiza o target se mudou', async () => {
    const s = makeSupabase({ code: 'abc123', target_url: 'https://old' });
    const r = await ensureShortLink(s.client, { session_id: 'x', modo: 'completo', target_url: 'https://new' });
    expect(r).toEqual({ code: 'abc123', short_url: 'https://onboarding.pipeelo.com/s/abc123' });
    expect(s.chain.update).toHaveBeenCalledWith({ target_url: 'https://new' });
  });
  it('gera code novo de 6 chars quando não existe', async () => {
    const s = makeSupabase(null);
    const r = await ensureShortLink(s.client, { session_id: 'x', modo: 'completo', target_url: 'https://t', host: 'h.test', proto: 'http' });
    expect(r.code).toHaveLength(6);
    expect(r.short_url).toBe(`http://h.test/s/${r.code}`);
    expect(s.chain.insert).toHaveBeenCalled();
  });
  it('propaga erro que não é colisão', async () => {
    const s = makeSupabase(null, { code: '42P01' });
    await expect(ensureShortLink(s.client, { session_id: 'x', modo: 'completo', target_url: 'https://t' })).rejects.toBeTruthy();
  });
});

describe('onboardingTargetUrl', () => {
  it('monta URL completa com token', () => {
    expect(onboardingTargetUrl({ slug: 'abc', access_token: 'tok', modo: 'completo' }))
      .toBe('https://onboarding.pipeelo.com/abc?token=tok');
    expect(onboardingTargetUrl({ slug: 'abc', access_token: 'tok', modo: 'comercial' }))
      .toBe('https://onboarding.pipeelo.com/comercial/abc?token=tok');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run api/_lib/__tests__/short-links.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Criar `api/_lib/short-links.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem 0/o/O/1/l/I
const CODE_LEN = 6;
const MAX_RETRIES = 5;

export function generateCode(len = CODE_LEN): string {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

export type Modo = 'completo' | 'comercial';

export function onboardingTargetUrl(s: { slug: string; access_token?: string | null; modo: Modo }): string {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '') || 'https://onboarding.pipeelo.com';
  const path = s.modo === 'comercial' ? `comercial/${s.slug}` : s.slug;
  return s.access_token ? `${base}/${path}?token=${s.access_token}` : `${base}/${path}`;
}

/**
 * Idempotente por (session_id, modo): devolve o mesmo code se já existe (atualizando
 * o target se mudou); senão insere um code novo, tentando de novo em colisão (23505).
 */
export async function ensureShortLink(
  supabase: SupabaseClient,
  input: { session_id: string; modo: Modo; target_url: string; host?: string; proto?: string }
): Promise<{ code: string; short_url: string }> {
  const host = input.host ?? 'onboarding.pipeelo.com';
  const proto = input.proto ?? 'https';

  const { data: existing, error: existingErr } = await supabase
    .from('short_links')
    .select('code, target_url')
    .eq('session_id', input.session_id)
    .eq('modo', input.modo)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing) {
    if (existing.target_url !== input.target_url) {
      await supabase.from('short_links').update({ target_url: input.target_url }).eq('code', existing.code);
    }
    return { code: existing.code, short_url: `${proto}://${host}/s/${existing.code}` };
  }

  for (let i = 0; i < MAX_RETRIES; i++) {
    const candidate = generateCode();
    const { error } = await supabase.from('short_links').insert({
      code: candidate, target_url: input.target_url, session_id: input.session_id, modo: input.modo,
    });
    if (!error) return { code: candidate, short_url: `${proto}://${host}/s/${candidate}` };
    if ((error as { code?: string }).code !== '23505') throw error;
  }
  throw new Error('shortlink_generation_failed');
}
```

- [ ] **Step 4: Criar `api/_lib/welcome-template.ts`** movendo o `WELCOME_TEMPLATE` de `api/admin/_whatsapp-send-welcome.ts` sem alterar o texto:

```ts
export const WELCOME_TEMPLATE = (link: string) => `🎉 *Parabéns pela decisão!*

Seja muito bem-vindo(a) à Pipeelo! A partir de agora você dá um grande passo na *automatização do seu provedor* — e a gente vai trilhar esse caminho junto com você.

O *primeiro passo* dessa jornada é o preenchimento do formulário de onboarding. É com base nessas informações que a sua inteligência artificial vai ser treinada e personalizada pro seu provedor.

🔗 *Link do formulário:* ${link}

Você pode preencher tudo de uma vez ou no seu ritmo — as informações ficam salvas automaticamente.

Logo após a finalização, você receberá as informações sobre os próximos passos. 🚀`;
```

- [ ] **Step 5: Refatorar `_whatsapp-send-welcome.ts`**

Remover `ALPHABET`, `CODE_LEN`, `generateCode`, `WELCOME_TEMPLATE` e o bloco "2. Resolver/criar shortlink". Importar `ensureShortLink, onboardingTargetUrl` de `../_lib/short-links` e `WELCOME_TEMPLATE` de `../_lib/welcome-template`. O trecho vira:

```ts
    const targetUrl = onboardingTargetUrl({
      slug: session.slug,
      access_token: (session as { access_token?: string }).access_token,
      modo,
    });
    const { short_url: shortUrl } = await ensureShortLink(supabase, {
      session_id, modo, target_url: targetUrl,
      host: req.headers.host, proto: req.headers['x-forwarded-proto'] as string | undefined,
    });
```

Depois dele continua o passo "3. Buscar grupo" e "4. Mandar mensagem" como estão, **mas** se a sessão tiver `grupo_jid` (adicionar `grupo_jid` ao `select`), usar esse JID em vez de `findGroupByName`:

```ts
    const grupoJid = (session as { grupo_jid?: string | null }).grupo_jid;
    const group = grupoJid
      ? { id: grupoJid, subject: `(grupo salvo) ${session.empresa_nome}` }
      : await findGroupByName(session.empresa_nome);
```

- [ ] **Step 6: Refatorar `_short-links-create.ts`** para usar `ensureShortLink` (mantém a atualização do `modo` da sessão e a resposta `{ code, short_url }`). Remover `generateCode` local.

- [ ] **Step 7: Rodar toda a suíte**

Run: `npx vitest run`
Expected: PASS. Se houver teste antigo de `_whatsapp-send-welcome`/`_short-links-create` mockando `short_links`, ajustar o mock ao encadeamento usado por `ensureShortLink`.

- [ ] **Step 8: Commit**

```bash
git add api/_lib/short-links.ts api/_lib/welcome-template.ts api/_lib/__tests__/short-links.test.ts api/admin/_whatsapp-send-welcome.ts api/admin/_short-links-create.ts
git commit -m "refactor(admin): extrai short link e template de boas-vindas para _lib"
```

---

### Task 4: Aviso no Staff e e-mail de convite

**Files:**
- Create: `api/_lib/staff-notify.ts`
- Create: `src/emails/ConviteGrupo.tsx`
- Modify: `api/_lib/email-sender.ts`
- Test: `api/_lib/__tests__/staff-notify.test.ts`, `src/emails/__tests__/ConviteGrupo.test.tsx`

**Interfaces:**
- Produces: `notifyStaff(text: string): Promise<{ sent: boolean; reason?: string }>` — no-op com `console.warn` se `STAFF_GROUP_JID` faltar; nunca lança.
- Produces: template `ConviteGrupo` com props `{ nome: string; empresaNome: string; grupoNome: string; inviteUrl: string }`, registrado em `EmailTemplate`.

- [ ] **Step 1: Teste do `notifyStaff`**

```ts
// api/_lib/__tests__/staff-notify.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../evolution', () => ({ sendText: vi.fn(async () => ({ ok: true })) }));
import { sendText } from '../evolution';
import { notifyStaff } from '../staff-notify';

describe('notifyStaff', () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env.STAFF_GROUP_JID; });

  it('pula sem STAFF_GROUP_JID', async () => {
    const r = await notifyStaff('oi');
    expect(r).toEqual({ sent: false, reason: 'staff_jid_unset' });
    expect(sendText).not.toHaveBeenCalled();
  });
  it('envia para o JID configurado', async () => {
    process.env.STAFF_GROUP_JID = '1@g.us';
    const r = await notifyStaff('oi');
    expect(r).toEqual({ sent: true });
    expect(sendText).toHaveBeenCalledWith('1@g.us', 'oi');
  });
  it('não lança quando a Evolution falha', async () => {
    process.env.STAFF_GROUP_JID = '1@g.us';
    (sendText as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('x'));
    const r = await notifyStaff('oi');
    expect(r).toEqual({ sent: false, reason: 'send_failed' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run api/_lib/__tests__/staff-notify.test.ts` → módulo não existe.

- [ ] **Step 3: Criar `api/_lib/staff-notify.ts`**

```ts
import { sendText } from './evolution';

/** Aviso interno no grupo Staff Pipeelo. Nunca lança: aviso é acessório. */
export async function notifyStaff(text: string): Promise<{ sent: boolean; reason?: string }> {
  const jid = process.env.STAFF_GROUP_JID;
  if (!jid) {
    console.warn('[staff-notify] STAFF_GROUP_JID não configurado; aviso pulado');
    return { sent: false, reason: 'staff_jid_unset' };
  }
  try {
    await sendText(jid, text);
    return { sent: true };
  } catch (e) {
    console.error('[staff-notify] falhou:', e);
    return { sent: false, reason: 'send_failed' };
  }
}
```

- [ ] **Step 4: Teste do template de e-mail**

```tsx
// src/emails/__tests__/ConviteGrupo.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@react-email/render';
import * as React from 'react';
import ConviteGrupo from '../ConviteGrupo';

describe('ConviteGrupo', () => {
  it('renderiza nome, grupo e link', async () => {
    const html = await render(
      <ConviteGrupo nome="Ana" empresaNome="Provedor X" grupoNome="Pipeelo & Provedor X" inviteUrl="https://chat.whatsapp.com/abc" />
    );
    expect(html).toContain('Ana');
    expect(html).toContain('Pipeelo &amp; Provedor X');
    expect(html).toContain('https://chat.whatsapp.com/abc');
  });
});
```

- [ ] **Step 5: Criar `src/emails/ConviteGrupo.tsx`** (mesmo padrão do `WelcomeCEO`)

```tsx
import { Button, Text, Heading } from '@react-email/components';
import * as React from 'react';
import { Layout } from './_shared/Layout';
import { EMAIL_COLORS } from './_shared/tokens';

export interface ConviteGrupoProps {
  nome: string;
  empresaNome: string;
  grupoNome: string;
  inviteUrl: string;
}

const text = { color: EMAIL_COLORS.ink, fontSize: '16px', lineHeight: '24px', margin: '0 0 16px' } as const;

/**
 * ConviteGrupo — enviado quando o WhatsApp da pessoa não pôde ser adicionado ao grupo
 * pela API (configuração de privacidade). Um único link primário: o convite.
 */
export function ConviteGrupo({ nome, empresaNome, grupoNome, inviteUrl }: ConviteGrupoProps) {
  return (
    <Layout preview={`Entre no grupo ${grupoNome} no WhatsApp`}>
      <Heading as="h1" style={{ color: EMAIL_COLORS.ink, fontSize: '24px', lineHeight: '32px', margin: '0 0 16px', fontWeight: 700 }}>
        Olá, {nome}.
      </Heading>
      <Text style={text}>
        Criamos o grupo <strong style={{ color: EMAIL_COLORS.mint }}>{grupoNome}</strong> no WhatsApp
        para acompanhar a implantação da {empresaNome}. Seu número não permite ser adicionado
        automaticamente, então entre pelo link abaixo.
      </Text>
      <Button href={inviteUrl} style={{ backgroundColor: EMAIL_COLORS.mint, color: EMAIL_COLORS.forest, padding: '12px 20px', borderRadius: '8px', fontWeight: 700 }}>
        Entrar no grupo
      </Button>
      <Text style={{ ...text, color: EMAIL_COLORS.muted, fontSize: '14px', margin: '24px 0 0' }}>
        Se o botão não abrir, copie este endereço: {inviteUrl}
      </Text>
    </Layout>
  );
}

export default ConviteGrupo;
```

- [ ] **Step 6: Registrar em `api/_lib/email-sender.ts`**

Import: `import ConviteGrupo, { type ConviteGrupoProps } from '../../src/emails/ConviteGrupo';`

`EmailTemplate` ganha `| 'ConviteGrupo'`. Em `SUBJECTS`:

```ts
  ConviteGrupo: (p) => `Entre no grupo ${(p as ConviteGrupoProps).grupoNome} no WhatsApp`,
```

Em `renderTemplate`, antes do `default`:

```ts
    case 'ConviteGrupo':
      return render(React.createElement(ConviteGrupo, props as ConviteGrupoProps));
```

- [ ] **Step 7: Rodar** — `npx vitest run api/_lib/__tests__/staff-notify.test.ts src/emails` → PASS.

- [ ] **Step 8: Commit**

```bash
git add api/_lib/staff-notify.ts api/_lib/__tests__/staff-notify.test.ts src/emails/ConviteGrupo.tsx src/emails/__tests__/ConviteGrupo.test.tsx api/_lib/email-sender.ts
git commit -m "feat(cadastro): aviso no Staff e e-mail de convite para o grupo"
```

---

### Task 5: Upload do cadastro (PDF e imagem, 10 MB)

**Files:**
- Modify: `api/_lib/schemas/upload.ts`
- Modify: `api/sessions/_upload-arquivo.ts`
- Modify: `server/index.ts` (limite do body)
- Modify: `src/lib/api-client.ts` (`uploadArquivo.departamento` aceita `'cadastro'`)
- Test: `api/sessions/upload-arquivo.test.ts` (casos novos)

**Interfaces:**
- Produces: `departamento: 'cadastro'` aceito no upload; extensões `pdf, jpg, jpeg, png`; 10 MB; path `{session_id}/cadastro/{pergunta_id}/{ts}-{nome}`.
- Produces: `UPLOAD_CONTEXTOS` com `{ extensoes, maxBytes }` por contexto, `resolveUploadContexto(departamento)`.

- [ ] **Step 1: Testes novos em `api/sessions/upload-arquivo.test.ts`** (dentro do `describe` existente)

```ts
  it('200 cadastro — aceita PDF de até 10MB e grava em /cadastro/', async () => {
    (assertSessionAccess as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sess-1' });
    const m = makeStorageMock({ data: { path: 'x' }, error: null });
    (getServiceSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(m.client);
    const r = await invokeHandler(handler as never, {
      method: 'POST',
      body: { ...validBody, departamento: 'cadastro', pergunta_id: 'doc_contrato_social', nome: 'contrato social.pdf', content_type: 'application/pdf', base64: Buffer.alloc(6 * 1024 * 1024, 1).toString('base64') },
    });
    expect(r.statusCode).toBe(200);
    expect((r.body as { path: string }).path).toMatch(/^sess-1\/cadastro\/doc_contrato_social\/\d+-contrato_social\.pdf$/);
  });

  it('400 cadastro — recusa xlsx', async () => {
    (assertSessionAccess as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sess-1' });
    const r = await invokeHandler(handler as never, {
      method: 'POST',
      body: { ...validBody, departamento: 'cadastro', pergunta_id: 'doc_contrato_social' },
    });
    expect(r.statusCode).toBe(400);
    expect((r.body as { error: string }).error).toBe('extensao_nao_permitida');
  });

  it('413 cadastro — recusa acima de 10MB', async () => {
    (assertSessionAccess as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sess-1' });
    const r = await invokeHandler(handler as never, {
      method: 'POST',
      body: { ...validBody, departamento: 'cadastro', pergunta_id: 'doc_responsaveis', nome: 'rg.png', base64: Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString('base64') },
    });
    expect(r.statusCode).toBe(413);
  });
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run api/sessions/upload-arquivo.test.ts` → o primeiro caso falha com 400 `invalid_payload` (enum não aceita `cadastro`).

- [ ] **Step 3: Reescrever `api/_lib/schemas/upload.ts`**

```ts
import { z } from 'zod';
import { DEPARTAMENTOS } from './resposta';

export const UPLOAD_BUCKET = 'onboarding-uploads';

/** Contextos de upload: planilha de equipe (departamentos) e documentos do cadastro. */
export const UPLOAD_CONTEXTOS = {
  planilha: { extensoes: ['xlsx', 'xls', 'csv'] as const, maxBytes: 5 * 1024 * 1024 },
  cadastro: { extensoes: ['pdf', 'jpg', 'jpeg', 'png'] as const, maxBytes: 10 * 1024 * 1024 },
} as const;

// Compat: constantes antigas continuam apontando para o contexto planilha.
export const UPLOAD_EXTENSOES = UPLOAD_CONTEXTOS.planilha.extensoes;
export const UPLOAD_MAX_BYTES = UPLOAD_CONTEXTOS.planilha.maxBytes;

export const UPLOAD_DEPARTAMENTOS = [...DEPARTAMENTOS, 'cadastro'] as const;

export function resolveUploadContexto(departamento: string) {
  return departamento === 'cadastro' ? UPLOAD_CONTEXTOS.cadastro : UPLOAD_CONTEXTOS.planilha;
}

export const UploadArquivoSchema = z.object({
  slug: z.string().min(1),
  token: z.string().min(16),
  departamento: z.enum(UPLOAD_DEPARTAMENTOS),
  pergunta_id: z.string().min(1).max(80),
  nome: z.string().min(1).max(200),
  content_type: z.string().max(120).optional(),
  /** Conteúdo do arquivo em base64 (sem prefixo data:). */
  base64: z.string().min(1),
});
```

- [ ] **Step 4: Ajustar `_upload-arquivo.ts`**

Trocar o import para `UploadArquivoSchema, UPLOAD_BUCKET, resolveUploadContexto` e o corpo:

```ts
    const ctx = resolveUploadContexto(body.departamento);
    const ext = body.nome.split('.').pop()?.toLowerCase() ?? '';
    if (!(ctx.extensoes as readonly string[]).includes(ext))
      throw new HttpError(400, 'extensao_nao_permitida');

    const buffer = Buffer.from(body.base64, 'base64');
    if (buffer.length === 0) throw new HttpError(400, 'arquivo_vazio');
    if (buffer.length > ctx.maxBytes) throw new HttpError(413, 'arquivo_muito_grande');

    const nomeSanitizado = body.nome.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-120);
    const prefixo = body.departamento === 'cadastro' ? 'cadastro/' : '';
    const path = `${(session as { id: string }).id}/${prefixo}${body.pergunta_id}/${Date.now()}-${nomeSanitizado}`;
```

- [ ] **Step 5: `server/index.ts`** — trocar `express.json({ limit: '8mb' })` da rota de upload por `'15mb'` (10 MB em base64 ≈ 13,4 MB) e atualizar o comentário.

- [ ] **Step 6: `src/lib/api-client.ts`** — em `sessionApi.uploadArquivo`, `departamento: DepartamentoId | 'cadastro'`.

- [ ] **Step 7: Rodar** — `npx vitest run api/sessions/upload-arquivo.test.ts` → PASS (casos antigos e novos).

- [ ] **Step 8: Commit**

```bash
git add api/_lib/schemas/upload.ts api/sessions/_upload-arquivo.ts api/sessions/upload-arquivo.test.ts server/index.ts src/lib/api-client.ts
git commit -m "feat(upload): contexto cadastro aceita PDF e imagem até 10MB"
```

---

### Task 6: Endpoint `cnpj-lookup` autenticado

**Files:**
- Create: `api/sessions/_cnpj-lookup.ts`
- Modify: `api/sessions/[action].ts`, `server/index.ts`, `src/lib/api-client.ts`
- Test: `api/sessions/cnpj-lookup.test.ts`

**Interfaces:**
- Produces: `POST /api/sessions/cnpj-lookup` body `{ slug, token, cnpj }` → `200 { razao_social: string, nome_fantasia: string }` (strings vazias quando o provedor não responde); `400 invalid_payload`; `401 invalid_session`.
- Produces: `sessionApi.cnpjLookup({ slug, token, cnpj })`.

- [ ] **Step 1: Teste**

```ts
// api/sessions/cnpj-lookup.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from '../../tests/_helpers/handler';

vi.mock('../_lib/auth-session', async () => {
  const actual = await vi.importActual<typeof import('../_lib/auth-session')>('../_lib/auth-session');
  return { ...actual, assertSessionAccess: vi.fn() };
});
vi.mock('../_lib/brasilapi', () => ({ fetchCnpj: vi.fn() }));
import { assertSessionAccess, HttpError } from '../_lib/auth-session';
import { fetchCnpj } from '../_lib/brasilapi';
import handler from './_cnpj-lookup';

const body = { slug: 's', token: 'tok-32-chars-xxxxxxxxxxxxxxxxxx', cnpj: '11.222.333/0001-81' };

describe('POST /api/sessions/cnpj-lookup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200 com razão social e fantasia da BrasilAPI', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });
    (fetchCnpj as never as ReturnType<typeof vi.fn>).mockResolvedValue({ razao_social: 'X LTDA', nome_fantasia: 'X' });
    const r = await invokeHandler(handler as never, { method: 'POST', body });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ razao_social: 'X LTDA', nome_fantasia: 'X' });
  });
  it('200 com campos vazios quando o provedor está fora', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });
    (fetchCnpj as never as ReturnType<typeof vi.fn>).mockRejectedValue(new HttpError(503, 'cnpj_lookup_unavailable'));
    const r = await invokeHandler(handler as never, { method: 'POST', body });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ razao_social: '', nome_fantasia: '' });
  });
  it('lê o formato da ReceitaWS (nome/fantasia)', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });
    (fetchCnpj as never as ReturnType<typeof vi.fn>).mockResolvedValue({ nome: 'Y LTDA', fantasia: 'Y' });
    const r = await invokeHandler(handler as never, { method: 'POST', body });
    expect(r.body).toEqual({ razao_social: 'Y LTDA', nome_fantasia: 'Y' });
  });
  it('400 com CNPJ inválido', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });
    const r = await invokeHandler(handler as never, { method: 'POST', body: { ...body, cnpj: '123' } });
    expect(r.statusCode).toBe(400);
  });
  it('401 sem sessão', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockRejectedValue(new HttpError(401, 'invalid_session'));
    const r = await invokeHandler(handler as never, { method: 'POST', body });
    expect(r.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — módulo não existe.

- [ ] **Step 3: Criar `api/sessions/_cnpj-lookup.ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { fetchCnpj } from '../_lib/brasilapi';
import { assertSessionAccess, HttpError } from '../_lib/auth-session';
import { CnpjSchema } from '../_lib/schemas/identificacao';

const Schema = z.object({ slug: z.string().min(1), token: z.string().min(16), cnpj: CnpjSchema });

/**
 * POST /api/sessions/cnpj-lookup — usado pela página /cadastro para preencher razão
 * social e nome fantasia. Provedor fora do ar não é erro: devolve strings vazias e o
 * cliente digita à mão.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const body = Schema.parse(req.body);
    await assertSessionAccess(body.slug, body.token);

    let data: Record<string, unknown> = {};
    try {
      data = (await fetchCnpj(body.cnpj)) as Record<string, unknown>;
    } catch (e) {
      console.warn('[cnpj-lookup] provedor indisponível:', e instanceof Error ? e.message : e);
    }
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    return res.status(200).json({
      razao_social: str(data.razao_social) || str(data.nome),
      nome_fantasia: str(data.nome_fantasia) || str(data.fantasia),
    });
  } catch (e: unknown) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    const err = e as { name?: string; flatten?: () => unknown };
    if (err.name === 'ZodError') return res.status(400).json({ error: 'invalid_payload', details: err.flatten?.() });
    console.error('[sessions/cnpj-lookup]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
```

- [ ] **Step 4: Registrar rotas**

`api/sessions/[action].ts`: `import cnpjLookup from './_cnpj-lookup';` e `'cnpj-lookup': cnpjLookup,`.
`server/index.ts`: `['/api/sessions/cnpj-lookup', () => import('../api/sessions/_cnpj-lookup.ts')],`.

- [ ] **Step 5: Cliente** — em `sessionApi`:

```ts
  cnpjLookup: (input: { slug: string; token: string; cnpj: string }) =>
    api<{ razao_social: string; nome_fantasia: string }>('/api/sessions/cnpj-lookup', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
```

- [ ] **Step 6: Rodar** — `npx vitest run api/sessions/cnpj-lookup.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add api/sessions/_cnpj-lookup.ts api/sessions/cnpj-lookup.test.ts "api/sessions/[action].ts" server/index.ts src/lib/api-client.ts
git commit -m "feat(cadastro): lookup de CNPJ autenticado pela sessão"
```

---

### Task 7: Núcleo `criarGrupoParaSessao` e endpoint `cadastro-submit`

**Files:**
- Create: `api/_lib/cadastro-grupo.ts`
- Create: `api/sessions/_cadastro-submit.ts`
- Modify: `api/sessions/[action].ts`, `server/index.ts`, `src/lib/api-client.ts`
- Test: `api/_lib/__tests__/cadastro-grupo.test.ts`, `api/sessions/cadastro-submit.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Cadastro`, `CadastroSubmitSchema`), Task 2 (funções de grupo), Task 3 (`ensureShortLink`, `onboardingTargetUrl`, `WELCOME_TEMPLATE`), Task 4 (`notifyStaff`, template `ConviteGrupo`).
- Produces:

```ts
export type SessaoGrupo = {
  id: string; slug: string; access_token: string | null; empresa_nome: string;
  modo: 'completo' | 'comercial' | null;
  grupo_jid?: string | null; notificacao_boas_vindas_enviada_at?: string | null;
};
export type ResultadoGrupo =
  | { status: 'criado'; jid: string; invite_url: string | null; nao_adicionados: string[] }
  | { status: 'erro'; motivo: string };
export async function criarGrupoParaSessao(
  supabase: SupabaseClient, sessao: SessaoGrupo, cadastro: Cadastro,
  opts?: { host?: string; proto?: string }
): Promise<ResultadoGrupo>;
export function mensagemStaffCadastro(sessao, cadastro, resultado): string;
```
- Produces: `POST /api/sessions/cadastro-submit` body `{ slug, token, cadastro }` → `200 { ok: true, grupo: ResultadoGrupo }`; `sessionApi.cadastroSubmit(input)`.

- [ ] **Step 1: Teste do núcleo**

```ts
// api/_lib/__tests__/cadastro-grupo.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../evolution', () => ({
  toJid: (d: string) => `55${d}@s.whatsapp.net`,
  groupSubject: (n: string) => `Pipeelo & ${n}`,
  createGroup: vi.fn(),
  updateParticipants: vi.fn(async () => undefined),
  getParticipants: vi.fn(),
  getInviteUrl: vi.fn(async () => 'https://chat.whatsapp.com/abc'),
  sendText: vi.fn(async () => ({ ok: true })),
  EvolutionApiError: class extends Error { constructor(public status: number, m: string) { super(m); } },
  EvolutionConfigError: class extends Error {},
}));
vi.mock('../short-links', () => ({
  ensureShortLink: vi.fn(async () => ({ code: 'abc123', short_url: 'https://onboarding.pipeelo.com/s/abc123' })),
  onboardingTargetUrl: () => 'https://onboarding.pipeelo.com/slug?token=t',
}));
vi.mock('../staff-notify', () => ({ notifyStaff: vi.fn(async () => ({ sent: true })) }));
vi.mock('../email-sender', () => ({ sendTransactionalEmail: vi.fn(async () => ({ skipped: false })) }));

import { createGroup, getParticipants, updateParticipants, sendText } from '../evolution';
import { notifyStaff } from '../staff-notify';
import { sendTransactionalEmail } from '../email-sender';
import { criarGrupoParaSessao } from '../cadastro-grupo';
import type { Cadastro } from '../schemas/cadastro';

const upload = { path: 'p', nome_original: 'a.pdf', tamanho: 1 };
const cadastro: Cadastro = {
  cnpj: '11222333000181', razao_social: 'X LTDA', nome_fantasia: 'Provedor X', inscricao_estadual: 'Isento',
  cobranca_email: 'f@x.com', cobranca_telefone: '4333221100', dia_vencimento: 10, contrato_email: 'j@x.com',
  doc_contrato_social: [upload], doc_responsaveis: [upload],
  responsavel_nome: 'Ana', responsavel_cargo: 'CEO', responsavel_email: 'ana@x.com', responsavel_whatsapp: '43996661541',
  contatos_extras: [{ nome: 'João', whatsapp: '43991112233' }], aceite_dados: true,
};
const sessao = { id: 's1', slug: 'slug', access_token: 't', empresa_nome: 'Provedor X', modo: 'completo' as const };

function makeSupabase() {
  const updates: unknown[] = [];
  const eq = vi.fn(async () => ({ error: null }));
  const update = vi.fn((patch: unknown) => { updates.push(patch); return { eq }; });
  const from = vi.fn(() => ({ update }));
  return { client: { from } as never, updates };
}

describe('criarGrupoParaSessao', () => {
  beforeEach(() => vi.clearAllMocks());

  it('caminho feliz: cria, promove, confere, manda boas-vindas e avisa Staff', async () => {
    (createGroup as never as ReturnType<typeof vi.fn>).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
    (getParticipants as never as ReturnType<typeof vi.fn>).mockResolvedValue(['5543996661541@s.whatsapp.net', '5543991112233@s.whatsapp.net']);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r).toEqual({ status: 'criado', jid: '1@g.us', invite_url: 'https://chat.whatsapp.com/abc', nao_adicionados: [] });
    expect(createGroup).toHaveBeenCalledWith('Pipeelo & Provedor X', ['5543996661541@s.whatsapp.net', '5543991112233@s.whatsapp.net']);
    expect(updateParticipants).toHaveBeenCalledWith('1@g.us', 'promote', ['5543996661541@s.whatsapp.net']);
    expect(sendText).toHaveBeenCalledWith('1@g.us', expect.stringContaining('https://onboarding.pipeelo.com/s/abc123'));
    expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('Cadastro recebido: Provedor X'));
    expect(sb.updates.some((u) => (u as { grupo_jid?: string }).grupo_jid === '1@g.us')).toBe(true);
    expect(sb.updates.some((u) => 'notificacao_boas_vindas_enviada_at' in (u as object))).toBe(true);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('quem não entrou recebe e-mail de convite e volta em nao_adicionados', async () => {
    (createGroup as never as ReturnType<typeof vi.fn>).mockResolvedValue({ groupJid: '1@g.us', inviteCode: null });
    (getParticipants as never as ReturnType<typeof vi.fn>).mockResolvedValue(['5543991112233@s.whatsapp.net']);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('criado');
    if (r.status === 'criado') expect(r.nao_adicionados).toEqual(['43996661541']);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      template: 'ConviteGrupo', to: 'ana@x.com', sessionId: 's1',
      props: expect.objectContaining({ inviteUrl: 'https://chat.whatsapp.com/abc' }),
    }));
  });

  it('falha na criação: grava grupo_erro, avisa Staff, devolve erro sem lançar', async () => {
    (createGroup as never as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('evolution 500'));
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r).toEqual({ status: 'erro', motivo: 'evolution 500' });
    expect(sb.updates.some((u) => (u as { grupo_erro?: string }).grupo_erro === 'evolution 500')).toBe(true);
    expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('falhou'));
    expect(sendText).not.toHaveBeenCalled();
  });

  it('falha ao promover não bloqueia; fica registrada em grupo_erro', async () => {
    (createGroup as never as ReturnType<typeof vi.fn>).mockResolvedValue({ groupJid: '1@g.us', inviteCode: 'abc' });
    (updateParticipants as never as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('promote falhou'));
    (getParticipants as never as ReturnType<typeof vi.fn>).mockResolvedValue(['5543996661541@s.whatsapp.net', '5543991112233@s.whatsapp.net']);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('criado');
    expect(sb.updates.some((u) => String((u as { grupo_erro?: string }).grupo_erro ?? '').includes('promote falhou'))).toBe(true);
    expect(sendText).toHaveBeenCalled();
  });

  it('reaproveita grupo existente quando a sessão já tem grupo_jid', async () => {
    (getParticipants as never as ReturnType<typeof vi.fn>).mockResolvedValue(['5543996661541@s.whatsapp.net', '5543991112233@s.whatsapp.net']);
    const sb = makeSupabase();

    const r = await criarGrupoParaSessao(sb.client, { ...sessao, grupo_jid: '9@g.us', notificacao_boas_vindas_enviada_at: '2026-09-01' }, cadastro);

    expect(createGroup).not.toHaveBeenCalled();
    expect(updateParticipants).toHaveBeenCalledWith('9@g.us', 'add', expect.any(Array));
    expect(sendText).not.toHaveBeenCalled(); // boas-vindas já enviada
    expect(r.status).toBe('criado');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — módulo não existe.

- [ ] **Step 3: Criar `api/_lib/cadastro-grupo.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  toJid, groupSubject, createGroup, updateParticipants, getParticipants, getInviteUrl, sendText,
} from './evolution';
import { ensureShortLink, onboardingTargetUrl } from './short-links';
import { WELCOME_TEMPLATE } from './welcome-template';
import { notifyStaff } from './staff-notify';
import { sendTransactionalEmail } from './email-sender';
import type { Cadastro } from './schemas/cadastro';

export type SessaoGrupo = {
  id: string;
  slug: string;
  access_token: string | null;
  empresa_nome: string;
  modo: 'completo' | 'comercial' | null;
  grupo_jid?: string | null;
  notificacao_boas_vindas_enviada_at?: string | null;
};

export type ResultadoGrupo =
  | { status: 'criado'; jid: string; invite_url: string | null; nao_adicionados: string[] }
  | { status: 'erro'; motivo: string };

type Pessoa = { nome: string; whatsapp: string; email?: string; admin: boolean };

function pessoasDoCadastro(c: Cadastro): Pessoa[] {
  return [
    { nome: c.responsavel_nome, whatsapp: c.responsavel_whatsapp, email: c.responsavel_email, admin: true },
    ...c.contatos_extras.map((x) => ({ nome: x.nome, whatsapp: x.whatsapp, admin: false })),
  ];
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function patch(supabase: SupabaseClient, id: string, data: Record<string, unknown>) {
  const { error } = await supabase.from('onboarding_sessions').update(data).eq('id', id);
  if (error) console.error('[cadastro-grupo] update falhou:', error.message);
}

export function mensagemStaffCadastro(s: SessaoGrupo, c: Cadastro, r: ResultadoGrupo): string {
  const subject = groupSubject(c.nome_fantasia);
  const grupo = r.status === 'criado' ? `${subject} (criado ✅)` : `${subject} (falhou ❌ ${r.motivo})`;
  const docs = c.doc_contrato_social.length + c.doc_responsaveis.length;
  const linhas = [
    `📋 Cadastro recebido: ${c.nome_fantasia}`,
    `Grupo: ${grupo}`,
    `Admin: ${c.responsavel_nome} — ${c.responsavel_whatsapp}`,
    `Documentos: ${docs} arquivo${docs === 1 ? '' : 's'}`,
    `Contrato → ${c.contrato_email} · Vencimento dia ${c.dia_vencimento}`,
    `Painel: ${(process.env.PUBLIC_BASE_URL ?? 'https://onboarding.pipeelo.com').replace(/\/+$/, '')}/admin?s=${s.slug}`,
  ];
  if (r.status === 'criado' && r.nao_adicionados.length) {
    linhas.push(`Não entraram (privacidade): ${r.nao_adicionados.join(', ')} — convite enviado por e-mail`);
  }
  return linhas.join('\n');
}

/**
 * Cria (ou reaproveita) o grupo da sessão, promove o contato principal, confere quem
 * entrou, manda boas-vindas e avisa o Staff. Nunca lança: cada etapa registra a falha
 * em `grupo_erro` e segue. Reexecutável: com `grupo_jid` já salvo, só adiciona quem
 * falta e pula a boas-vindas já enviada.
 */
export async function criarGrupoParaSessao(
  supabase: SupabaseClient,
  sessao: SessaoGrupo,
  cadastro: Cadastro,
  opts: { host?: string; proto?: string } = {}
): Promise<ResultadoGrupo> {
  const pessoas = pessoasDoCadastro(cadastro);
  const jidPor = new Map(pessoas.map((p) => [p.whatsapp, toJid(p.whatsapp)]));
  const todosJids = [...jidPor.values()];
  const adminJid = jidPor.get(cadastro.responsavel_whatsapp)!;
  const erros: string[] = [];
  let groupJid = sessao.grupo_jid ?? null;
  let inviteUrl: string | null = null;

  // 1. Criar (ou reaproveitar) o grupo
  try {
    if (groupJid) {
      await updateParticipants(groupJid, 'add', todosJids);
    } else {
      const created = await createGroup(groupSubject(cadastro.nome_fantasia), todosJids);
      groupJid = created.groupJid;
      inviteUrl = created.inviteCode ? `https://chat.whatsapp.com/${created.inviteCode}` : null;
      await patch(supabase, sessao.id, {
        grupo_jid: groupJid, grupo_invite_url: inviteUrl, grupo_criado_at: new Date().toISOString(), grupo_erro: null,
      });
    }
  } catch (e) {
    const motivo = msg(e);
    await patch(supabase, sessao.id, { grupo_erro: motivo });
    const resultado: ResultadoGrupo = { status: 'erro', motivo };
    await notifyStaff(mensagemStaffCadastro(sessao, cadastro, resultado));
    return resultado;
  }

  // 2. Promover admin
  try {
    await updateParticipants(groupJid, 'promote', [adminJid]);
  } catch (e) {
    erros.push(`promote: ${msg(e)}`);
  }

  // 3. Conferir quem entrou; quem ficou de fora recebe convite por e-mail
  let naoAdicionados: string[] = [];
  try {
    if (!inviteUrl) inviteUrl = await getInviteUrl(groupJid);
    const dentro = new Set(await getParticipants(groupJid));
    naoAdicionados = pessoas.filter((p) => !dentro.has(jidPor.get(p.whatsapp)!)).map((p) => p.whatsapp);
    for (const p of pessoas) {
      if (dentro.has(jidPor.get(p.whatsapp)!) || !p.email) continue;
      await sendTransactionalEmail({
        template: 'ConviteGrupo',
        sessionId: sessao.id,
        to: p.email,
        idempotencyKey: `convite-grupo:${sessao.id}:${p.whatsapp}`,
        props: { nome: p.nome, empresaNome: cadastro.nome_fantasia, grupoNome: groupSubject(cadastro.nome_fantasia), inviteUrl },
      });
    }
    if (inviteUrl) await patch(supabase, sessao.id, { grupo_invite_url: inviteUrl });
  } catch (e) {
    erros.push(`conferencia: ${msg(e)}`);
  }

  // 4. Boas-vindas com link curto do onboarding (uma vez só)
  if (!sessao.notificacao_boas_vindas_enviada_at) {
    try {
      const modo = sessao.modo ?? 'completo';
      const { short_url } = await ensureShortLink(supabase, {
        session_id: sessao.id, modo,
        target_url: onboardingTargetUrl({ slug: sessao.slug, access_token: sessao.access_token, modo }),
        host: opts.host, proto: opts.proto,
      });
      await sendText(groupJid, WELCOME_TEMPLATE(short_url));
      await patch(supabase, sessao.id, { notificacao_boas_vindas_enviada_at: new Date().toISOString() });
    } catch (e) {
      erros.push(`boas-vindas: ${msg(e)}`);
    }
  }

  if (erros.length) await patch(supabase, sessao.id, { grupo_erro: erros.join(' | ') });

  const resultado: ResultadoGrupo = { status: 'criado', jid: groupJid, invite_url: inviteUrl, nao_adicionados: naoAdicionados };
  await notifyStaff(mensagemStaffCadastro(sessao, cadastro, resultado));
  return resultado;
}
```

- [ ] **Step 4: Rodar** — `npx vitest run api/_lib/__tests__/cadastro-grupo.test.ts` → PASS (5 testes).

- [ ] **Step 5: Teste do handler**

```ts
// api/sessions/cadastro-submit.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from '../../tests/_helpers/handler';

vi.mock('../_lib/auth-session', async () => {
  const actual = await vi.importActual<typeof import('../_lib/auth-session')>('../_lib/auth-session');
  return { ...actual, assertSessionAccess: vi.fn() };
});
vi.mock('../_lib/supabase', () => ({ getServiceSupabase: vi.fn() }));
vi.mock('../_lib/cadastro-grupo', () => ({ criarGrupoParaSessao: vi.fn() }));
vi.mock('../_lib/ratelimit', () => ({ createSessionLimiter: () => ({ limit: vi.fn(async () => ({ success: true })) }) }));

import { assertSessionAccess } from '../_lib/auth-session';
import { getServiceSupabase } from '../_lib/supabase';
import { criarGrupoParaSessao } from '../_lib/cadastro-grupo';
import handler from './_cadastro-submit';

const upload = { path: 'p', nome_original: 'a.pdf', tamanho: 1 };
const cadastro = {
  cnpj: '11.222.333/0001-81', razao_social: 'X LTDA', nome_fantasia: 'Provedor X', inscricao_estadual: 'Isento',
  cobranca_email: 'f@x.com', cobranca_telefone: '(43) 3322-1100', dia_vencimento: 10, contrato_email: 'j@x.com',
  doc_contrato_social: [upload], doc_responsaveis: [upload],
  responsavel_nome: 'Ana Souza', responsavel_cargo: 'CEO', responsavel_email: 'ana@x.com', responsavel_whatsapp: '(43) 99666-1541',
  contatos_extras: [], aceite_dados: true,
};
const body = { slug: 's', token: 'tok-32-chars-xxxxxxxxxxxxxxxxxx', cadastro };
const sessao = { id: 's1', slug: 's', access_token: 'tok', empresa_nome: 'Provedor X', modo: 'completo', cadastro_enviado_at: null, grupo_jid: null };

function makeSupabase() {
  const eq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq }));
  return { client: { from: vi.fn(() => ({ update })) }, update };
}

describe('POST /api/sessions/cadastro-submit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200: salva cadastro, cria grupo e devolve resultado', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue(sessao);
    const sb = makeSupabase();
    (getServiceSupabase as never as ReturnType<typeof vi.fn>).mockReturnValue(sb.client);
    (criarGrupoParaSessao as never as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'criado', jid: '1@g.us', invite_url: null, nao_adicionados: [] });

    const r = await invokeHandler(handler as never, { method: 'POST', body, headers: { host: 'onboarding.pipeelo.com' } });

    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ ok: true, grupo: { status: 'criado', jid: '1@g.us', invite_url: null, nao_adicionados: [] } });
    const saved = (sb.update.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(saved.cadastro).toMatchObject({ cnpj: '11222333000181', responsavel_whatsapp: '43996661541' });
    expect(saved.cadastro_enviado_at).toBeTruthy();
  });

  it('idempotente: cadastro já enviado devolve estado atual sem recriar grupo', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue({ ...sessao, cadastro_enviado_at: '2026-09-01', grupo_jid: '1@g.us', grupo_invite_url: 'https://chat.whatsapp.com/x' });
    const r = await invokeHandler(handler as never, { method: 'POST', body });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ ok: true, grupo: { status: 'criado', jid: '1@g.us', invite_url: 'https://chat.whatsapp.com/x', nao_adicionados: [] } });
    expect(criarGrupoParaSessao).not.toHaveBeenCalled();
  });

  it('400 com payload inválido', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue(sessao);
    const r = await invokeHandler(handler as never, { method: 'POST', body: { ...body, cadastro: { ...cadastro, aceite_dados: false } } });
    expect(r.statusCode).toBe(400);
  });

  it('500 se salvar falhar; grupo não é criado', async () => {
    (assertSessionAccess as never as ReturnType<typeof vi.fn>).mockResolvedValue(sessao);
    const eq = vi.fn(async () => ({ error: { message: 'db down' } }));
    (getServiceSupabase as never as ReturnType<typeof vi.fn>).mockReturnValue({ from: () => ({ update: () => ({ eq }) }) });
    const r = await invokeHandler(handler as never, { method: 'POST', body });
    expect(r.statusCode).toBe(500);
    expect(criarGrupoParaSessao).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Criar `api/sessions/_cadastro-submit.ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CadastroSubmitSchema } from '../_lib/schemas/cadastro';
import { assertSessionAccess, HttpError } from '../_lib/auth-session';
import { getServiceSupabase } from '../_lib/supabase';
import { createSessionLimiter } from '../_lib/ratelimit';
import { criarGrupoParaSessao, type SessaoGrupo } from '../_lib/cadastro-grupo';

type Row = SessaoGrupo & { cadastro_enviado_at?: string | null; grupo_invite_url?: string | null };

/**
 * POST /api/sessions/cadastro-submit — salva o cadastro e dispara a criação do grupo.
 * Idempotente: segundo envio devolve o estado atual sem tocar na Evolution.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const body = CadastroSubmitSchema.parse(req.body);
    const session = (await assertSessionAccess(body.slug, body.token)) as Row;

    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? 'unknown';
    const { success } = await createSessionLimiter().limit(`cadastro:${ip}`);
    if (!success) return res.status(429).json({ error: 'rate_limited' });

    if (session.cadastro_enviado_at) {
      return res.status(200).json({
        ok: true,
        grupo: session.grupo_jid
          ? { status: 'criado', jid: session.grupo_jid, invite_url: session.grupo_invite_url ?? null, nao_adicionados: [] }
          : { status: 'erro', motivo: (session as { grupo_erro?: string }).grupo_erro ?? 'grupo_nao_criado' },
      });
    }

    const supabase = getServiceSupabase();
    const { error } = await supabase
      .from('onboarding_sessions')
      .update({ cadastro: body.cadastro, cadastro_enviado_at: new Date().toISOString() })
      .eq('id', session.id);
    if (error) throw new HttpError(500, error.message);

    const grupo = await criarGrupoParaSessao(supabase, session, body.cadastro, {
      host: req.headers.host,
      proto: req.headers['x-forwarded-proto'] as string | undefined,
    });
    return res.status(200).json({ ok: true, grupo });
  } catch (e: unknown) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    const err = e as { name?: string; flatten?: () => unknown };
    if (err.name === 'ZodError') return res.status(400).json({ error: 'invalid_payload', details: err.flatten?.() });
    console.error('[sessions/cadastro-submit]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
```

- [ ] **Step 7: Rotas e cliente**

`api/sessions/[action].ts`: `import cadastroSubmit from './_cadastro-submit';` + `'cadastro-submit': cadastroSubmit,`.
`server/index.ts`: `['/api/sessions/cadastro-submit', () => import('../api/sessions/_cadastro-submit.ts')],`.
`src/lib/api-client.ts`, em `sessionApi`:

```ts
  cadastroSubmit: (input: { slug: string; token: string; cadastro: Record<string, unknown> }) =>
    api<{ ok: true; grupo: ResultadoGrupoDTO }>('/api/sessions/cadastro-submit', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
```

e o tipo exportado acima de `sessionApi`:

```ts
export type ResultadoGrupoDTO =
  | { status: 'criado'; jid: string; invite_url: string | null; nao_adicionados: string[] }
  | { status: 'erro'; motivo: string };
```

- [ ] **Step 8: Rodar** — `npx vitest run api/sessions/cadastro-submit.test.ts api/_lib/__tests__/cadastro-grupo.test.ts` → PASS.

- [ ] **Step 9: Commit**

```bash
git add api/_lib/cadastro-grupo.ts api/_lib/__tests__/cadastro-grupo.test.ts api/sessions/_cadastro-submit.ts api/sessions/cadastro-submit.test.ts "api/sessions/[action].ts" server/index.ts src/lib/api-client.ts
git commit -m "feat(cadastro): envio do cadastro cria grupo WhatsApp com admin e boas-vindas"
```

---

### Task 8: Admin: recriar grupo, link de cadastro e estado na lista

**Files:**
- Create: `api/admin/_cadastro-recriar-grupo.ts`
- Modify: `api/admin/[action].ts`, `server/index.ts`, `src/lib/api-client.ts`, `src/pages/AdminOnboarding.tsx`
- Test: `api/admin/cadastro-recriar-grupo.test.ts`

**Interfaces:**
- Consumes: `criarGrupoParaSessao`, `CadastroSchema`.
- Produces: `POST /api/admin/cadastro-recriar-grupo` body `{ session_id }` → `200 { ok: true, grupo }`; `409 cadastro_nao_enviado`. `adminSessionApi.recriarGrupo(authToken, session_id)`.

- [ ] **Step 1: Teste**

```ts
// api/admin/cadastro-recriar-grupo.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from '../../tests/_helpers/handler';

vi.mock('../_lib/admin-auth', () => ({ assertAdminUser: vi.fn(async () => ({ id: 'admin' })), AdminAuthError: class extends Error {} }));
vi.mock('../_lib/supabase', () => ({ getServiceSupabase: vi.fn() }));
vi.mock('../_lib/cadastro-grupo', () => ({ criarGrupoParaSessao: vi.fn(async () => ({ status: 'criado', jid: '1@g.us', invite_url: null, nao_adicionados: [] })) }));
import { getServiceSupabase } from '../_lib/supabase';
import { criarGrupoParaSessao } from '../_lib/cadastro-grupo';
import handler from './_cadastro-recriar-grupo';

const upload = { path: 'p', nome_original: 'a.pdf', tamanho: 1 };
const cadastro = {
  cnpj: '11222333000181', razao_social: 'X LTDA', nome_fantasia: 'Provedor X', inscricao_estadual: 'Isento',
  cobranca_email: 'f@x.com', cobranca_telefone: '4333221100', dia_vencimento: 10, contrato_email: 'j@x.com',
  doc_contrato_social: [upload], doc_responsaveis: [upload],
  responsavel_nome: 'Ana', responsavel_cargo: 'CEO', responsavel_email: 'ana@x.com', responsavel_whatsapp: '43996661541',
  contatos_extras: [], aceite_dados: true,
};

function sb(row: unknown) {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle };
  (getServiceSupabase as never as ReturnType<typeof vi.fn>).mockReturnValue({ from: () => chain });
}

describe('POST /api/admin/cadastro-recriar-grupo', () => {
  beforeEach(() => vi.clearAllMocks());
  it('200 reexecuta a criação com o cadastro salvo', async () => {
    sb({ id: 's1', slug: 's', access_token: 't', empresa_nome: 'X', modo: 'completo', cadastro, cadastro_enviado_at: '2026-09-01', grupo_jid: null });
    const r = await invokeHandler(handler as never, { method: 'POST', body: { session_id: 's1' }, headers: { authorization: 'Bearer x' } });
    expect(r.statusCode).toBe(200);
    expect(criarGrupoParaSessao).toHaveBeenCalled();
  });
  it('409 quando o cadastro ainda não foi enviado', async () => {
    sb({ id: 's1', cadastro: null, cadastro_enviado_at: null });
    const r = await invokeHandler(handler as never, { method: 'POST', body: { session_id: 's1' }, headers: { authorization: 'Bearer x' } });
    expect(r.statusCode).toBe(409);
  });
  it('404 sessão inexistente', async () => {
    sb(null);
    const r = await invokeHandler(handler as never, { method: 'POST', body: { session_id: 'nope' }, headers: { authorization: 'Bearer x' } });
    expect(r.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Criar `api/admin/_cadastro-recriar-grupo.ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { assertAdminUser, AdminAuthError } from '../_lib/admin-auth';
import { getServiceSupabase } from '../_lib/supabase';
import { CadastroSchema } from '../_lib/schemas/cadastro';
import { criarGrupoParaSessao, type SessaoGrupo } from '../_lib/cadastro-grupo';

const Body = z.object({ session_id: z.string().min(1) });

/** POST /api/admin/cadastro-recriar-grupo — reexecuta a criação do grupo com o cadastro salvo. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await assertAdminUser(req);
    const { session_id } = Body.parse(req.body);
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('onboarding_sessions')
      .select('id, slug, access_token, empresa_nome, modo, cadastro, cadastro_enviado_at, grupo_jid, notificacao_boas_vindas_enviada_at')
      .eq('id', session_id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'session_not_found' });
    if (!data.cadastro_enviado_at || !data.cadastro) return res.status(409).json({ error: 'cadastro_nao_enviado' });

    const cadastro = CadastroSchema.parse(data.cadastro);
    const grupo = await criarGrupoParaSessao(supabase, data as SessaoGrupo, cadastro, {
      host: req.headers.host,
      proto: req.headers['x-forwarded-proto'] as string | undefined,
    });
    return res.status(200).json({ ok: true, grupo });
  } catch (e: unknown) {
    if (e instanceof AdminAuthError) return res.status(401).json({ error: 'unauthorized' });
    const err = e as { name?: string; flatten?: () => unknown };
    if (err.name === 'ZodError') return res.status(400).json({ error: 'invalid_payload', details: err.flatten?.() });
    console.error('[admin/cadastro-recriar-grupo]', e);
    return res.status(500).json({ error: 'internal' });
  }
}
```

- [ ] **Step 4: Rotas e cliente**

`api/admin/[action].ts`: `'cadastro-recriar-grupo': cadastroRecriarGrupo`.
`server/index.ts`: `['/api/admin/cadastro-recriar-grupo', () => import('../api/admin/_cadastro-recriar-grupo.ts')],`.
`adminSessionApi`:

```ts
  recriarGrupo: (authToken: string, session_id: string) =>
    adminApi<{ ok: true; grupo: ResultadoGrupoDTO }>('/api/admin/cadastro-recriar-grupo', authToken, {
      method: 'POST',
      body: JSON.stringify({ session_id }),
    }),
```

- [ ] **Step 5: UI do admin (`src/pages/AdminOnboarding.tsx`)**

1. Helper ao lado de `getOnboardingUrl`:

```ts
  const getCadastroUrl = (session: OnboardingSession) => {
    const accessToken = (session as { access_token?: string }).access_token;
    const base = `https://onboarding.pipeelo.com/cadastro/${session.slug}`;
    return accessToken ? `${base}?token=${accessToken}` : base;
  };
  const copyCadastroLink = async (session: OnboardingSession) => {
    await navigator.clipboard.writeText(getCadastroUrl(session));
    toast.success('Link de cadastro copiado');
  };
```

2. Estado + ação de recriar:

```ts
  const [recriando, setRecriando] = useState<string | null>(null);
  const recriarGrupo = async (session: OnboardingSession) => {
    setRecriando(session.id);
    try {
      const authToken = await getAuthToken();
      if (!authToken) { toast.error('Sessão expirada — faça login novamente'); setIsAuthenticated(false); return; }
      const { grupo } = await adminSessionApi.recriarGrupo(authToken, session.id);
      if (grupo.status === 'criado') toast.success(`Grupo criado: ${grupo.jid}`);
      else toast.error(`Grupo falhou: ${grupo.motivo}`);
      await loadSessions();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erro ao recriar grupo');
    } finally {
      setRecriando(null);
    }
  };
```

(`loadSessions` é a função existente que recarrega a lista; confirmar o nome no arquivo.)

3. Na linha da sessão, depois dos badges de departamento, um badge de cadastro:

```tsx
                          {session.cadastro_enviado_at ? (
                            session.grupo_jid ? (
                              <Badge className="text-xs bg-green-500/20 text-green-400 border-green-500/30">Cadastro + grupo OK</Badge>
                            ) : (
                              <Badge className="text-xs bg-red-500/20 text-red-400 border-red-500/30">Grupo com erro</Badge>
                            )
                          ) : (
                            <Badge variant="outline" className="text-xs">Cadastro pendente</Badge>
                          )}
```

4. Nos botões, antes de "Copiar Link":

```tsx
                              <Button variant="outline" size="sm" onClick={() => copyCadastroLink(session)}>
                                <Copy className="w-4 h-4 mr-2" />
                                Link de cadastro
                              </Button>
                              {session.cadastro_enviado_at && !session.grupo_jid && (
                                <Button variant="outline" size="sm" disabled={recriando === session.id} onClick={() => recriarGrupo(session)}>
                                  {recriando === session.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                                  Recriar grupo
                                </Button>
                              )}
```

5. Se `_sessions-list.ts` seleciona colunas explícitas, incluir `cadastro_enviado_at, grupo_jid, grupo_erro, grupo_invite_url`. Se usa `select('*')`, nada a fazer.

- [ ] **Step 6: Rodar** — `npx vitest run api/admin` e `npx tsc --noEmit -p tsconfig.app.json` → sem erros.

- [ ] **Step 7: Commit**

```bash
git add api/admin/_cadastro-recriar-grupo.ts api/admin/cadastro-recriar-grupo.test.ts "api/admin/[action].ts" server/index.ts src/lib/api-client.ts src/pages/AdminOnboarding.tsx
git commit -m "feat(admin): link de cadastro, estado do grupo e botão recriar grupo"
```

---

### Task 9: Página `/cadastro/:slug`

**Files:**
- Create: `src/lib/phone.ts`
- Create: `src/components/cadastro/UploadMultiplo.tsx`
- Create: `src/pages/Cadastro.tsx`
- Modify: `src/App.tsx`
- Test: `src/lib/phone.test.ts`, `src/pages/Cadastro.test.tsx`

**Interfaces:**
- Consumes: `sessionApi.get`, `sessionApi.cnpjLookup`, `sessionApi.uploadArquivo`, `sessionApi.cadastroSubmit`, `ResultadoGrupoDTO`; `formatCnpj, cleanCnpj, validateCnpj` de `@/lib/cnpj`.
- Produces: `maskPhone(v: string): string` em `src/lib/phone.ts` (mesma lógica do `case 'phone'` do renderer). Rota `/cadastro/:slug?token=`.

- [ ] **Step 1: `src/lib/phone.ts` + teste**

```ts
// src/lib/phone.ts
export function maskPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}
export function phoneDigits(v: string): string {
  return v.replace(/\D/g, '');
}
export function isPhoneBrValid(v: string): boolean {
  const d = phoneDigits(v);
  return d.length === 10 || d.length === 11;
}
```

```ts
// src/lib/phone.test.ts
import { describe, it, expect } from 'vitest';
import { maskPhone, isPhoneBrValid } from './phone';
describe('phone', () => {
  it('mascara celular e fixo', () => {
    expect(maskPhone('43996661541')).toBe('(43) 99666-1541');
    expect(maskPhone('4333221100')).toBe('(43) 3322-1100');
  });
  it('valida DDD + 8/9 dígitos', () => {
    expect(isPhoneBrValid('(43) 99666-1541')).toBe(true);
    expect(isPhoneBrValid('99666')).toBe(false);
  });
});
```

Run: `npx vitest run src/lib/phone.test.ts` → PASS.

- [ ] **Step 2: `src/components/cadastro/UploadMultiplo.tsx`**

```tsx
import { useState } from 'react';
import { FileText, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type UploadMeta = { path: string; nome_original: string; tamanho: number };

interface Props {
  label: string;
  hint?: string;
  value: UploadMeta[];
  onChange: (next: UploadMeta[]) => void;
  onUpload: (file: File) => Promise<UploadMeta>;
}

const EXT = ['pdf', 'jpg', 'jpeg', 'png'];
const MAX_MB = 10;

/** Lista de arquivos + área de envio. Um arquivo por vez; o servidor valida de novo. */
export function UploadMultiplo({ label, hint, value, onChange, onUpload }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!EXT.includes(ext)) return setError(`Formato não aceito — use ${EXT.map((e) => `.${e}`).join(', ')}`);
    if (file.size > MAX_MB * 1024 * 1024) return setError(`Arquivo muito grande — máximo ${MAX_MB}MB`);
    setError('');
    setUploading(true);
    try {
      onChange([...value, await onUpload(file)]);
    } catch {
      setError('Falha no envio — tente de novo ou fale com o time Pipeelo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">{label} <span className="text-primary">*</span></p>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {value.map((f, i) => (
        <div key={f.path} className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3">
          <FileText className="h-5 w-5 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{f.nome_original}</p>
            <p className="text-xs text-muted-foreground">{(f.tamanho / 1024).toFixed(0)} KB — recebido ✓</p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remover ${f.nome_original}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <label className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:border-accent hover:bg-muted/50 ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
        {uploading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : <Upload className="h-6 w-6 text-muted-foreground" />}
        <span className="text-sm font-medium">{uploading ? 'Enviando…' : value.length ? 'Adicionar outro arquivo' : 'Clique para escolher o arquivo'}</span>
        <span className="text-xs text-muted-foreground">PDF, JPG ou PNG — até {MAX_MB}MB cada</span>
        <input type="file" className="hidden" accept={EXT.map((e) => `.${e}`).join(',')} disabled={uploading}
          onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Teste da página (RTL)**

```tsx
// src/pages/Cadastro.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    sessionApi: {
      ...actual.sessionApi,
      get: vi.fn(),
      cnpjLookup: vi.fn(async () => ({ razao_social: 'PROVEDOR X LTDA', nome_fantasia: 'Provedor X' })),
      cadastroSubmit: vi.fn(),
      uploadArquivo: vi.fn(),
    },
  };
});
import { sessionApi } from '@/lib/api-client';
import Cadastro from './Cadastro';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/cadastro/abc?token=tok-32-chars-xxxxxxxxxxxxxxxxxx']}>
      <Routes><Route path="/cadastro/:slug" element={<Cadastro />} /></Routes>
    </MemoryRouter>
  );
}

describe('Cadastro', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('mostra o passo 1 com o nome da empresa e preenche pela BrasilAPI', async () => {
    (sessionApi.get as never as ReturnType<typeof vi.fn>).mockResolvedValue({ session: { id: 's', slug: 'abc', empresa_nome: 'Provedor X', cadastro_enviado_at: null }, respostas: [] });
    renderPage();
    expect(await screen.findByText(/Dados da empresa/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/CNPJ/i), { target: { value: '11222333000181' } });
    await waitFor(() => expect(sessionApi.cnpjLookup).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByLabelText(/Razão social/i) as HTMLInputElement).value).toBe('PROVEDOR X LTDA'));
  });

  it('mostra confirmação quando o cadastro já foi enviado', async () => {
    (sessionApi.get as never as ReturnType<typeof vi.fn>).mockResolvedValue({ session: { id: 's', slug: 'abc', empresa_nome: 'Provedor X', cadastro_enviado_at: '2026-09-01', grupo_jid: '1@g.us', grupo_invite_url: 'https://chat.whatsapp.com/x' }, respostas: [] });
    renderPage();
    expect(await screen.findByText(/Cadastro recebido/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /entrar no grupo/i })).toHaveAttribute('href', 'https://chat.whatsapp.com/x');
  });

  it('não avança o passo 1 sem CNPJ válido', async () => {
    (sessionApi.get as never as ReturnType<typeof vi.fn>).mockResolvedValue({ session: { id: 's', slug: 'abc', empresa_nome: 'Provedor X', cadastro_enviado_at: null }, respostas: [] });
    renderPage();
    await screen.findByText(/Dados da empresa/i);
    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/CNPJ/i);
  });
});
```

- [ ] **Step 4: Rodar e ver falhar** — página não existe.

- [ ] **Step 5: Criar `src/pages/Cadastro.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { PipeeloLogo } from '@/components/PipeeloLogo';
import { UploadMultiplo, type UploadMeta } from '@/components/cadastro/UploadMultiplo';
import { sessionApi, ApiError, type ResultadoGrupoDTO, type SessionDTO } from '@/lib/api-client';
import { cleanCnpj, formatCnpj, validateCnpj } from '@/lib/cnpj';
import { isPhoneBrValid, maskPhone } from '@/lib/phone';

type Contato = { nome: string; whatsapp: string };
type Form = {
  cnpj: string; razao_social: string; nome_fantasia: string; inscricao_estadual: string;
  cobranca_email: string; cobranca_telefone: string; dia_vencimento: string; contrato_email: string;
  doc_contrato_social: UploadMeta[]; doc_responsaveis: UploadMeta[];
  responsavel_nome: string; responsavel_cargo: string; responsavel_email: string; responsavel_whatsapp: string;
  contatos_extras: Contato[]; aceite_dados: boolean;
};

const VAZIO: Form = {
  cnpj: '', razao_social: '', nome_fantasia: '', inscricao_estadual: '',
  cobranca_email: '', cobranca_telefone: '', dia_vencimento: '', contrato_email: '',
  doc_contrato_social: [], doc_responsaveis: [],
  responsavel_nome: '', responsavel_cargo: '', responsavel_email: '', responsavel_whatsapp: '',
  contatos_extras: [], aceite_dados: false,
};

const PASSOS = ['Dados da empresa', 'Cobrança', 'Contrato', 'Documentos', 'Responsável'] as const;
const DIAS = ['5', '10', '15', '20', '25'];
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

function storageKey(slug: string) { return `cadastro:${slug}`; }

export default function Cadastro() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [session, setSession] = useState<SessionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [passo, setPasso] = useState(0);
  const [form, setForm] = useState<Form>(VAZIO);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoGrupoDTO | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  // Carrega a sessão; se já enviou, mostra confirmação.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { session: s } = await sessionApi.get(slug, token);
        if (!alive) return;
        setSession(s);
        if (s.cadastro_enviado_at) {
          setResultado(s.grupo_jid
            ? { status: 'criado', jid: s.grupo_jid, invite_url: s.grupo_invite_url ?? null, nao_adicionados: [] }
            : { status: 'erro', motivo: s.grupo_erro ?? 'grupo_nao_criado' });
        } else {
          try {
            const saved = localStorage.getItem(storageKey(slug));
            if (saved) setForm({ ...VAZIO, ...(JSON.parse(saved) as Partial<Form>) });
          } catch { /* sem rascunho */ }
          if (s.dia_vencimento) setForm((f) => ({ ...f, dia_vencimento: f.dia_vencimento || String(s.dia_vencimento) }));
        }
      } catch (e) {
        if (!alive) return;
        setLoadError(e instanceof ApiError && e.status === 401 ? 'Link inválido ou expirado. Peça um novo link ao seu contato na Pipeelo.' : 'Não foi possível carregar o cadastro. Tente de novo em instantes.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [slug, token]);

  // Rascunho local (sem os arquivos, que já estão no servidor pelo path).
  useEffect(() => {
    if (!session || session.cadastro_enviado_at) return;
    try { localStorage.setItem(storageKey(slug), JSON.stringify(form)); } catch { /* quota */ }
  }, [form, session, slug]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Lookup do CNPJ ao completar 14 dígitos.
  const cnpjDigits = cleanCnpj(form.cnpj);
  useEffect(() => {
    if (cnpjDigits.length !== 14 || validateCnpj(cnpjDigits) !== null) return;
    let alive = true;
    setLookupBusy(true);
    sessionApi.cnpjLookup({ slug, token, cnpj: cnpjDigits })
      .then((r) => {
        if (!alive) return;
        setForm((f) => ({
          ...f,
          razao_social: f.razao_social || r.razao_social,
          nome_fantasia: f.nome_fantasia || r.nome_fantasia || r.razao_social,
        }));
      })
      .catch(() => { /* cliente digita à mão */ })
      .finally(() => { if (alive) setLookupBusy(false); });
    return () => { alive = false; };
  }, [cnpjDigits, slug, token]);

  const validarPasso = (): string => {
    switch (passo) {
      case 0:
        if (validateCnpj(form.cnpj) !== null) return 'Informe um CNPJ válido.';
        if (form.razao_social.trim().length < 3) return 'Informe a razão social.';
        if (form.nome_fantasia.trim().length < 2) return 'Informe o nome fantasia.';
        if (form.inscricao_estadual.trim().length < 2) return 'Informe a inscrição estadual (ou "Isento").';
        return '';
      case 1:
        if (!isEmail(form.cobranca_email)) return 'Informe um e-mail de cobrança válido.';
        if (!isPhoneBrValid(form.cobranca_telefone)) return 'Informe o telefone de cobrança com DDD.';
        if (!DIAS.includes(form.dia_vencimento)) return 'Escolha o dia do vencimento.';
        return '';
      case 2:
        return isEmail(form.contrato_email) ? '' : 'Informe um e-mail válido para o contrato.';
      case 3:
        if (!form.doc_contrato_social.length) return 'Anexe o contrato social ou a última alteração.';
        if (!form.doc_responsaveis.length) return 'Anexe o documento com foto dos responsáveis legais.';
        return '';
      case 4:
        if (form.responsavel_nome.trim().length < 3) return 'Informe seu nome completo.';
        if (form.responsavel_cargo.trim().length < 2) return 'Informe seu cargo.';
        if (!isEmail(form.responsavel_email)) return 'Informe um e-mail válido.';
        if (!isPhoneBrValid(form.responsavel_whatsapp)) return 'Informe seu WhatsApp com DDD.';
        for (const c of form.contatos_extras) {
          if (c.nome.trim().length < 2 || !isPhoneBrValid(c.whatsapp)) return 'Preencha nome e WhatsApp de cada contato extra, ou remova o contato.';
        }
        if (!form.aceite_dados) return 'Confirme que os dados e documentos estão corretos.';
        return '';
      default:
        return '';
    }
  };

  const avancar = () => {
    const e = validarPasso();
    setErro(e);
    if (e) return;
    if (passo < PASSOS.length - 1) setPasso(passo + 1);
    else void enviar();
  };

  const enviar = async () => {
    setEnviando(true);
    try {
      const { grupo } = await sessionApi.cadastroSubmit({
        slug, token,
        cadastro: { ...form, dia_vencimento: Number(form.dia_vencimento) },
      });
      setResultado(grupo);
      try { localStorage.removeItem(storageKey(slug)); } catch { /* ok */ }
    } catch (e) {
      setErro(e instanceof ApiError && e.status === 400 ? 'Algum campo está inválido. Revise os passos anteriores.' : 'Não foi possível enviar. Tente de novo em instantes.');
    } finally {
      setEnviando(false);
    }
  };

  const upload = (pergunta_id: 'doc_contrato_social' | 'doc_responsaveis') => async (file: File): Promise<UploadMeta> => {
    const base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    return sessionApi.uploadArquivo({ slug, token, departamento: 'cadastro', pergunta_id, nome: file.name, content_type: file.type, base64 });
  };

  const progresso = useMemo(() => Math.round(((passo + 1) / PASSOS.length) * 100), [passo]);

  if (loading) return <Shell><Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" /></Shell>;
  if (loadError) return <Shell><Card className="p-6"><p className="text-destructive" role="alert">{loadError}</p></Card></Shell>;

  if (resultado) {
    return (
      <Shell>
        <Card className="p-6 md:p-8 space-y-4">
          <CheckCircle2 className="h-10 w-10 text-primary" />
          <h1 className="text-2xl font-bold">Cadastro recebido</h1>
          {resultado.status === 'criado' ? (
            <>
              <p className="text-muted-foreground">Criamos o grupo <strong>Pipeelo &amp; {form.nome_fantasia || session?.empresa_nome}</strong> no WhatsApp com você como administrador. O link do formulário de onboarding já está lá.</p>
              {resultado.invite_url && (
                <>
                  <p className="text-sm text-muted-foreground">Se o seu WhatsApp não permitiu a adição automática, entre pelo link:</p>
                  <Button asChild><a href={resultado.invite_url} target="_blank" rel="noreferrer"><MessageCircle className="mr-2 h-4 w-4" />Entrar no grupo</a></Button>
                </>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Seus dados foram salvos. O grupo de WhatsApp será criado pelo time Pipeelo e você receberá o convite em breve.</p>
          )}
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground">{session?.empresa_nome}</p>
        <h1 className="text-2xl md:text-3xl font-bold">Cadastro</h1>
        <p className="text-muted-foreground mt-1">Passo {passo + 1} de {PASSOS.length} — {PASSOS[passo]}</p>
        <Progress value={progresso} className="mt-3" />
      </div>

      <Card className="p-6 md:p-8">
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); avancar(); }}>
          {passo === 0 && (
            <>
              <Campo id="cnpj" label="CNPJ" value={formatCnpj(form.cnpj)} onChange={(v) => set('cnpj', v)} placeholder="00.000.000/0000-00" inputMode="numeric" hint={lookupBusy ? 'Buscando dados na Receita…' : 'Preenchemos razão social e nome fantasia automaticamente.'} />
              <Campo id="razao_social" label="Razão social" value={form.razao_social} onChange={(v) => set('razao_social', v)} />
              <Campo id="nome_fantasia" label="Nome fantasia" value={form.nome_fantasia} onChange={(v) => set('nome_fantasia', v)} hint="Será o nome do seu grupo com a Pipeelo." />
              <Campo id="inscricao_estadual" label="Inscrição estadual" value={form.inscricao_estadual} onChange={(v) => set('inscricao_estadual', v)} placeholder='Ou "Isento"' />
            </>
          )}
          {passo === 1 && (
            <>
              <Campo id="cobranca_email" label="E-mail de cobrança" type="email" value={form.cobranca_email} onChange={(v) => set('cobranca_email', v)} placeholder="financeiro@empresa.com.br" />
              <Campo id="cobranca_telefone" label="Telefone de cobrança" type="tel" value={maskPhone(form.cobranca_telefone)} onChange={(v) => set('cobranca_telefone', maskPhone(v))} placeholder="(00) 00000-0000" />
              <div>
                <Label htmlFor="dia_vencimento">Dia do vencimento <span className="text-primary">*</span></Label>
                <Select value={form.dia_vencimento} onValueChange={(v) => set('dia_vencimento', v)}>
                  <SelectTrigger id="dia_vencimento" className="mt-2"><SelectValue placeholder="Escolha o dia" /></SelectTrigger>
                  <SelectContent>{DIAS.map((d) => <SelectItem key={d} value={d}>Dia {d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </>
          )}
          {passo === 2 && (
            <Campo id="contrato_email" label="E-mail para envio do contrato" type="email" value={form.contrato_email} onChange={(v) => set('contrato_email', v)} hint="Enviamos o contrato de prestação de serviço para este endereço." />
          )}
          {passo === 3 && (
            <>
              <UploadMultiplo label="Contrato social ou última alteração contratual" value={form.doc_contrato_social} onChange={(v) => set('doc_contrato_social', v)} onUpload={upload('doc_contrato_social')} />
              <UploadMultiplo label="Documento com foto dos responsáveis legais (RG ou CNH)" hint="Um arquivo por responsável." value={form.doc_responsaveis} onChange={(v) => set('doc_responsaveis', v)} onUpload={upload('doc_responsaveis')} />
            </>
          )}
          {passo === 4 && (
            <>
              <Campo id="responsavel_nome" label="Seu nome completo" value={form.responsavel_nome} onChange={(v) => set('responsavel_nome', v)} />
              <Campo id="responsavel_cargo" label="Cargo" value={form.responsavel_cargo} onChange={(v) => set('responsavel_cargo', v)} />
              <Campo id="responsavel_email" label="Seu e-mail" type="email" value={form.responsavel_email} onChange={(v) => set('responsavel_email', v)} />
              <Campo id="responsavel_whatsapp" label="Seu WhatsApp" type="tel" value={maskPhone(form.responsavel_whatsapp)} onChange={(v) => set('responsavel_whatsapp', maskPhone(v))} placeholder="(00) 00000-0000" hint="Você será administrador do grupo com a Pipeelo." />

              <div className="space-y-3">
                <p className="text-sm font-medium">Quer adicionar mais alguém ao grupo agora? <span className="text-muted-foreground font-normal">(opcional, até 2)</span></p>
                {form.contatos_extras.map((c, i) => (
                  <div key={i} className="grid grid-cols-12 gap-3 rounded-lg border p-3">
                    <div className="col-span-12 md:col-span-6">
                      <Label htmlFor={`extra_nome_${i}`}>Nome</Label>
                      <Input id={`extra_nome_${i}`} className="mt-1" value={c.nome} onChange={(e) => set('contatos_extras', form.contatos_extras.map((x, j) => j === i ? { ...x, nome: e.target.value } : x))} />
                    </div>
                    <div className="col-span-10 md:col-span-5">
                      <Label htmlFor={`extra_whatsapp_${i}`}>WhatsApp</Label>
                      <Input id={`extra_whatsapp_${i}`} className="mt-1" type="tel" value={maskPhone(c.whatsapp)} onChange={(e) => set('contatos_extras', form.contatos_extras.map((x, j) => j === i ? { ...x, whatsapp: maskPhone(e.target.value) } : x))} />
                    </div>
                    <div className="col-span-2 md:col-span-1 flex items-end">
                      <Button type="button" variant="ghost" size="sm" aria-label="Remover contato" onClick={() => set('contatos_extras', form.contatos_extras.filter((_, j) => j !== i))}>×</Button>
                    </div>
                  </div>
                ))}
                {form.contatos_extras.length < 2 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => set('contatos_extras', [...form.contatos_extras, { nome: '', whatsapp: '' }])}>Adicionar contato</Button>
                )}
              </div>

              <div className="flex items-start gap-3 rounded-lg border p-4">
                <Checkbox id="aceite" checked={form.aceite_dados} onCheckedChange={(v) => set('aceite_dados', v === true)} />
                <Label htmlFor="aceite" className="leading-snug">Confirmo que os dados e documentos estão corretos.</Label>
              </div>
            </>
          )}

          {erro && <p className="text-sm text-destructive" role="alert">{erro}</p>}

          <div className="flex items-center justify-between pt-2">
            <Button type="button" variant="ghost" disabled={passo === 0 || enviando} onClick={() => { setErro(''); setPasso(passo - 1); }}>
              <ArrowLeft className="mr-2 h-4 w-4" />Voltar
            </Button>
            <Button type="submit" size="lg" disabled={enviando} className="gap-2">
              {enviando ? <><Loader2 className="h-4 w-4 animate-spin" />Enviando…</> : passo === PASSOS.length - 1 ? <>Enviar cadastro<ArrowRight className="h-4 w-4" /></> : <>Continuar<ArrowRight className="h-4 w-4" /></>}
            </Button>
          </div>
        </form>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4"><PipeeloLogo size="md" /></div>
      </header>
      <main className="container mx-auto px-4 py-10 md:py-16"><div className="max-w-xl mx-auto">{children}</div></main>
    </div>
  );
}

function Campo(props: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; hint?: string; inputMode?: 'numeric' | 'text' | 'tel' | 'email';
}) {
  return (
    <div>
      <Label htmlFor={props.id}>{props.label} <span className="text-primary">*</span></Label>
      <Input id={props.id} className="mt-2 text-base py-5" type={props.type ?? 'text'} inputMode={props.inputMode} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
      {props.hint && <p className="mt-1 text-xs text-muted-foreground">{props.hint}</p>}
    </div>
  );
}
```

Observações para quem implementa: `toast` importado fica para erros de upload se quiser; se o lint reclamar de import sem uso, remover. Se `@/components/ui/progress` ou `checkbox` não existirem, gerar com `npx shadcn@latest add progress checkbox`.

- [ ] **Step 6: Rota** — em `src/App.tsx`: `import Cadastro from "./pages/Cadastro";` e, **antes** de `/:slug`:

```tsx
          <Route path="/cadastro/:slug" element={<Cadastro />} />
```

- [ ] **Step 7: Rodar** — `npx vitest run src/pages/Cadastro.test.tsx src/lib/phone.test.ts` → PASS. `npm run lint` sem erro novo.

- [ ] **Step 8: Commit**

```bash
git add src/lib/phone.ts src/lib/phone.test.ts src/components/cadastro/UploadMultiplo.tsx src/pages/Cadastro.tsx src/pages/Cadastro.test.tsx src/App.tsx
git commit -m "feat(cadastro): página /cadastro/:slug em 5 passos com upload e contato principal"
```

---

### Task 10: Equipe entra no grupo na conclusão

**Files:**
- Create: `api/_lib/equipe-grupo.ts`
- Modify: `api/_lib/whatsapp-notify.ts`
- Modify: `src/lib/questions.json` (repeater `equipe_pessoas`, `versao`, `total_perguntas`)
- Modify: `src/components/onboarding/QuestionRenderer.tsx` (campo `phone` no repeater)
- Test: `api/_lib/__tests__/equipe-grupo.test.ts`

**Interfaces:**
- Consumes: `updateParticipants`, `getParticipants`, `getInviteUrl`, `toJid`, `notifyStaff`, `sendTransactionalEmail`.
- Produces: `addTeamToGroup(supabase, sessionId: string, groupJid: string, empresaNome: string): Promise<{ adicionados: number; total: number; nao_adicionados: string[] }>`.

- [ ] **Step 1: Teste**

```ts
// api/_lib/__tests__/equipe-grupo.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../evolution', () => ({
  toJid: (d: string) => `55${d}@s.whatsapp.net`,
  updateParticipants: vi.fn(async () => undefined),
  getParticipants: vi.fn(),
  getInviteUrl: vi.fn(async () => 'https://chat.whatsapp.com/abc'),
  groupSubject: (n: string) => `Pipeelo & ${n}`,
}));
vi.mock('../staff-notify', () => ({ notifyStaff: vi.fn(async () => ({ sent: true })) }));
vi.mock('../email-sender', () => ({ sendTransactionalEmail: vi.fn(async () => ({ skipped: false })) }));
import { updateParticipants, getParticipants } from '../evolution';
import { notifyStaff } from '../staff-notify';
import { sendTransactionalEmail } from '../email-sender';
import { addTeamToGroup } from '../equipe-grupo';

const pessoas = [
  { nome: 'Ana', email: 'ana@x.com', whatsapp: '(43) 99666-1541', adicionar_grupo: 'sim' },
  { nome: 'Bia', email: 'bia@x.com', whatsapp: '(43) 99111-2233', adicionar_grupo: 'sim' },
  { nome: 'Caio', email: 'caio@x.com', whatsapp: '', adicionar_grupo: 'sim' },
  { nome: 'Dani', email: 'dani@x.com', whatsapp: '(43) 99000-0000', adicionar_grupo: 'nao' },
];
function sb(respostas: Array<{ pergunta_id: string; valor: unknown }>) {
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), in: vi.fn(async () => ({ data: respostas, error: null })) };
  return { from: vi.fn(() => chain) } as never;
}

describe('addTeamToGroup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adiciona quem tem whatsapp e marcou sim; relata quem não entrou', async () => {
    (getParticipants as never as ReturnType<typeof vi.fn>).mockResolvedValue(['5543996661541@s.whatsapp.net']);
    const r = await addTeamToGroup(sb([{ pergunta_id: 'equipe_pessoas', valor: pessoas }]), 's1', '1@g.us', 'Provedor X');
    expect(updateParticipants).toHaveBeenCalledWith('1@g.us', 'add', ['5543996661541@s.whatsapp.net', '5543991112233@s.whatsapp.net']);
    expect(r).toEqual({ adicionados: 1, total: 2, nao_adicionados: ['Bia'] });
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'bia@x.com', template: 'ConviteGrupo' }));
    expect(notifyStaff).toHaveBeenCalledWith(expect.stringContaining('1 de 2'));
  });
  it('sem equipe cadastrada não chama a Evolution', async () => {
    const r = await addTeamToGroup(sb([]), 's1', '1@g.us', 'Provedor X');
    expect(r).toEqual({ adicionados: 0, total: 0, nao_adicionados: [] });
    expect(updateParticipants).not.toHaveBeenCalled();
  });
  it('ignora número inválido sem derrubar os outros', async () => {
    (getParticipants as never as ReturnType<typeof vi.fn>).mockResolvedValue(['5543996661541@s.whatsapp.net']);
    const r = await addTeamToGroup(sb([{ pergunta_id: 'equipe_pessoas', valor: [pessoas[0], { nome: 'Zé', email: 'z@x.com', whatsapp: '123', adicionar_grupo: 'sim' }] }]), 's1', '1@g.us', 'X');
    expect(r.total).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Criar `api/_lib/equipe-grupo.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { toJid, updateParticipants, getParticipants, getInviteUrl, groupSubject } from './evolution';
import { notifyStaff } from './staff-notify';
import { sendTransactionalEmail } from './email-sender';

type PessoaEquipe = { nome?: string; email?: string; whatsapp?: string; adicionar_grupo?: string };

/**
 * Lê `equipe_pessoas` (sac_geral) e adiciona ao grupo quem tem WhatsApp e marcou
 * "adicionar ao grupo". Quem não entrou (privacidade) recebe o convite por e-mail.
 * Nunca lança.
 */
export async function addTeamToGroup(
  supabase: SupabaseClient,
  sessionId: string,
  groupJid: string,
  empresaNome: string
): Promise<{ adicionados: number; total: number; nao_adicionados: string[] }> {
  const vazio = { adicionados: 0, total: 0, nao_adicionados: [] as string[] };
  try {
    const { data, error } = await supabase
      .from('onboarding_respostas')
      .select('pergunta_id, valor')
      .eq('session_id', sessionId)
      .in('pergunta_id', ['equipe_pessoas']);
    if (error) throw error;
    const raw = data?.find((r) => r.pergunta_id === 'equipe_pessoas')?.valor;
    const lista: PessoaEquipe[] = Array.isArray(raw) ? raw : [];

    const alvo: Array<{ nome: string; email?: string; jid: string }> = [];
    for (const p of lista) {
      if ((p.adicionar_grupo ?? 'sim') !== 'sim' || !p.whatsapp) continue;
      try {
        alvo.push({ nome: p.nome?.trim() || p.email || 'sem nome', email: p.email?.trim() || undefined, jid: toJid(p.whatsapp) });
      } catch { /* número inválido: ignora */ }
    }
    if (alvo.length === 0) return vazio;

    await updateParticipants(groupJid, 'add', alvo.map((a) => a.jid));
    const dentro = new Set(await getParticipants(groupJid));
    const fora = alvo.filter((a) => !dentro.has(a.jid));

    if (fora.length) {
      const inviteUrl = await getInviteUrl(groupJid);
      for (const f of fora) {
        if (!f.email) continue;
        await sendTransactionalEmail({
          template: 'ConviteGrupo', sessionId, to: f.email,
          idempotencyKey: `convite-grupo:${sessionId}:${f.jid}`,
          props: { nome: f.nome, empresaNome, grupoNome: groupSubject(empresaNome), inviteUrl },
        });
      }
    }

    const resumo = { adicionados: alvo.length - fora.length, total: alvo.length, nao_adicionados: fora.map((f) => f.nome) };
    const linhas = [`👥 Equipe adicionada ao grupo ${groupSubject(empresaNome)}: ${resumo.adicionados} de ${resumo.total}`];
    if (fora.length) linhas.push(`Não entraram (privacidade): ${resumo.nao_adicionados.join(', ')} — convite enviado por e-mail`);
    await notifyStaff(linhas.join('\n'));
    return resumo;
  } catch (e) {
    console.error('[equipe-grupo] falhou:', e);
    await notifyStaff(`⚠️ Não consegui adicionar a equipe ao grupo de ${empresaNome}: ${e instanceof Error ? e.message : String(e)}`);
    return vazio;
  }
}
```

- [ ] **Step 4: Rodar** — `npx vitest run api/_lib/__tests__/equipe-grupo.test.ts` → PASS.

- [ ] **Step 5: Ligar em `whatsapp-notify.ts`**

1. `SessionRow` ganha `grupo_jid: string | null;` e o `select` inclui `grupo_jid`.
2. Trocar a busca do grupo:

```ts
    const group = data.grupo_jid
      ? { id: data.grupo_jid, subject: `Pipeelo & ${data.empresa_nome}` }
      : await findGroupByName(data.empresa_nome);
```

3. Depois do bloco do `integrationMsg` (ainda dentro do `try`), antes do `return { sent: true, ... }`:

```ts
    // Equipe da seção "Equipe e Acessos" entra no grupo. Falha aqui não desfaz o claim.
    const nomeFantasia = ((data as { cadastro?: { nome_fantasia?: string } | null }).cadastro?.nome_fantasia) || data.empresa_nome;
    void addTeamToGroup(supabase, sessionId, group.id, nomeFantasia);
```

e no `select`, incluir `cadastro`. Import: `import { addTeamToGroup } from './equipe-grupo';`.

- [ ] **Step 6: `questions.json`** — no repeater `equipe_pessoas` (linha ~637), reduzir `cidade` para `largura: 3` (já é) e acrescentar dois campos ao fim de `campos`:

```json
        {
          "id": "whatsapp",
          "label": "WhatsApp",
          "tipo": "phone",
          "obrigatoria": false,
          "placeholder": "(00) 00000-0000",
          "largura": 4
        },
        {
          "id": "adicionar_grupo",
          "label": "Adicionar ao grupo da Pipeelo?",
          "tipo": "select",
          "obrigatoria": false,
          "largura": 4,
          "opcoes": [
            { "value": "sim", "label": "Sim" },
            { "value": "nao", "label": "Não" }
          ]
        }
```

Atualizar o `hint` da pergunta para: `"Cada pessoa listada aqui recebe um acesso à plataforma no e-mail informado. Quem tiver WhatsApp entra no grupo com a Pipeelo."`. Em `onboarding_structure`: `"versao": "3.6.0"`. `total_perguntas` não muda (campos de repeater não contam).

- [ ] **Step 7: `QuestionRenderer.tsx`** — no `case 'repeater'`, logo após o bloco de `campo.tipo === 'text' || …` (linha ~552), acrescentar suporte a `phone` usando `maskPhone` de `@/lib/phone` (adicionar o import no topo):

```tsx
                        {campo.tipo === 'phone' && (
                          <Input
                            type="tel"
                            inputMode="tel"
                            value={maskPhone(String(fieldVal ?? ''))}
                            onChange={(e) => updateItem(idx, { [campo.id]: maskPhone(e.target.value) })}
                            placeholder={campo.placeholder ?? '(00) 00000-0000'}
                            className="text-base"
                          />
                        )}
```

Se o tipo `campos[].tipo` for uma união literal em algum `.ts` de tipos das perguntas, incluir `'phone'` nela. O `case 'phone'` de nível de pergunta pode passar a usar o mesmo `maskPhone` importado (remover a cópia local).

- [ ] **Step 8: Rodar** — `npx vitest run` (toda a suíte, inclusive snapshots do renderer; atualizar snapshot só se a diferença for o campo novo) e `npx tsc --noEmit -p tsconfig.app.json`.

- [ ] **Step 9: Commit**

```bash
git add api/_lib/equipe-grupo.ts api/_lib/__tests__/equipe-grupo.test.ts api/_lib/whatsapp-notify.ts src/lib/questions.json src/components/onboarding/QuestionRenderer.tsx
git commit -m "feat(equipe): adiciona a equipe ao grupo na conclusão e usa o grupo salvo"
```

---

### Task 11: Identificação pré-preenchida pelo cadastro

**Files:**
- Modify: `src/pages/Onboarding.tsx` (bloco de hidratação, ~linhas 111-129)
- Test: `src/pages/Onboarding.prefill.test.tsx`

**Interfaces:**
- Consumes: `SessionDTO.cadastro` (`cnpj`, `razao_social`, `nome_fantasia`).

- [ ] **Step 1: Teste** (segue o padrão dos testes já existentes de `Onboarding.tsx`, se houver; caso contrário este é o primeiro)

```tsx
// src/pages/Onboarding.prefill.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, sessionApi: { ...actual.sessionApi, get: vi.fn(), saveResposta: vi.fn(async () => ({ ok: true, saved_at: '' })) } };
});
import { sessionApi } from '@/lib/api-client';
import Onboarding from './Onboarding';

describe('Onboarding — prefill da Identificação', () => {
  beforeEach(() => vi.clearAllMocks());
  it('usa o CNPJ do cadastro quando ainda não há resposta', async () => {
    (sessionApi.get as never as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: {
        id: 's', slug: 'abc', empresa_nome: 'Provedor X', modo: 'completo',
        status_identificacao: 'pendente', status_sac_geral: 'pendente', status_financeiro: 'pendente', status_suporte: 'pendente', status_vendas: 'pendente',
        cadastro: { cnpj: '11222333000181', razao_social: 'PROVEDOR X LTDA', nome_fantasia: 'Provedor X' },
      },
      respostas: [],
    });
    render(
      <MemoryRouter initialEntries={['/abc/identificacao?token=tok-32-chars-xxxxxxxxxxxxxxxxxx']}>
        <Routes><Route path="/:slug/:departamento" element={<Onboarding />} /></Routes>
      </MemoryRouter>
    );
    const input = await screen.findByPlaceholderText('00.000.000/0000-00');
    expect((input as HTMLInputElement).value).toBe('11.222.333/0001-81');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** (valor vazio).

- [ ] **Step 3: Implementar** — em `Onboarding.tsx`, logo após o `ofDept.forEach(...)` que hidrata as respostas:

```ts
        // Identificação: dados já informados no /cadastro entram como default
        // (só quando o cliente ainda não respondeu). O autosave persiste ao avançar.
        if (urlDepartamento === 'identificacao') {
          const cad = (session as { cadastro?: Record<string, unknown> | null }).cadastro ?? null;
          const respondidas = new Set(ofDept.map((r) => r.pergunta_id));
          const prefill: Array<[string, unknown]> = [
            ['cnpj', cad?.cnpj],
            ['razao_social', cad?.razao_social],
            ['nome_fantasia', cad?.nome_fantasia],
          ];
          for (const [id, valor] of prefill) {
            if (!respondidas.has(id) && typeof valor === 'string' && valor) setResposta(id, valor);
          }
        }
```

Se o renderer de `cnpj` espera valor com máscara, aplicar `formatCnpj` (de `@/lib/cnpj`) no `cnpj` antes de `setResposta`.

- [ ] **Step 4: Rodar** — `npx vitest run src/pages/Onboarding.prefill.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Onboarding.tsx src/pages/Onboarding.prefill.test.tsx
git commit -m "feat(identificacao): pré-preenche CNPJ, razão social e fantasia pelo cadastro"
```

---

### Task 12: Verificação ponta a ponta, envs, deploy

**Files:**
- Modify: `public/build-info.json`
- Modify: `README.md` (seção de envs)

- [ ] **Step 1: Suíte e build completos**

```bash
npm test
npm run lint
npm run audit:no-supabase-from
npm run build
```
Expected: tudo verde, build gera `dist/`.

- [ ] **Step 2: Envs no EasyPanel** (serviço `onboarding-pipeelo`), via painel `easypanel.pipeelo.com`:

- `STAFF_GROUP_JID=120363428470826804@g.us`
- `PUBLIC_BASE_URL=https://onboarding.pipeelo.com`

Conferir que `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_INSTANCE=Avisos` e `EVOLUTION_API_KEY` já existem. Documentar as duas novas no `README.md`, na lista de variáveis de ambiente.

- [ ] **Step 3: Sonda de deploy** — `public/build-info.json`:

```json
{"commit":"cadastro-grupo","feature":"Página /cadastro/:slug cria grupo WhatsApp (Evolution) com admin + boas-vindas; equipe entra no grupo na conclusão — questions.json 3.6.0/140"}
```

- [ ] **Step 4: Commit e push**

```bash
git add public/build-info.json README.md
git commit -m "chore: sonda de deploy e envs do cadastro com grupo WhatsApp"
git push origin main
```

- [ ] **Step 5: Confirmar deploy** — aguardar o build do EasyPanel e conferir:

```bash
curl -s https://onboarding.pipeelo.com/build-info.json
```
Expected: `"commit":"cadastro-grupo"`.

- [ ] **Step 6: Teste real com sessão de teste** (ação com efeito real na Evolution; Felipe já autorizou o teste com o número dele)

1. No `/admin`, criar sessão "Teste Cadastro Grupo" e copiar o **Link de cadastro**.
2. Preencher os 5 passos com o WhatsApp do Felipe como responsável e um PDF pequeno em cada upload.
3. Conferir: grupo "Pipeelo & Teste Cadastro Grupo" criado na instância Avisos, Felipe como admin, boas-vindas com link curto no grupo, aviso no Staff.
4. Reabrir o link de cadastro: tela de confirmação, sem novo grupo.
5. No `/admin`: badge "Cadastro + grupo OK".
6. Excluir o grupo de teste no WhatsApp e apagar a sessão de teste no `/admin`.

Registrar o resultado (JID criado, mensagens recebidas) na resposta final.

---

## Self-review

**Cobertura da spec:**
- Página `/cadastro/:slug`, 5 passos, campos, uploads, contato principal + 2 extras, aceite → Task 9.
- Upload pdf/imagem 10 MB, contexto `cadastro` → Task 5.
- `cadastro-submit` (salvar, criar grupo, promover, conferir, e-mail convite, boas-vindas, Staff, idempotente, rate limit) → Tasks 4, 7.
- `cnpj-lookup` → Task 6.
- `cadastro-recriar-grupo` + UI admin (link, estado, botão) → Task 8.
- Cliente Evolution (createGroup, updateParticipants, getParticipants, getInviteUrl, toJid) → Task 2.
- Conclusão usa `grupo_jid`; `addTeamToGroup`; Staff → Task 10.
- Identificação pré-preenchida → Task 11.
- Equipe: `whatsapp` + `adicionar_grupo`, `versao` 3.6.0 → Task 10.
- Banco (7 colunas, índice único parcial) → Task 1.
- Envs, build-info, deploy, teste manual → Task 12.
- Fora de escopo (contrato automático, provisionamento, OCR, página pública, migração de sessões antigas) — nenhum task os implementa.

**Consistência de nomes:** `criarGrupoParaSessao`, `ResultadoGrupo`/`ResultadoGrupoDTO`, `addTeamToGroup`, `ensureShortLink`, `onboardingTargetUrl`, `notifyStaff`, `toJid`, `groupSubject`, `updateParticipants('add'|'promote')`, template `ConviteGrupo` — usados com o mesmo nome em todas as tasks.

**Dependência entre tasks:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12. Tasks 5, 6 e 9 só dependem de 1; podem rodar em paralelo com 2–4 se houver mais de um executor.
