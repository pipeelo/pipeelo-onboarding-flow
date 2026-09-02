// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../assinapdf', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  criarSolicitacao: vi.fn(),
  anexarPdf: vi.fn(),
  obterLinkInicial: vi.fn(),
  consultarSolicitacao: vi.fn(),
  documentosAssinados: vi.fn(),
  baixarArquivo: vi.fn(),
  validarSolicitacao: vi.fn(),
  pedirCorrecao: vi.fn(),
}));
vi.mock('../evolution', () => ({
  sendText: vi.fn(async () => ({ ok: true })),
  toJid: (d: string) => `55${d}@s.whatsapp.net`,
}));
vi.mock('../staff-notify', () => ({ notifyStaff: vi.fn(async () => ({ sent: true })) }));

import {
  anexarPdf, baixarArquivo, consultarSolicitacao, criarSolicitacao, documentosAssinados, obterLinkInicial, validarSolicitacao,
} from '../assinapdf';
import { sendText } from '../evolution';
import { notifyStaff } from '../staff-notify';
import {
  aprovarAssinatura, consultarAssinatura, enviarParaAssinatura, mensagemLinkResponsavel, type SessaoAssinatura,
} from '../assinatura';
import type { Cadastro } from '../schemas/cadastro';

const upload = { path: 'p', nome_original: 'a.pdf', tamanho: 1 };
const cadastro: Cadastro = {
  cnpj: '11222333000181', razao_social: 'PROVEDOR X LTDA', nome_fantasia: 'Provedor X',
  inscricao_estadual: 'Isento', cobranca_email: 'f@x.com', cobranca_telefone: '4333221100',
  dia_vencimento: 10, contrato_email: 'j@x.com', doc_contrato_social: [upload], doc_responsaveis: [upload],
  responsavel_nome: 'Ana Souza', responsavel_cargo: 'CEO', responsavel_email: 'ana@x.com',
  responsavel_whatsapp: '43996661541', contatos_extras: [], aceite_dados: true,
};

const sessao: SessaoAssinatura = {
  id: 's1', slug: 'provedor-x',
  contrato_pdf_path: 's1/Contrato_Pipeelo_Provedor_X_092026.pdf',
  contrato_extracao: { endereco_sede: 'Rua A, 100, Londrina/PR', representante: { nome: 'Ana Souza', cpf: '123.456.789-00' } },
  grupo_jid: '120363@g.us',
};

type Chamada = { tabela?: string; data?: Record<string, unknown> };
function fakeSupabase(pdfBytes: Buffer | null = Buffer.from('%PDF-1.4 teste')) {
  const updates: Chamada[] = [];
  const uploads: Array<{ path: string; bytes: Buffer }> = [];
  const supabase = {
    from: () => ({
      update: (data: Record<string, unknown>) => ({ eq: async () => { updates.push({ data }); return { error: null }; } }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { grupo_jid: '120363@g.us' } }) }) }),
    }),
    storage: {
      from: () => ({
        download: async () => (pdfBytes ? { data: new Blob([new Uint8Array(pdfBytes)]), error: null } : { data: null, error: { message: 'nao_encontrado' } }),
        upload: async (path: string, bytes: Buffer) => { uploads.push({ path, bytes }); return { error: null }; },
      }),
    },
  };
  return { supabase: supabase as never, updates, uploads };
}

const m = {
  criar: criarSolicitacao as unknown as ReturnType<typeof vi.fn>,
  anexar: anexarPdf as unknown as ReturnType<typeof vi.fn>,
  link: obterLinkInicial as unknown as ReturnType<typeof vi.fn>,
  consultar: consultarSolicitacao as unknown as ReturnType<typeof vi.fn>,
  assinados: documentosAssinados as unknown as ReturnType<typeof vi.fn>,
  baixar: baixarArquivo as unknown as ReturnType<typeof vi.fn>,
  validar: validarSolicitacao as unknown as ReturnType<typeof vi.fn>,
  send: sendText as unknown as ReturnType<typeof vi.fn>,
  staff: notifyStaff as unknown as ReturnType<typeof vi.fn>,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ASSINAPDF_TOKEN = 'tok';
  process.env.PUBLIC_BASE_URL = 'https://onboarding.pipeelo.com';
});

describe('enviarParaAssinatura', () => {
  it('cria a solicitação, anexa o PDF, obtém o link e manda DM + grupo', async () => {
    m.criar.mockResolvedValue({ id: 66, estado: 'pt1' });
    m.anexar.mockResolvedValue({ documento: 'x.pdf', layout: '2' });
    m.link.mockResolvedValue('https://x/verifpt1/abc');
    const { supabase, updates } = fakeSupabase();

    const r = await enviarParaAssinatura(supabase, sessao, cadastro);

    expect(r).toMatchObject({ status: 'enviado', solicitacao_id: 66, link: 'https://x/verifpt1/abc', dm: true, grupo: true, reenvio: false });
    expect(m.criar.mock.calls[0][1]).toMatchObject({ cpf: '123.456.789-00', nome: 'Ana Souza', telefone: '43996661541', email: 'j@x.com', plano: 'Provedor X' });
    expect(m.anexar).toHaveBeenCalledWith(expect.anything(), 66, expect.any(Buffer), 'Contrato_Pipeelo_Provedor_X_092026.pdf');
    expect(m.send).toHaveBeenCalledTimes(2);
    expect(m.send.mock.calls[0][0]).toBe('5543996661541@s.whatsapp.net');
    expect(m.send.mock.calls[0][1]).toContain('https://x/verifpt1/abc');
    expect(m.send.mock.calls[1][0]).toBe('120363@g.us');
    const final = updates.at(-1)?.data;
    expect(final).toMatchObject({ assinapdf_link: 'https://x/verifpt1/abc', assinatura_status: 'enviado', assinatura_erro: null });
  });

  it('sem representante com CPF fica pendente com motivo e não chama a API', async () => {
    const { supabase, updates } = fakeSupabase();
    const r = await enviarParaAssinatura(supabase, { ...sessao, contrato_extracao: { representante: null } }, cadastro);
    expect(r.status).toBe('pendente');
    expect(m.criar).not.toHaveBeenCalled();
    expect(updates.at(-1)?.data).toMatchObject({ assinatura_status: 'erro' });
  });

  it('sem ASSINAPDF_TOKEN fica pendente com motivo claro', async () => {
    delete process.env.ASSINAPDF_TOKEN;
    const { supabase } = fakeSupabase();
    const r = await enviarParaAssinatura(supabase, sessao, cadastro);
    expect(r).toMatchObject({ status: 'pendente', motivo: expect.stringContaining('ASSINAPDF_TOKEN') });
  });

  it('com solicitação já criada não cria outra: só pega o link e reenvia', async () => {
    m.link.mockResolvedValue('https://x/verifpt1/abc');
    const { supabase } = fakeSupabase();
    const r = await enviarParaAssinatura(supabase, { ...sessao, assinapdf_solicitacao_id: 66, assinapdf_link: 'https://x/verifpt1/abc' }, cadastro);
    expect(r).toMatchObject({ status: 'enviado', reenvio: true });
    expect(m.criar).not.toHaveBeenCalled();
    expect(m.anexar).not.toHaveBeenCalled();
    expect(m.send).toHaveBeenCalledTimes(2);
  });

  it('falha da API vira pendente com o erro gravado (nunca lança)', async () => {
    m.criar.mockRejectedValue(new Error('HTTP 500'));
    const { supabase, updates } = fakeSupabase();
    const r = await enviarParaAssinatura(supabase, sessao, cadastro);
    expect(r).toMatchObject({ status: 'pendente', motivo: expect.stringContaining('HTTP 500') });
    expect(updates.at(-1)?.data).toMatchObject({ assinatura_status: 'erro', assinatura_erro: expect.stringContaining('HTTP 500') });
  });

  it('DM que falha não impede o envio: status enviado com aviso em assinatura_erro', async () => {
    m.criar.mockResolvedValue({ id: 66, estado: 'pt1' });
    m.anexar.mockResolvedValue({});
    m.link.mockResolvedValue('https://x/l');
    m.send.mockRejectedValueOnce(new Error('numero invalido')).mockResolvedValueOnce({ ok: true });
    const { supabase, updates } = fakeSupabase();
    const r = await enviarParaAssinatura(supabase, sessao, cadastro);
    expect(r).toMatchObject({ status: 'enviado', dm: false, grupo: true });
    expect(updates.at(-1)?.data).toMatchObject({ assinatura_status: 'enviado', assinatura_erro: expect.stringContaining('DM ao responsável') });
  });
});

describe('consultarAssinatura', () => {
  const emAndamento = { ...sessao, assinapdf_solicitacao_id: 66, assinatura_status: 'enviado' };

  it('pt7 vira aguardando_validacao e avisa o Staff', async () => {
    m.consultar.mockResolvedValue({ id: 66, estado: 'pt7' });
    const { supabase, updates } = fakeSupabase();
    const r = await consultarAssinatura(supabase, emAndamento, { nomeEmpresa: 'Provedor X' });
    expect(r).toMatchObject({ mudou: true, status: 'aguardando_validacao' });
    expect(updates.at(-1)?.data).toMatchObject({ assinatura_status: 'aguardando_validacao', assinapdf_estado: 'pt7' });
    expect(m.staff.mock.calls[0][0]).toContain('Provedor X assinou');
  });

  it('fin baixa o PDF assinado para o bucket e finaliza', async () => {
    m.consultar.mockResolvedValue({ id: 66, estado: 'fin' });
    m.assinados.mockResolvedValue(['12345678900_66_2.pdf', '12345678900_66_2_assinado.pdf']);
    m.baixar.mockResolvedValue(Buffer.from('%PDF assinado'));
    const { supabase, updates, uploads } = fakeSupabase();
    const r = await consultarAssinatura(supabase, { ...emAndamento, assinatura_status: 'aguardando_validacao' });
    expect(r).toMatchObject({ mudou: true, status: 'finalizado', assinado_path: 's1/Contrato_Pipeelo_Provedor_X_092026_assinado.pdf' });
    expect(m.baixar).toHaveBeenCalledWith(expect.anything(), '12345678900_66_2_assinado.pdf');
    expect(uploads[0].path).toBe('s1/Contrato_Pipeelo_Provedor_X_092026_assinado.pdf');
    expect(updates.at(-1)?.data).toMatchObject({ assinatura_status: 'finalizado', contrato_assinado_path: uploads[0].path });
    expect(m.staff.mock.calls[0][0]).toContain('assinado e finalizado');
  });

  it('sem mudança de etapa só registra a consulta', async () => {
    m.consultar.mockResolvedValue({ id: 66, estado: 'pt1' });
    const { supabase, updates } = fakeSupabase();
    const r = await consultarAssinatura(supabase, emAndamento);
    expect(r).toEqual({ mudou: false, estado: 'pt1' });
    expect(updates.at(-1)?.data).toMatchObject({ assinatura_consultada_at: expect.any(String) });
    expect(m.staff).not.toHaveBeenCalled();
  });
});

describe('aprovarAssinatura', () => {
  it('chama validate-request e reconsulta', async () => {
    m.validar.mockResolvedValue({});
    m.consultar.mockResolvedValue({ id: 66, estado: 'fin' });
    m.assinados.mockResolvedValue(['a_assinado.pdf']);
    m.baixar.mockResolvedValue(Buffer.from('%PDF'));
    const { supabase } = fakeSupabase();
    const r = await aprovarAssinatura(supabase, { ...sessao, assinapdf_solicitacao_id: 66, assinatura_status: 'aguardando_validacao' });
    expect(m.validar).toHaveBeenCalledWith(expect.anything(), 66);
    expect(r).toMatchObject({ mudou: true, status: 'finalizado' });
    expect(m.staff).not.toHaveBeenCalled();
  });
});

describe('mensagens', () => {
  it('DM cita o primeiro nome, o representante e o link', () => {
    const t = mensagemLinkResponsavel(cadastro, 'Ana Souza', 'https://x/l');
    expect(t).toContain('Olá, Ana!');
    expect(t).toContain('*Ana Souza*');
    expect(t).toContain('https://x/l');
    expect(t).toContain('selfie');
  });
});
