// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./extracao', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  extrairDocumentos: vi.fn(),
}));
vi.mock('../brasilapi', () => ({ fetchCnpj: vi.fn() }));

import { extrairDocumentos, type Extracao } from './extracao';
import { fetchCnpj } from '../brasilapi';
import { gerarContratoParaSessao, CONTRATO_BUCKET } from './index';
import type { SessaoContrato } from './campos';
import type { Cadastro } from '../schemas/cadastro';
import { textoDoDocx } from './_docx-texto';

const extrairMock = extrairDocumentos as unknown as ReturnType<typeof vi.fn>;
const cnpjMock = fetchCnpj as unknown as ReturnType<typeof vi.fn>;

const cadastro: Cadastro = {
  cnpj: '11222333000181',
  razao_social: 'PROVEDOR X TELECOMUNICAÇÕES LTDA',
  nome_fantasia: 'Provedor X',
  inscricao_estadual: 'Isento',
  cobranca_email: 'f@x.com',
  cobranca_telefone: '4333221100',
  dia_vencimento: 10,
  contrato_email: 'j@x.com',
  doc_contrato_social: [{ path: 'sess/contrato-social.pdf', nome_original: 'contrato-social.pdf', tamanho: 10 }],
  doc_responsaveis: [{ path: 'sess/rg.jpg', nome_original: 'rg.jpg', tamanho: 10 }],
  responsavel_nome: 'Ana Souza',
  responsavel_cargo: 'CEO',
  responsavel_email: 'ana@x.com',
  responsavel_whatsapp: '43996661541',
  contatos_extras: [],
  aceite_dados: true,
};

const sessao: SessaoContrato = {
  id: 'sess-1',
  erp: 'IXC',
  contratou_crm: false,
  valor_sessao: 0.95,
  qtd_sessoes: 2640,
  valor_mensal: 2508,
  dia_vencimento: 10,
  valor_implantacao: 4000,
  implantacao_vencimento: '2026-09-15',
  primeira_mensalidade_em: '2026-10-10',
};

const extracaoOk: Extracao = {
  razao_social: 'PROVEDOR X TELECOMUNICAÇÕES LTDA',
  cnpj: '11222333000181',
  endereco_sede: 'Rua A, 100, Centro, Londrina/PR',
  administradores: [{ nome: 'Ana Souza', cpf: '123.456.789-00', cargo: 'Sócia administradora' }],
  representante: {
    nome: 'Ana Souza', cpf: '123.456.789-00', rg: '12.345.678-9', orgao_rg: 'SSP', uf_rg: 'PR',
    estado_civil: 'casada', profissao: 'empresária', endereco: 'Rua B, 200, Londrina/PR',
  },
  motivo_ambiguidade: null,
  confianca: 'alta',
};

function makeSupabase() {
  const updates: Record<string, unknown>[] = [];
  const uploads: Array<{ bucket: string; caminho: string; corpo: Buffer }> = [];
  let downloadErro: string | null = null;
  let uploadErro: string | null = null;

  const client = {
    from: vi.fn(() => ({
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: vi.fn(async () => ({ error: null })) };
      },
    })),
    storage: {
      from: vi.fn((bucket: string) => ({
        download: vi.fn(async () => (downloadErro
          ? { data: null, error: { message: downloadErro } }
          : { data: new Blob([new Uint8Array([1, 2, 3, 4])]), error: null })),
        upload: vi.fn(async (caminho: string, corpo: Buffer) => {
          if (uploadErro) return { data: null, error: { message: uploadErro } };
          uploads.push({ bucket, caminho, corpo });
          return { data: { path: caminho }, error: null };
        }),
      })),
    },
  };

  return {
    client: client as never,
    updates,
    uploads,
    falharDownload: (m: string) => { downloadErro = m; },
    falharUpload: (m: string) => { uploadErro = m; },
  };
}

describe('gerarContratoParaSessao', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnpjMock.mockResolvedValue({ municipio: 'LONDRINA', uf: 'PR' });
  });

  it('caminho feliz: gera o .docx, sobe no bucket e grava na sessão', async () => {
    extrairMock.mockResolvedValue(extracaoOk);
    const sb = makeSupabase();

    const r = await gerarContratoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('gerado');
    if (r.status !== 'gerado') return;
    expect(r.representante).toBe('Ana Souza');
    expect(r.avisos).toEqual([]);
    expect(r.path).toMatch(/^sess-1\/Contrato_Pipeelo_Provedor_X_\d{6}\.docx$/);

    // Os dois documentos do cadastro foram enviados para a IA.
    expect(extrairMock).toHaveBeenCalledTimes(1);
    expect(extrairMock.mock.calls[0][0].map((a: { nome: string; mime: string }) => a.mime))
      .toEqual(['application/pdf', 'image/jpeg']);

    // .docx (editável, Staff) + .pdf (o que vai para a AssinaPDF).
    expect(sb.uploads).toHaveLength(2);
    expect(sb.uploads[0].bucket).toBe(CONTRATO_BUCKET);
    expect(sb.uploads[0].corpo.subarray(0, 2).toString()).toBe('PK');
    expect(textoDoDocx(sb.uploads[0].corpo)).toContain('Ana Souza');
    expect(sb.uploads[1].corpo.subarray(0, 5).toString()).toBe('%PDF-');
    expect(r.status === 'gerado' && r.pdf_path).toMatch(/\.pdf$/);

    const patch = sb.updates.at(-1)!;
    expect(patch.contrato_path).toBe(r.path);
    expect(patch.contrato_pdf_path).toBe(r.status === 'gerado' ? r.pdf_path : null);
    expect(patch.assinatura_status).toBe('pendente');
    expect(patch.assinapdf_solicitacao_id).toBeNull();
    expect(patch.contrato_erro).toBeNull();
    expect(patch.contrato_extracao).toEqual(extracaoOk);
    expect(typeof patch.contrato_gerado_at).toBe('string');
  });

  it('avisa quando o documento diverge do cadastro e quando há CRM', async () => {
    extrairMock.mockResolvedValue({
      ...extracaoOk,
      razao_social: 'OUTRA EMPRESA LTDA',
      cnpj: '99888777000166',
      confianca: 'media',
    });
    const sb = makeSupabase();

    const r = await gerarContratoParaSessao(sb.client, { ...sessao, contratou_crm: true }, cadastro);

    expect(r.status).toBe('gerado');
    if (r.status !== 'gerado') return;
    expect(r.avisos.join(' | ')).toMatch(/CNPJ do documento \(99888777000166\)/);
    expect(r.avisos.join(' | ')).toMatch(/Razão social do documento/);
    expect(r.avisos.join(' | ')).toMatch(/Confiança da leitura: media/);
    expect(r.avisos.join(' | ')).toMatch(/revisar cláusula CRM/);
  });

  it('representante ambíguo → pendente com o motivo da IA, sem gerar arquivo', async () => {
    extrairMock.mockResolvedValue({
      ...extracaoOk,
      representante: null,
      motivo_ambiguidade: 'Dois administradores com documento pessoal anexado: Ana Souza e Bruno Lima.',
      confianca: 'baixa',
    });
    const sb = makeSupabase();

    const r = await gerarContratoParaSessao(sb.client, sessao, cadastro);

    expect(r).toEqual({
      status: 'pendente',
      motivo: 'Dois administradores com documento pessoal anexado: Ana Souza e Bruno Lima.',
      faltando: ['CONTRATANTE_REPRESENTANTE'],
    });
    expect(sb.uploads).toHaveLength(0);
    expect(sb.updates.at(-1)!.contrato_erro).toContain('Dois administradores');
    expect(sb.updates.at(-1)!.contrato_extracao).toBeTruthy();
  });

  it('erro na OpenAI → pendente, sem lançar', async () => {
    extrairMock.mockRejectedValue(new Error('429 rate limit'));
    const sb = makeSupabase();

    const r = await gerarContratoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('pendente');
    if (r.status !== 'pendente') return;
    expect(r.motivo).toBe('Falha ao ler os documentos com a IA: 429 rate limit');
    expect(sb.uploads).toHaveLength(0);
    expect(sb.updates.at(-1)!.contrato_erro).toContain('429 rate limit');
  });

  it('download dos uploads falhando → pendente antes de chamar a IA', async () => {
    const sb = makeSupabase();
    sb.falharDownload('object not found');

    const r = await gerarContratoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('pendente');
    if (r.status !== 'pendente') return;
    expect(r.motivo).toContain('Não foi possível baixar os documentos');
    expect(extrairMock).not.toHaveBeenCalled();
  });

  it('sem dados comerciais → pendente listando os campos faltantes', async () => {
    extrairMock.mockResolvedValue(extracaoOk);
    const sb = makeSupabase();

    const r = await gerarContratoParaSessao(sb.client, { id: 'sess-1' }, cadastro);

    expect(r.status).toBe('pendente');
    if (r.status !== 'pendente') return;
    expect(r.faltando).toContain('ANEXO_VALOR_MENSAL');
    expect(r.motivo).toContain('Campos sem valor para o contrato');
    expect(sb.uploads).toHaveLength(0);
  });

  it('BrasilAPI indisponível → cidade de assinatura entra em faltando (não lança)', async () => {
    extrairMock.mockResolvedValue(extracaoOk);
    cnpjMock.mockRejectedValue(new Error('cnpj_lookup_unavailable'));
    const sb = makeSupabase();

    const r = await gerarContratoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('pendente');
    if (r.status !== 'pendente') return;
    expect(r.faltando).toEqual(['CONTRATANTE_CIDADE_ASSINATURA']);
  });

  it('falha no upload → pendente com o motivo do storage', async () => {
    extrairMock.mockResolvedValue(extracaoOk);
    const sb = makeSupabase();
    sb.falharUpload('bucket not found');

    const r = await gerarContratoParaSessao(sb.client, sessao, cadastro);

    expect(r.status).toBe('pendente');
    if (r.status !== 'pendente') return;
    expect(r.motivo).toContain('bucket not found');
  });
});
