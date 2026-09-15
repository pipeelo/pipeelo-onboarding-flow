// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { criarClienteContaAzul, EM_ANDAMENTO, numero, type SessaoCobranca } from '../conta-azul';
import type { Cadastro } from '../schemas/cadastro';

const upload = { path: 'p', nome_original: 'a.pdf', tamanho: 1 };

const cadastro: Cadastro = {
  cnpj: '11222333000181',
  razao_social: 'PROVEDOR X LTDA',
  nome_fantasia: 'Provedor X',
  inscricao_estadual: 'Isento',
  cobranca_email: 'financeiro@x.com',
  cobranca_telefone: '4333221100',
  dia_vencimento: 10,
  contrato_email: 'juridico@x.com',
  doc_contrato_social: [upload],
  doc_responsaveis: [upload],
  responsavel_nome: 'Ana Souza',
  responsavel_cargo: 'CEO',
  responsavel_email: 'ana@x.com',
  responsavel_whatsapp: '43996661541',
  contatos_extras: [],
  aceite_dados: true,
};

const sessao: SessaoCobranca = {
  id: 's1',
  slug: 'provedor-x',
  contrato_extracao: { endereco_sede: 'Rua A, 100, Londrina/PR' },
};

/**
 * Supabase de mentira. Registra o que foi gravado na sessão e permite escolher
 * o resultado da reserva (`update … .select('id')`), que é a trava contra
 * cobrança dupla.
 */
function sb(reserva: { data: unknown; error: unknown } = { data: [{ id: 's1' }], error: null }) {
  const updates: Array<Record<string, unknown>> = [];
  const cadeia = () => {
    const obj: Record<string, unknown> = {
      is: () => obj,
      or: () => obj,
      select: async () => reserva,
      // `await supabase.from(...).update(...).eq(...)` — o patch simples.
      then: (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(ok, falha),
    };
    return obj;
  };
  const supabase = {
    from: () => ({
      update: (data: Record<string, unknown>) => {
        updates.push(data);
        return { eq: () => cadeia() };
      },
    }),
  };
  return { supabase: supabase as never, updates };
}

const reservou = (updates: Array<Record<string, unknown>>) =>
  updates.some((u) => u.ca_erro === EM_ANDAMENTO);
const ultimo = (updates: Array<Record<string, unknown>>) => updates[updates.length - 1];

function resposta(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response;
}

describe('numero', () => {
  it('aceita ponto, vírgula e separador de milhar', () => {
    expect(numero(1234.56)).toBe(1234.56);
    expect(numero('1234,56')).toBe(1234.56);
    expect(numero('1.234,56')).toBe(1234.56);
    expect(numero('1,234.56')).toBe(1234.56);
    expect(numero('R$ 4.000,00')).toBe(4000);
    expect(numero('4.000')).toBe(4000);
  });

  it('devolve null quando não dá para interpretar', () => {
    expect(numero(null)).toBeNull();
    expect(numero('')).toBeNull();
    expect(numero('abc')).toBeNull();
  });
});

describe('criarClienteContaAzul', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CA_INTERNAL_SECRET = 'segredo';
    delete process.env.VENDAS_API_URL;
  });
  afterEach(() => {
    delete process.env.CA_INTERNAL_SECRET;
  });

  it('201 cria só o cliente: payload sem implantação nem mensalidade', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      resposta(201, { ok: true, cliente_id: 'ca-123', implantacao: null, mensalidade: null, recorrente: { contrato_id: null }, aguardando_go_live: true }),
    );
    const { supabase, updates } = sb();
    const r = await criarClienteContaAzul(supabase, sessao, cadastro);

    expect(r).toEqual({ status: 'cliente_criado', cliente_id: 'ca-123' });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://pipeelo.com/api/conta-azul?action=cadastro');
    const body = JSON.parse(String(init.body));
    expect(body.secret).toBe('segredo');
    expect(body.sessao_slug).toBe('provedor-x');
    expect(body.empresa).toMatchObject({
      razao_social: 'PROVEDOR X LTDA',
      cnpj: '11222333000181',
      email_cobranca: 'financeiro@x.com',
      telefone: '4333221100',
      endereco: 'Rua A, 100, Londrina/PR',
    });
    // Sem cobrança: nem implantação, nem mensalidade, nem recorrente.
    expect(body.implantacao).toBeNull();
    expect(body).not.toHaveProperty('mensalidade');

    expect(reservou(updates)).toBe(true);
    expect(ultimo(updates)).toEqual({ ca_cliente_id: 'ca-123', ca_erro: null });
  });

  it('não manda cobrança mesmo com valores e go-live preenchidos na sessão', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(201, { ok: true, cliente_id: 'x' }));
    const { supabase } = sb();
    const cheia = { ...sessao, valor_implantacao: 4000, implantacao_vencimento: '2026-09-15', valor_mensal: 2508, go_live_em: '2026-10-07', dia_vencimento: 10 };
    await criarClienteContaAzul(supabase, cheia as SessaoCobranca, cadastro);
    const body = JSON.parse(String((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.implantacao).toBeNull();
    expect(body).not.toHaveProperty('mensalidade');
  });

  it('201 sem cliente_id vira pendente', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(201, { ok: true }));
    const { supabase, updates } = sb();
    const r = await criarClienteContaAzul(supabase, sessao, cadastro);
    expect(r).toEqual({ status: 'pendente', motivo: 'Resposta inesperada do Conta Azul (HTTP 201)' });
    expect(ultimo(updates)).toEqual({ ca_erro: 'Resposta inesperada do Conta Azul (HTTP 201)' });
  });

  it('reserva perdida (outra execução em curso ou cliente já criado) não chama a API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { supabase } = sb({ data: [], error: null });
    const r = await criarClienteContaAzul(supabase, sessao, cadastro);
    expect(r).toEqual({ status: 'pendente', motivo: 'criação em andamento ou cliente já criado' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('erro ao reservar também não chama a API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { supabase } = sb({ data: null, error: { message: 'db down' } });
    const r = await criarClienteContaAzul(supabase, sessao, cadastro);
    expect(r.status).toBe('pendente');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('usa VENDAS_API_URL quando configurado', async () => {
    process.env.VENDAS_API_URL = 'https://staging.pipeelo.com/';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(201, { ok: true, cliente_id: 'x' }));
    const { supabase } = sb();
    await criarClienteContaAzul(supabase, sessao, cadastro);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://staging.pipeelo.com/api/conta-azul?action=cadastro');
  });

  it('200 com ok:false vira pendente e grava ca_erro', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(200, { ok: false, etapa: 'pessoa', erro: 'token expirado' }));
    const { supabase, updates } = sb();
    const r = await criarClienteContaAzul(supabase, sessao, cadastro);
    expect(r).toMatchObject({ status: 'pendente', motivo: 'Conta Azul falhou em "pessoa": token expirado' });
    expect(ultimo(updates)).toEqual({ ca_erro: 'Conta Azul falhou em "pessoa": token expirado' });
  });

  it('409 é "em andamento": pendente e libera a marca de processando', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(409, { ok: false, erro: 'em_andamento' }));
    const { supabase, updates } = sb();
    const r = await criarClienteContaAzul(supabase, sessao, cadastro);
    expect(r.status).toBe('pendente');
    expect(reservou(updates)).toBe(true);
    expect(ultimo(updates)).toEqual({ ca_erro: null });
  });

  it('401 vira pendente com o motivo gravado', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(401, { erro: 'secret inválido' }));
    const { supabase, updates } = sb();
    const r = await criarClienteContaAzul(supabase, sessao, cadastro);
    expect(r).toEqual({ status: 'pendente', motivo: 'Conta Azul recusou o pedido: secret inválido' });
    expect(ultimo(updates)).toEqual({ ca_erro: 'Conta Azul recusou o pedido: secret inválido' });
  });

  it('sem CA_INTERNAL_SECRET não chama a API', async () => {
    delete process.env.CA_INTERNAL_SECRET;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { supabase, updates } = sb();
    const r = await criarClienteContaAzul(supabase, sessao, cadastro);
    expect(r).toEqual({ status: 'pendente', motivo: 'CA_INTERNAL_SECRET não configurado' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reservou(updates)).toBe(false);
    expect(updates).toEqual([{ ca_erro: 'CA_INTERNAL_SECRET não configurado' }]);
  });

  it('falha de rede não lança', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const { supabase, updates } = sb();
    const r = await criarClienteContaAzul(supabase, sessao, cadastro);
    expect(r.status).toBe('pendente');
    expect(String(ultimo(updates).ca_erro)).toContain('ECONNREFUSED');
  });
});
