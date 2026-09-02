// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cobrarContaAzul, faltamDadosDoFechamento, type SessaoCobranca } from '../conta-azul';
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

/** Supabase de mentira: registra o que foi gravado na sessão. */
function sb() {
  const updates: Array<Record<string, unknown>> = [];
  const supabase = {
    from: () => ({
      update: (data: Record<string, unknown>) => {
        updates.push(data);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  return { supabase: supabase as never, updates };
}

function resposta(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response;
}

describe('cobrarContaAzul', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CA_INTERNAL_SECRET = 'segredo';
    delete process.env.VENDAS_API_URL;
  });
  afterEach(() => {
    delete process.env.CA_INTERNAL_SECRET;
  });

  it('não chama a API quando falta dado do fechamento', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { supabase } = sb();
    const r = await cobrarContaAzul(supabase, { ...sessao, valor_implantacao: null, dia_vencimento: null }, cadastro);
    expect(r).toEqual({
      status: 'pendente',
      motivo: 'faltam dados do fechamento: valor da implantação, dia de vencimento',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
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

    expect(updates[0]).toMatchObject({
      ca_cliente_id: 'ca-123',
      ca_implantacao_url: 'https://boleto/impl',
      ca_mensalidade_url: 'https://boleto/mens',
      ca_erro: null,
    });
    expect(updates[0].ca_cobrado_at).toBeTruthy();
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
    expect(r.status).toBe('pendente');
    expect(r).toMatchObject({ motivo: 'Conta Azul falhou em "venda_implantacao": token expirado' });
    expect(updates[0]).toEqual({ ca_erro: 'Conta Azul falhou em "venda_implantacao": token expirado' });
  });

  it('409 é "em andamento": pendente sem gravar erro', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(409, { ok: false, erro: 'em_andamento' }));
    const { supabase, updates } = sb();
    const r = await cobrarContaAzul(supabase, sessao, cadastro);
    expect(r.status).toBe('pendente');
    expect(updates).toEqual([]);
  });

  it('400 e 401 viram pendente sem gravar erro', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resposta(401, { erro: 'secret inválido' }));
    const { supabase, updates } = sb();
    const r = await cobrarContaAzul(supabase, sessao, cadastro);
    expect(r).toEqual({ status: 'pendente', motivo: 'Conta Azul recusou o pedido: secret inválido' });
    expect(updates).toEqual([]);
  });

  it('sem CA_INTERNAL_SECRET não chama a API', async () => {
    delete process.env.CA_INTERNAL_SECRET;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { supabase, updates } = sb();
    const r = await cobrarContaAzul(supabase, sessao, cadastro);
    expect(r).toEqual({ status: 'pendente', motivo: 'CA_INTERNAL_SECRET não configurado' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updates[0]).toEqual({ ca_erro: 'CA_INTERNAL_SECRET não configurado' });
  });

  it('falha de rede não lança', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const { supabase, updates } = sb();
    const r = await cobrarContaAzul(supabase, sessao, cadastro);
    expect(r.status).toBe('pendente');
    expect(String(updates[0].ca_erro)).toContain('ECONNREFUSED');
  });
});
