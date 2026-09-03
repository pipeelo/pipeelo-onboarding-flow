/**
 * Cliente mínimo da Evolution API (WhatsApp) usado pelo onboarding.
 *
 * Duas instancias (dois numeros de WhatsApp):
 *   'padrao' - numero historico. Avisos no Staff e TODOS os grupos criados antes
 *              da fila cadenciada: ele e o admin deles, o numero novo nao e.
 *   'grupos' - numero dedicado a criar e popular os grupos novos. E o que corre
 *              risco de ser derrubado, entao so ele passa pela fila cadenciada.
 *
 * Env vars (config no EasyPanel):
 *   EVOLUTION_API_BASE_URL     ex: https://pipeelo-evolution-api.zhh0vo.easypanel.host
 *   EVOLUTION_API_INSTANCE     ex: Avisos
 *   EVOLUTION_API_KEY          header `apikey`
 *   EVOLUTION_GRUPOS_BASE_URL  numero dedicado aos grupos. Enquanto nao estiverem
 *   EVOLUTION_GRUPOS_INSTANCE  setadas, 'grupos' cai no numero padrao.
 *   EVOLUTION_GRUPOS_KEY
 */

export type InstanciaEvolution = 'padrao' | 'grupos';

export class EvolutionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvolutionConfigError';
  }
}

export class EvolutionApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'EvolutionApiError';
  }
}

/**
 * Config da instancia. 'grupos' cai no numero padrao enquanto o numero dedicado
 * nao estiver conectado - assim nada quebra antes de configurar o EasyPanel.
 */
function getConfig(inst: InstanciaEvolution = 'padrao') {
  const dedicada = inst === 'grupos';
  const baseUrl = (dedicada ? process.env.EVOLUTION_GRUPOS_BASE_URL : undefined) ?? process.env.EVOLUTION_API_BASE_URL;
  const instance = (dedicada ? process.env.EVOLUTION_GRUPOS_INSTANCE : undefined) ?? process.env.EVOLUTION_API_INSTANCE;
  const apiKey = (dedicada ? process.env.EVOLUTION_GRUPOS_KEY : undefined) ?? process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !instance || !apiKey) {
    throw new EvolutionConfigError(
      'Faltam env vars: EVOLUTION_API_BASE_URL, EVOLUTION_API_INSTANCE, EVOLUTION_API_KEY'
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), instance, apiKey };
}

/** true quando o numero dedicado aos grupos esta configurado de fato. */
export function temInstanciaDeGrupos(): boolean {
  return Boolean(
    process.env.EVOLUTION_GRUPOS_BASE_URL &&
    process.env.EVOLUTION_GRUPOS_INSTANCE &&
    process.env.EVOLUTION_GRUPOS_KEY
  );
}

export type EvolutionGroup = {
  id: string;
  subject: string;
  size?: number;
};

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // remove TODOS os combining marks (Unicode-aware)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Busca grupo WhatsApp pelo nome da empresa.
 *
 * Convenção dos grupos Pipeelo: o nome do grupo SEMPRE segue o padrão
 * "Pipeelo & {empresa}" (ou variantes "Pipeelo e {empresa}",
 * "Pipeelo - {empresa}"). O matcher tenta nessa ordem:
 *
 *   1. Match exato com "Pipeelo & {empresa}"
 *   2. Match exato com variantes ("e", "-", "&", "+")
 *   3. startsWith "pipeelo & {empresa}"
 *   4. includes "{empresa}" como palavra (regex word boundary)
 *   5. includes "{empresa}" simples (último recurso)
 *
 * Retorna o primeiro match ou null. Comparações são case-insensitive
 * e ignoram acentos.
 */
export async function findGroupByName(name: string, inst: InstanciaEvolution = 'padrao'): Promise<EvolutionGroup | null> {
  const { baseUrl, instance, apiKey } = getConfig(inst);
  const url = `${baseUrl}/group/fetchAllGroups/${encodeURIComponent(instance)}?getParticipants=false`;
  const r = await fetch(url, { headers: { apikey: apiKey } });
  if (!r.ok) {
    throw new EvolutionApiError(r.status, await r.text());
  }
  const groups = (await r.json()) as Array<{ id: string; subject?: string; size?: number }>;
  const empresa = normalize(name);
  if (!empresa) return null;

  type G = { id: string; subject: string; norm: string };
  const list: G[] = groups.map((g) => ({
    id: g.id,
    subject: g.subject ?? '',
    norm: normalize(g.subject ?? ''),
  }));

  const candidates = [
    `pipeelo & ${empresa}`,
    `pipeelo e ${empresa}`,
    `pipeelo - ${empresa}`,
    `pipeelo + ${empresa}`,
    empresa,
  ];

  // 1. exact match em qualquer candidato
  for (const c of candidates) {
    const hit = list.find((g) => g.norm === c);
    if (hit) return { id: hit.id, subject: hit.subject };
  }

  // 2. startsWith em qualquer candidato
  for (const c of candidates) {
    const hit = list.find((g) => g.norm.startsWith(c));
    if (hit) return { id: hit.id, subject: hit.subject };
  }

  // 3. word-boundary includes do nome da empresa
  const wordRe = new RegExp(`\\b${empresa.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const wordHit = list.find((g) => wordRe.test(g.norm));
  if (wordHit) return { id: wordHit.id, subject: wordHit.subject };

  // 4. includes simples (último recurso)
  const incl = list.find((g) => g.norm.includes(empresa));
  if (incl) return { id: incl.id, subject: incl.subject };

  return null;
}

/**
 * JID individual → JID que o WhatsApp realmente conhece. Celular BR pode estar
 * registrado SEM o nono dígito; o sendText com o 9 devolve 400 `exists:false`.
 * Qualquer falha devolve o JID original.
 */
export async function resolveJid(jid: string, inst: InstanciaEvolution = 'padrao'): Promise<string> {
  if (!jid.endsWith('@s.whatsapp.net')) return jid;
  const { baseUrl, instance, apiKey } = getConfig(inst);
  try {
    const r = await fetch(`${baseUrl}/chat/whatsappNumbers/${encodeURIComponent(instance)}`, {
      method: 'POST',
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ numbers: [jid.replace(/@.*$/, '')] }),
    });
    if (!r.ok) return jid;
    const lista = (await r.json().catch(() => null)) as Array<{ jid?: string; exists?: boolean }> | null;
    const achado = Array.isArray(lista) ? lista.find((n) => n?.exists && n.jid) : null;
    return achado?.jid ?? jid;
  } catch {
    return jid;
  }
}

export async function sendText(jidPedido: string, text: string, inst: InstanciaEvolution = 'padrao'): Promise<{ ok: true }> {
  const { baseUrl, instance, apiKey } = getConfig(inst);
  const jid = await resolveJid(jidPedido, inst);
  const url = `${baseUrl}/message/sendText/${encodeURIComponent(instance)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      number: jid,
      text,
      delay: 1000,
      linkPreview: false,
    }),
  });
  if (!r.ok) {
    throw new EvolutionApiError(r.status, await r.text());
  }
  return { ok: true };
}

// ---- Grupos ---------------------------------------------------------------

export function toJid(phoneDigits: string): string {
  let d = phoneDigits.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) throw new Error('telefone_invalido');
  return `55${d}@s.whatsapp.net`;
}

/**
 * Chave de comparação de números BR no WhatsApp: celulares podem aparecer com ou sem o
 * nono dígito (55 43 99666-1541 ≡ 55 43 9666-1541). Normaliza para a forma SEM o 9.
 */
export function chaveNumero(jidOuTelefone: string): string {
  let d = jidOuTelefone.replace(/@.*$/, '').replace(/\D/g, '');
  if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = `55${d}`;
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') d = d.slice(0, 4) + d.slice(5);
  return d;
}

export function mesmoNumero(a: string, b: string): boolean {
  return chaveNumero(a) === chaveNumero(b);
}

/** (43) 99666-1541 — para as mensagens que uma pessoa vai ler. */
export function fmtTelefone(d: string): string {
  const n = d.replace(/\D/g, '');
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return d;
}

export function groupSubject(nomeFantasia: string): string {
  return `Pipeelo & ${nomeFantasia.trim().replace(/\s+/g, ' ')}`;
}

async function evoRequest<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string> } = {},
  inst: InstanciaEvolution = 'padrao'
): Promise<T> {
  const { baseUrl, instance, apiKey } = getConfig(inst);
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
  participants: string[],
  inst: InstanciaEvolution = 'padrao'
): Promise<{ groupJid: string; inviteCode: string | null }> {
  const data = await evoRequest<{ groupJid?: string; id?: string; inviteCode?: string }>('group/create', {
    method: 'POST',
    body: JSON.stringify({ subject, participants }),
  }, inst);
  const groupJid = data.groupJid ?? data.id;
  if (!groupJid) throw new EvolutionApiError(502, 'group_create_sem_jid');
  return { groupJid, inviteCode: data.inviteCode ?? null };
}

export async function updateParticipants(
  groupJid: string,
  action: 'add' | 'promote',
  participants: string[],
  inst: InstanciaEvolution = 'padrao'
): Promise<void> {
  if (participants.length === 0) return;
  // Evolution 2.3.x desta instância só aceita POST aqui (a doc v2 diz PUT → 404).
  await evoRequest('group/updateParticipant', {
    method: 'POST',
    query: { groupJid },
    body: JSON.stringify({ action, participants }),
  }, inst);
}

/**
 * JIDs dos participantes. A Evolution 2.3.x devolve `id` como `…@lid` e o número real
 * em `phoneNumber` (`55…@s.whatsapp.net`); preferimos o telefone para bater com `toJid`.
 */
export async function getParticipants(groupJid: string, inst: InstanciaEvolution = 'padrao'): Promise<string[]> {
  type P = { id: string; phoneNumber?: string | null };
  const data = await evoRequest<{ participants?: P[] } | P[]>('group/participants', { query: { groupJid } }, inst);
  const list = Array.isArray(data) ? data : data.participants ?? [];
  return list.map((p) => p.phoneNumber || p.id);
}

export async function getInviteUrl(groupJid: string, inst: InstanciaEvolution = 'padrao'): Promise<string> {
  const data = await evoRequest<{ inviteCode?: string; inviteUrl?: string }>('group/inviteCode', {
    query: { groupJid },
  }, inst);
  if (data.inviteUrl) return data.inviteUrl;
  if (!data.inviteCode) throw new EvolutionApiError(502, 'invite_code_vazio');
  return `https://chat.whatsapp.com/${data.inviteCode}`;
}
