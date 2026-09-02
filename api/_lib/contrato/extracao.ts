import OpenAI from 'openai';

/**
 * Leitura dos documentos do cliente (contrato social + documento pessoal) pela
 * OpenAI, para identificar quem assina o contrato Pipeelo.
 *
 * Decisão 1 e 2 do design `docs/superpowers/specs/2026-09-02-pos-cadastro-contrato-conta-azul-design.md`:
 * o modelo lê PDF/imagem direto (Responses API, `input_file` / `input_image`)
 * e devolve JSON estrito. Nunca inventa: campo ausente vira string vazia e a
 * confiança cai.
 */

export type Administrador = {
  nome: string;
  cpf: string;
  cargo: string;
};

export type Representante = {
  nome: string;
  cpf: string;
  rg: string;
  orgao_rg: string;
  uf_rg: string;
  estado_civil: string;
  profissao: string;
  endereco: string;
};

export type Extracao = {
  razao_social: string;
  cnpj: string;
  endereco_sede: string;
  administradores: Administrador[];
  representante: Representante | null;
  motivo_ambiguidade: string | null;
  confianca: 'alta' | 'media' | 'baixa';
};

export type ArquivoEntrada = {
  nome: string;
  mime: string;
  bytes: Buffer;
};

export const MODELO_PADRAO = 'gpt-5-mini';

/** MIMEs que o modelo aceita como imagem; o resto vai como `input_file` (PDF). */
const MIMES_IMAGEM = new Set(['image/jpeg', 'image/jpg', 'image/png']);

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['razao_social', 'cnpj', 'endereco_sede', 'administradores', 'representante', 'motivo_ambiguidade', 'confianca'],
  properties: {
    razao_social: { type: 'string' },
    cnpj: { type: 'string' },
    endereco_sede: { type: 'string' },
    administradores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nome', 'cpf', 'cargo'],
        properties: {
          nome: { type: 'string' },
          cpf: { type: 'string' },
          cargo: { type: 'string' },
        },
      },
    },
    representante: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['nome', 'cpf', 'rg', 'orgao_rg', 'uf_rg', 'estado_civil', 'profissao', 'endereco'],
      properties: {
        nome: { type: 'string' },
        cpf: { type: 'string' },
        rg: { type: 'string' },
        orgao_rg: { type: 'string' },
        uf_rg: { type: 'string' },
        estado_civil: { type: 'string' },
        profissao: { type: 'string' },
        endereco: { type: 'string' },
      },
    },
    motivo_ambiguidade: { type: ['string', 'null'] },
    confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
  },
} as const;

const INSTRUCOES = [
  'Você lê documentos societários e pessoais de provedores de internet brasileiros para preencher um contrato de prestação de serviços.',
  'Extraia apenas o que está escrito nos documentos anexados. NUNCA invente, deduza ou complete dado que não esteja no documento.',
  '',
  'Dados da empresa (do contrato social ou cartão CNPJ):',
  '- razao_social: razão social completa, como no documento.',
  '- cnpj: apenas os 14 dígitos, sem máscara.',
  '- endereco_sede: endereço completo da sede (logradouro, número, complemento, bairro, cidade/UF, CEP).',
  '',
  'administradores: TODAS as pessoas indicadas na cláusula de administração do contrato social',
  '(quem administra/representa a sociedade). Cada uma com nome, cpf e cargo, como escritos.',
  '',
  'representante: quem vai assinar o contrato. Aplique EXATAMENTE esta regra:',
  '1. Se a cláusula de administração indica UM único administrador, o representante é ele.',
  '2. Se indica DOIS OU MAIS administradores, o representante é aquele cujo documento pessoal',
  '   (RG, CNH ou similar) foi anexado nesta requisição.',
  '3. Se há dois ou mais administradores e há documento pessoal de MAIS DE UM deles, OU se não há',
  '   cláusula de administração clara, devolva representante = null e explique em motivo_ambiguidade',
  '   qual é a dúvida e quais nomes estão em disputa.',
  '4. Se há DOIS OU MAIS administradores e NENHUM documento pessoal anexado corresponde a algum deles,',
  '   devolva representante = null e motivo_ambiguidade exatamente igual a:',
  "   'dois ou mais administradores e nenhum documento pessoal identifica quem assina'.",
  '',
  'Campos do representante (nome, cpf, rg, orgao_rg, uf_rg, estado_civil, profissao, endereco) vêm do',
  'documento pessoal e do contrato social. Campo que você não encontrar em nenhum documento: devolva',
  'string vazia "" e reduza a confiança. Não chute estado civil, profissão nem endereço.',
  '',
  'motivo_ambiguidade: null quando o representante foi identificado sem dúvida; caso contrário, uma frase',
  'em português explicando o impasse.',
  '',
  'confianca: "alta" quando todos os campos vieram legíveis dos documentos; "media" quando faltou algum',
  'campo do representante ou a leitura foi parcial; "baixa" quando faltaram vários campos, os documentos',
  'estavam ilegíveis ou o representante não pôde ser determinado.',
].join('\n');

function conteudoDoArquivo(a: ArquivoEntrada) {
  const base64 = a.bytes.toString('base64');
  const mime = (a.mime || '').toLowerCase();
  if (MIMES_IMAGEM.has(mime)) {
    return { type: 'input_image' as const, detail: 'high' as const, image_url: `data:${mime};base64,${base64}` };
  }
  return { type: 'input_file' as const, filename: a.nome, file_data: `data:application/pdf;base64,${base64}` };
}

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY env var');
  _client = new OpenAI({ apiKey });
  return _client;
}

/** Só para testes: derruba o cliente memoizado. */
export function __resetOpenAiClient() {
  _client = null;
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function normalizar(bruto: unknown): Extracao {
  const o = (bruto ?? {}) as Record<string, unknown>;

  const administradores = Array.isArray(o.administradores)
    ? (o.administradores as Record<string, unknown>[]).map((a) => ({
        nome: texto(a?.nome),
        cpf: texto(a?.cpf),
        cargo: texto(a?.cargo),
      }))
    : [];

  const r = o.representante as Record<string, unknown> | null | undefined;
  const representante: Representante | null =
    r && typeof r === 'object' && texto(r.nome)
      ? {
          nome: texto(r.nome),
          cpf: texto(r.cpf),
          rg: texto(r.rg),
          orgao_rg: texto(r.orgao_rg),
          uf_rg: texto(r.uf_rg),
          estado_civil: texto(r.estado_civil),
          profissao: texto(r.profissao),
          endereco: texto(r.endereco),
        }
      : null;

  const confiancaBruta = texto(o.confianca).toLowerCase();
  const confianca: Extracao['confianca'] =
    confiancaBruta === 'alta' || confiancaBruta === 'media' || confiancaBruta === 'baixa'
      ? confiancaBruta
      : 'baixa';

  const motivo = texto(o.motivo_ambiguidade);

  return {
    razao_social: texto(o.razao_social),
    cnpj: texto(o.cnpj).replace(/\D/g, ''),
    endereco_sede: texto(o.endereco_sede),
    administradores,
    representante,
    motivo_ambiguidade: motivo || null,
    confianca: representante ? confianca : confianca === 'alta' ? 'media' : confianca,
  };
}

/**
 * Lê os arquivos enviados pelo cliente e devolve a extração normalizada.
 * Lança se a chamada à OpenAI falhar ou se a resposta não for JSON válido —
 * quem chama (index.ts) transforma isso em `pendente`.
 */
export async function extrairDocumentos(arquivos: ArquivoEntrada[]): Promise<Extracao> {
  if (!arquivos.length) throw new Error('nenhum_arquivo_para_extrair');

  const client = getClient();
  const modelo = process.env.OPENAI_MODEL_EXTRACAO || MODELO_PADRAO;

  const conteudo: unknown[] = [
    { type: 'input_text', text: `Documentos anexados (${arquivos.length}): ${arquivos.map((a) => a.nome).join(', ')}.` },
    ...arquivos.map(conteudoDoArquivo),
  ];

  const resposta = await client.responses.create({
    model: modelo,
    instructions: INSTRUCOES,
    input: [{ role: 'user', content: conteudo as never }],
    text: {
      format: {
        type: 'json_schema',
        name: 'extracao_documentos',
        strict: true,
        schema: SCHEMA as never,
      },
    },
  });

  const saida = (resposta as { output_text?: string }).output_text;
  if (!saida) throw new Error('openai_sem_saida');

  let bruto: unknown;
  try {
    bruto = JSON.parse(saida);
  } catch {
    throw new Error('openai_json_invalido');
  }

  return normalizar(bruto);
}
