// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cobrarContaAzul, EM_ANDAMENTO, faltamDadosDoFechamento, numero, type SessaoCobranca } from '../conta-azul';
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
  valor_implantacao: 4000,
  implantacao_vencimento: '2026-09-15',
  valor_mensal: 2508,
  primeira_mensalidade_em: '2026-10-10',
  dia_vencimento: 10,
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

describe('cobrarContaAzul', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CA_INTERNAL_SECRET = 'segredo';
    delete process.env.VENDAS_API_URL;
  });
  afterEach(() => {
    delete process.env.CA_INTERNAL_SECRET;
  });

  it('não chama a API quando falta dado do fechamento e grava o motivo', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { supabase, updates } = sb();
    const r = await cobrarContaAzul(supabase, { ...sessao, valor_implantacao: null, dia_vencimento: null }, cadastro);
    expect(r).toEqual({
      status: 'pendente',
      motivo: 'faltam dados do fechamento: valor da implantação, dia de vencimento',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reservou(updates)).toBe(false);
    expect(updates).toEqual([{ ca_erro: 'faltam dados do fechamento: valor da implantação, dia de vencimento' }]);
  });

  it('valor impossível de interpretar vira pendente antes da rede', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { supabase, updates } = sb();
    const r = await cobrarContaAzul(supabase, { ...sessao, valor_mensal: 'combinar' }, cadastro);
    expect(r).toEqual({ status: 'pendente', motivo: 'valores inválidos no fechamento: valor mensal' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reservou(updates)).toBe(false);
  });

  it('lista todos os campos obrigatórios que faltam', () => {
    expect(faltamDadosDoFechamento({ id: 's1' })).toHaveLength(5);
    expect(faltamDadosDoFechamento(sessao)).toEqual([]);
  });

  it('201 grava cliente, links e data da cobrança', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      resposta(201, {
        ok: true,
        cliente_id: 'ca-123',
        implantacao: { venda_id: 'v1', vencimento: '2026-09-15', url: 'https://boleto/impl' },
        mensalidade: { venda_id: 'v2', vencimento: '2026-10-10', url: 'https://boleto/mens' },
        recorrente: { contrato_id: 'c1' },
      }),
    );
    const { supabase, updates } = sb();
    const r = await cobrarContaAzul(supabase, sessao, cadastro);

    expect(r).toEqual({
      status: 'cobrado',
      implantacao_url: 'https://boleto/impl',
      mensalidade_url: 'https://boleto/mens',
      recorrente: true,
    });

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
    expect(body.implantacao).toEqual({ valor: 4000, vencimento: '2026-09-15' });
    expect(body.mensalidade).toEqual({ valor: 2508, primeira_em: '2026-10-10', dia_vencimento: 10 });

    expect(reservou(updates)).toBe(true);
    expect(ultimo(updates)).toMatchObject({
      ca_cliente_id: 'ca-123',
      ca_implantacao_url: 'https://boleto/impl',
      ca_mensalidade_url: 'https://boleto/mens',
      ca_erro: null,
    });
    expect(ultimo(updates).ca_cobrado_at).toBeTruthy();
  });

  it('valores com máscara chegam como número no payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(201, { ok: true, cliente_id: 'x' }));
    const { supabase } = sb();
    await cobrarContaAzul(supabase, { ...sessao, valor_implantacao: '4.000,00', valor_mensal: '2.508,50' }, cadastro);
    const body = JSON.parse(String((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.implantacao.valor).toBe(4000);
    expect(body.mensalidade.valor).toBe(2508.5);
  });

  it('reserva perdida (outra execução em curso ou já cobrado) não chama a API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { supabase } = sb({ data: [], error: null });
    const r = await cobrarContaAzul(supabase, sessao, cadastro);
    expect(r).toEqual({ status: 'pendente', motivo: 'cobrança em andamento ou já feita' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('erro ao reservar também não cobra', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { supabase } = sb({ data: null, error: { message: 'db down' } });
    const r = await cobrarContaAzul(supabase, sessao, cadastro);
    expect(r.status).toBe('pendente');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('usa VENDAS_API_URL quando configurado', async () => {
    process.env.VENDAS_API_URL = 'https://staging.pipeelo.com/';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(201, { ok: true, cliente_id: 'x' }));
    const { supabase } = sb();
    await cobrarContaAzul(supabase, sessao, cadastro);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://staging.pipeelo.com/api/conta-azul?action=cadastro');
  });

  it('200 com ok:false vira pendente e grava ca_erro', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      resposta(200, { ok: false, etapa: 'venda_implantacao', erro: 'token expirado' }),
    );
    const { supabase, updates } = sb();
    const r = await cobrarContaAzul(supabase, sessao, cadastro);
    expect(r).toMatchObject({ status: 'pendente', motivo: 'Conta Azul falhou em "venda_implantacao": token expirado' });
    expect(ultimo(updates)).toEqual({ ca_erro: 'Conta Azul falhou em "venda_implantacao": token expirado' });
  });

  it('409 é "em andamento": pendente e libera a marca de processando', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(409, { ok: false, erro: 'em_andamento' }));
    const { supabase, updates } = sb();
    const r = await cobrarContaAzul(supabase, sessao, cadastro);
    expect(r.status).toBe('pendente');
    expect(reservou(updates)).toBe(true);
    expect(ultimo(updates)).toEqual({ ca_erro: null });
  });

  it('401 vira pendente com o motivo gravado', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(401, { erro: 'secret inválido' }));
    const { supabase, updates } = sb();
    const r = await cobrarContaAzul(supabase, sessao, cadastro);
    expect(r).toEqual({ status: 'pendente', motivo: 'Conta Azul recusou o pedido: secret inválido' });
    expect(ultimo(updates)).toEqual({ ca_erro: 'Conta Azul recusou o pedido: secret inválido' });
  });

  it('sem CA_INTERNAL_SECRET não chama a API', async () => {
    delete process.env.CA_INTERNAL_SECRET;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { supabase, updates } = sb();
    const r = await cobrarContaAzul(supabase, sessao, cadastro);
    expect(r).toEqual({ status: 'pendente', motivo: 'CA_INTERNAL_SECRET não configurado' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reservou(updates)).toBe(false);
    expect(updates).toEqual([{ ca_erro: 'CA_INTERNAL_SECRET não configurado' }]);
  });

  it('falha de rede não lança', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const { supabase, updates } = sb();
    const r = await cobrarContaAzul(supabase, sessao, cadastro);
    expect(r.status).toBe('pendente');
    expect(String(ultimo(updates).ca_erro)).toContain('ECONNREFUSED');
  });
});
