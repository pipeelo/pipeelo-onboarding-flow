// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AssinaPdfApiError, AssinaPdfConfigError, anexarPdf, consultarSolicitacao, criarSolicitacao,
  documentosDosAssinantes, escolherAssinado, getAssinaPdfConfig, obterLinkInicial, urlArquivo,
} from '../assinapdf';

const cfg = { baseUrl: 'https://x.assinapdf.com.br', token: 'tok', empresaId: 1, categoriaId: 2, layoutId: 2, tipo: 'Contratação' };

function resposta(body: unknown, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
}

describe('getAssinaPdfConfig', () => {
  it('exige o token e aplica os padrões da instância Pipeelo', () => {
    expect(() => getAssinaPdfConfig({})).toThrow(AssinaPdfConfigError);
    const c = getAssinaPdfConfig({ ASSINAPDF_TOKEN: 'abc' });
    expect(c).toMatchObject({ baseUrl: 'https://pipeelo.assinapdf.com.br', empresaId: 1, categoriaId: 2, layoutId: 2, tipo: 'Contratação' });
  });

  it('lê ids e base da env, ignorando barra final', () => {
    const c = getAssinaPdfConfig({ ASSINAPDF_TOKEN: 'abc', ASSINAPDF_BASE_URL: 'https://demo.assinapdf.com.br/', ASSINAPDF_LAYOUT_ID: '7' });
    expect(c.baseUrl).toBe('https://demo.assinapdf.com.br');
    expect(c.layoutId).toBe(7);
  });
});

describe('cliente', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it('cria a solicitação com CPF/telefone só dígitos, nome em maiúsculas e ids da config', async () => {
    fetchMock.mockResolvedValue(resposta({ status: 'success', data: { id: 66, estado: 'pt1' } }));
    const r = await criarSolicitacao(cfg, { cpf: '123.456.789-00', nome: 'Ana Souza', endereco: 'Rua A', telefone: '(43) 99666-1541', email: 'a@x.com', plano: 'Provedor X' });
    expect(r.id).toBe(66);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://x.assinapdf.com.br/api/v1/solicitacoes');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toMatchObject({
      cpfcliente: '12345678900', nomecliente: 'ANA SOUZA', telefone: '43996661541',
      empresa_id: 1, categoria_id: 2, tipo: 'Contratação', permanencia: '0',
    });
  });

  it('anexa o PDF em multipart com o layout da config', async () => {
    fetchMock.mockResolvedValue(resposta({ status: 'success', data: { documento: 'x.pdf', layout: '2' } }));
    await anexarPdf(cfg, 66, Buffer.from('%PDF'), 'Contrato.pdf');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://x.assinapdf.com.br/api/v1/solicitacoes/66/add-document');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('layout')).toBe('2');
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('obtém o link inicial por WhatsApp', async () => {
    fetchMock.mockResolvedValue(resposta({ status: 'success', data: { link: 'https://x/verifpt1/abc' } }));
    expect(await obterLinkInicial(cfg, 66)).toBe('https://x/verifpt1/abc');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ posicaoCli: 0, meio_acesso: 'w' });
  });

  it('lança AssinaPdfApiError em HTTP de erro e em status != success', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ status: 'error', message: 'Solicitacao nao encontrada' }, 404));
    await expect(consultarSolicitacao(cfg, 9)).rejects.toBeInstanceOf(AssinaPdfApiError);
    fetchMock.mockResolvedValueOnce(resposta({ status: 'error', message: 'nope' }, 200));
    await expect(consultarSolicitacao(cfg, 9)).rejects.toThrow(/nope/);
  });

  it('signer-docs sem assinante vira lista vazia', async () => {
    fetchMock.mockResolvedValue(resposta({ status: 'success', message: 'Nenhum assinador', data: [] }));
    const r = await documentosDosAssinantes(cfg, 66);
    expect(r).toEqual({ solicitacao_id: 66, total_signers: 0, signers: [] });
  });
});

describe('helpers', () => {
  it('escolhe o PDF assinado mais processado', () => {
    expect(escolherAssinado([])).toBeNull();
    expect(escolherAssinado(['a_66_2.pdf'])).toBe('a_66_2.pdf');
    expect(escolherAssinado(['a_66_2.pdf', 'a_66_2_assinado.pdf', 'a_66_2_assinado_assinado.pdf'])).toBe('a_66_2_assinado_assinado.pdf');
  });

  it('monta a URL pública do arquivo', () => {
    expect(urlArquivo(cfg, 'a b.pdf')).toBe('https://x.assinapdf.com.br/img/cliente/a%20b.pdf');
  });
});
