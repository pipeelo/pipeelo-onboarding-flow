/**
 * Mensagem de "próximo passo da implantação" enviada logo após a notificação
 * de conclusão do onboarding (modo completo).
 *
 * Pede ao cliente o que NÃO dá pra resolver do nosso lado:
 *   1. Liberação dos IPs da Pipeelo (whitelist da API) em TODOS os sistemas
 *      integrados — ERP, gerenciador de rede, mapas e gateway de pagamento.
 *   2. Cliente de testes no ERP
 *   3. Credenciais que faltaram no formulário (condicional, por sistema)
 *
 * Montada dinamicamente a partir das colunas da sessão (erp, gerenciamento_rede,
 * mapas, gateway_pagamento — definidas pelo admin ao gerar o link) e das
 * respostas (credenciais preenchidas pelo cliente). As colunas da sessão são a
 * fonte canônica: são elas que liberam as perguntas de credencial no formulário.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const PIPEELO_WHITELIST_IPS = ['154.53.42.153', '3.220.83.179', '35.168.169.27'];

type CredField = { id: string; label: string };

/**
 * Credenciais esperadas por sistema, indexadas pelo VALOR salvo na coluna da
 * sessão (rótulo humano — ver ERP_OPTIONS/REDE_OPTIONS/etc. em sessions-create).
 * É a mesma chave usada nos condicionais `_session_*` do questions.json.
 */
const ERP_CREDENTIALS: Record<string, CredField[]> = {
  IXC: [
    { id: 'erp_ixc_url', label: 'URL da API' },
    { id: 'erp_ixc_userid', label: 'userID do usuário de API' },
    { id: 'erp_ixc_token', label: 'Token de autenticação (gerado em *Configurações → Integrações → API* dentro do IXC)' },
  ],
  'MK Solution': [
    { id: 'erp_mk_url', label: 'URL da API' },
    { id: 'erp_mk_token', label: 'Token' },
    { id: 'erp_mk_senha', label: 'Senha' },
  ],
  Voalle: [
    { id: 'erp_voalle_url', label: 'URL' },
    { id: 'erp_voalle_client_id', label: 'Client ID' },
    { id: 'erp_voalle_client_secret', label: 'Client Secret' },
    { id: 'erp_voalle_syndata', label: 'Syndata' },
  ],
  Hubsoft: [
    { id: 'erp_hubsoft_url', label: 'URL da API' },
    { id: 'erp_hubsoft_usuario', label: 'Usuário' },
    { id: 'erp_hubsoft_senha', label: 'Senha' },
    { id: 'erp_hubsoft_client_id', label: 'Client ID' },
    { id: 'erp_hubsoft_client_secret', label: 'Client Secret' },
  ],
  RBX: [
    { id: 'erp_rbx_url', label: 'URL da API' },
    { id: 'erp_rbx_token', label: 'Token' },
    { id: 'erp_rbx_usuario', label: 'Usuário' },
    { id: 'erp_rbx_senha', label: 'Senha' },
  ],
  SGP: [
    { id: 'erp_sgp_url', label: 'URL da API' },
    { id: 'erp_sgp_token', label: 'Token' },
    { id: 'erp_sgp_app', label: 'App (nome do app de API no SGP)' },
  ],
};

/** ERPs sem campos dedicados (Topp Sap, Outros) caem nos campos "outros". */
const ERP_CREDENTIALS_OUTROS: CredField[] = [
  { id: 'erp_outros_url', label: 'URL da API' },
  { id: 'erp_outros_token', label: 'Token / API Key' },
];

const REDE_CREDENTIALS: Record<string, CredField[]> = {
  'OLT Cloud': [
    { id: 'rede_oltcloud_url', label: 'URL' },
    { id: 'rede_oltcloud_usuario', label: 'Usuário' },
    { id: 'rede_oltcloud_senha', label: 'Senha' },
  ],
  Anlix: [
    { id: 'rede_anlix_url', label: 'URL' },
    { id: 'rede_anlix_usuario', label: 'Usuário' },
    { id: 'rede_anlix_senha', label: 'Senha' },
  ],
  'Smart OLT': [
    { id: 'rede_smartolt_url', label: 'URL' },
    { id: 'rede_smartolt_usuario', label: 'Usuário' },
    { id: 'rede_smartolt_senha', label: 'Senha' },
  ],
  'Made 4 Graph': [
    { id: 'rede_made4graph_url', label: 'URL' },
    { id: 'rede_made4graph_email', label: 'Email' },
    { id: 'rede_made4graph_senha', label: 'Senha' },
    { id: 'rede_made4graph_token', label: 'Token' },
  ],
  'IXC-ACS': [
    { id: 'rede_ixcacs_url', label: 'URL' },
    { id: 'rede_ixcacs_usuario', label: 'Usuário' },
    { id: 'rede_ixcacs_senha', label: 'Senha' },
  ],
};

const REDE_CREDENTIALS_OUTROS: CredField[] = [
  { id: 'rede_outros_url', label: 'URL' },
  { id: 'rede_outros_usuario', label: 'Usuário' },
  { id: 'rede_outros_senha', label: 'Senha' },
];

const MAPAS_CREDENTIALS: Record<string, CredField[]> = {
  Geogrid: [
    { id: 'mapas_geogrid_url', label: 'URL' },
    { id: 'mapas_geogrid_token', label: 'Token' },
  ],
  Geosite: [
    { id: 'mapas_geosite_usuario', label: 'Usuário' },
    { id: 'mapas_geosite_senha', label: 'Senha' },
  ],
  OZMap: [
    { id: 'mapas_ozmap_url', label: 'URL' },
    { id: 'mapas_ozmap_token', label: 'Token' },
    { id: 'mapas_ozmap_usuario', label: 'Usuário' },
    { id: 'mapas_ozmap_senha', label: 'Senha' },
  ],
  'IXC Maps': [
    { id: 'mapas_ixcmaps_url', label: 'URL' },
    { id: 'mapas_ixcmaps_usuario', label: 'Usuário' },
    { id: 'mapas_ixcmaps_senha', label: 'Senha' },
  ],
};

const MAPAS_CREDENTIALS_OUTROS: CredField[] = [
  { id: 'mapas_outros_url', label: 'URL' },
  { id: 'mapas_outros_token', label: 'Token / API Key' },
  { id: 'mapas_outros_usuario', label: 'Usuário' },
  { id: 'mapas_outros_senha', label: 'Senha' },
];

/** Sistema integrado já resolvido: nome + categoria + credenciais faltantes. */
type SistemaIntegrado = {
  nome: string;
  categoria: string;
  faltantes: string[];
  /** Se entra na lista de whitelist de IPs (todo sistema com API entra). */
  whitelist: boolean;
};

function asText(valor: unknown): string {
  if (typeof valor === 'string') return valor.trim();
  return '';
}

const NUMERAIS = ['uma', 'duas', 'três', 'quatro', 'cinco'];

/**
 * Resolve um sistema integrado a partir da coluna da sessão. Retorna null se a
 * coluna estiver vazia (sistema não integrado).
 */
function resolverSistema(opts: {
  sessionValue: string;
  categoria: string;
  credenciais: Record<string, CredField[]>;
  credenciaisOutros: CredField[];
  /** rótulos da sessão que caem nos campos "outros" (ex: 'Outros', 'Topp Sap'). */
  rotulosOutros: string[];
  /** id da pergunta com o nome custom quando cai em "outros". */
  nomeOutrosId: string;
  respostas: Map<string, string>;
}): SistemaIntegrado | null {
  const { sessionValue, categoria, credenciais, credenciaisOutros, rotulosOutros, nomeOutrosId, respostas } = opts;
  if (!sessionValue) return null;

  const isOutros = rotulosOutros.includes(sessionValue) || !credenciais[sessionValue];
  const creds = credenciais[sessionValue] ?? credenciaisOutros;
  const nome = isOutros ? respostas.get(nomeOutrosId) || sessionValue : sessionValue;
  const faltantes = creds.filter((c) => !respostas.get(c.id)).map((c) => c.label);

  return { nome, categoria, faltantes, whitelist: true };
}

type SessionStack = {
  erp: string | null;
  mapas: string | null;
  gerenciamento_rede: string | null;
  gateway_pagamento: string | null;
};

/**
 * Monta a mensagem de pedido de integração. Retorna null quando não se
 * aplica (modo comercial — sem integração — ou sessão sem nenhum sistema).
 */
export async function buildIntegrationRequestMessage(
  supabase: SupabaseClient,
  sessionId: string,
  modo: 'completo' | 'comercial' | null
): Promise<string | null> {
  if ((modo ?? 'completo') === 'comercial') return null;

  const [{ data: sessionData }, { data: respostasData }] = await Promise.all([
    supabase
      .from('onboarding_sessions')
      .select('erp, mapas, gerenciamento_rede, gateway_pagamento')
      .eq('id', sessionId)
      .maybeSingle<SessionStack>(),
    supabase.from('onboarding_respostas').select('pergunta_id, valor').eq('session_id', sessionId),
  ]);

  if (!sessionData) return null;

  const respostas = new Map<string, string>();
  for (const r of respostasData ?? []) respostas.set(r.pergunta_id, asText(r.valor));

  // Fallback: ERP também pode vir como resposta `erp_utilizado` (suporte) em
  // sessões antigas sem a coluna preenchida — mapeia o value pro rótulo da coluna.
  const ERP_VALUE_TO_LABEL: Record<string, string> = {
    ixc: 'IXC',
    mk_solutions: 'MK Solution',
    voalle: 'Voalle',
    hubsoft: 'Hubsoft',
    sgp: 'SGP',
    topsapp: 'Topp Sap',
  };
  const erpValue =
    asText(sessionData.erp) ||
    ERP_VALUE_TO_LABEL[respostas.get('erp_utilizado') ?? ''] ||
    (respostas.get('erp_utilizado') ? 'Outros' : '');

  const sistemas: SistemaIntegrado[] = [];

  const erp = resolverSistema({
    sessionValue: erpValue,
    categoria: 'ERP',
    credenciais: ERP_CREDENTIALS,
    credenciaisOutros: ERP_CREDENTIALS_OUTROS,
    rotulosOutros: ['Topp Sap', 'Outros'],
    nomeOutrosId: 'erp_outros_nome',
    respostas,
  });
  if (erp) sistemas.push(erp);

  const rede = resolverSistema({
    sessionValue: asText(sessionData.gerenciamento_rede),
    categoria: 'gerenciador de rede',
    credenciais: REDE_CREDENTIALS,
    credenciaisOutros: REDE_CREDENTIALS_OUTROS,
    rotulosOutros: ['Outros'],
    nomeOutrosId: 'rede_outros_nome',
    respostas,
  });
  if (rede) sistemas.push(rede);

  const mapasValue = asText(sessionData.mapas);
  let mapas: SistemaIntegrado | null;
  if (mapasValue === 'KMZ (Google Maps)') {
    // KMZ é arquivo estático (Google Maps / My Maps) — não tem API pra whitelist.
    // O que precisamos é o(s) polígono(s) da área de atendimento, pedidos como
    // repeater no formulário (mapas_kmz_areas). Se não vieram, entram como pendência.
    const kmzRaw = (respostasData ?? []).find((r) => r.pergunta_id === 'mapas_kmz_areas')?.valor;
    const temAreas =
      Array.isArray(kmzRaw) &&
      kmzRaw.some(
        (item) =>
          item &&
          typeof item === 'object' &&
          Object.values(item).some((v) => typeof v === 'string' && v.trim())
      );
    mapas = {
      nome: 'Mapa de cobertura (KMZ)',
      categoria: 'mapas',
      faltantes: temAreas ? [] : ['arquivo(s) KMZ com o polígono da área de atendimento'],
      whitelist: false,
    };
  } else {
    mapas = resolverSistema({
      sessionValue: mapasValue,
      categoria: 'mapas',
      credenciais: MAPAS_CREDENTIALS,
      credenciaisOutros: MAPAS_CREDENTIALS_OUTROS,
      rotulosOutros: ['Outros'],
      nomeOutrosId: 'mapas_outros_nome',
      respostas,
    });
  }
  if (mapas) sistemas.push(mapas);

  // Gateway: só '7AZ (Bemobi)' e 'Outros' viram coluna de sessão (ambos exigem
  // credencial dedicada/whitelist). Demais gateways são integrados via ERP.
  const gatewayValue = asText(sessionData.gateway_pagamento);
  if (gatewayValue === '7AZ (Bemobi)') {
    const faltantes = respostas.get('gateway_7az_token') ? [] : ['Token de API (gerado dentro do painel do 7AZ)'];
    sistemas.push({ nome: '7AZ', categoria: 'gateway de pagamento', faltantes, whitelist: true });
  } else if (gatewayValue === 'Outros') {
    // Nome real do gateway: campo dedicado da seção de integração, senão o
    // gateway escolhido no Financeiro (gateway_pagamento), senão genérico.
    const GATEWAY_VALUE_TO_LABEL: Record<string, string> = {
      '7az': '7AZ',
      asaas: 'Asaas',
      pjbank: 'PJBank',
      gerencianet: 'Gerencianet / Efí',
      mercado_pago: 'Mercado Pago',
      iugu: 'Iugu',
    };
    const gatewayFinanceiro = respostas.get('gateway_pagamento') ?? '';
    // Gateways embutidos não têm API própria pra liberar — não pedimos whitelist.
    if (gatewayFinanceiro !== 'integrado_erp' && gatewayFinanceiro !== 'boleto_proprio') {
      const nome =
        respostas.get('gateway_outros_nome') ||
        respostas.get('gateway_outro') ||
        GATEWAY_VALUE_TO_LABEL[gatewayFinanceiro] ||
        'Gateway de pagamento';
      const faltantes = respostas.get('gateway_outros_token') ? [] : ['Token / API Key'];
      sistemas.push({ nome, categoria: 'gateway de pagamento', faltantes, whitelist: true });
    }
  }

  if (sistemas.length === 0) return null;

  const sistemasWhitelist = sistemas.filter((s) => s.whitelist);
  const erpNome = erp?.nome;
  const faltantes = sistemas.filter((s) => s.faltantes.length > 0);

  // Monta os itens numerados dinamicamente.
  const itens: string[] = [];

  if (sistemasWhitelist.length > 0) {
    const lista = sistemasWhitelist
      .map((s) => {
        const cat = s.nome.toLowerCase() === s.categoria.toLowerCase() ? '' : ` (${s.categoria})`;
        return `   • *${s.nome}*${cat}`;
      })
      .join('\n');
    const ips = PIPEELO_WHITELIST_IPS.map((ip) => `\`${ip}\``).join('\n');
    itens.push(
      `Liberação dos IPs da Pipeelo (whitelist da API) em *cada um* dos sistemas abaixo:\n${lista}\n\n${ips}`
    );
  }

  // Cliente de bancada (homologação): se o CPF veio no formulário, confirma-o;
  // senão, pede pra providenciar. Lista as operações que serão testadas.
  const cpfTeste = respostas.get('cliente_teste_cpf');
  if (erpNome || cpfTeste) {
    const ondeErp = erpNome ? ` no ${erpNome}` : '';
    if (cpfTeste) {
      itens.push(
        `Confirmação do *cliente de bancada* pra homologação: CPF *${cpfTeste}*${ondeErp}. Confere que ele está com ONU configurada, contrato ativo e ao menos uma fatura em aberto — é nele que validamos boleto, PIX, desbloqueio em confiança, reset de ONU e troca de senha/nome do WiFi antes de liberar pra base.`
      );
    } else {
      itens.push(
        `Um *cliente de bancada* pra testes${ondeErp} — com ONU configurada, contrato ativo e ao menos uma fatura em aberto. É nele que validamos boleto, PIX, desbloqueio em confiança, reset de ONU e troca de senha/nome do WiFi antes de subir em produção. Pode ser um CPF real ou fictício.`
      );
    }
  }

  if (faltantes.length > 0) {
    const lista = faltantes.map((s) => `   • *${s.nome}* — ${s.faltantes.join(' + ')}`).join('\n');
    itens.push(`*Credenciais que faltaram no formulário:*\n${lista}`);
  }

  const corpo = itens.map((item, i) => `*${i + 1}.* ${item}`).join('\n\n');

  const numeral = NUMERAIS[itens.length - 1] ?? `${itens.length}`;

  const credenciaisOk =
    faltantes.length === 0
      ? `Já recebemos todas as credenciais pelo formulário — tudo certo do nosso lado. ✅\n\n`
      : '';

  return `Próximo passo da implantação 👇

${credenciaisOk}Antes do nosso time iniciar a integração, precisamos de ${numeral} ${itens.length === 1 ? 'coisa' : 'coisas'} do lado de vocês:

${corpo}

Assim que isso estiver pronto, me dá um retorno aqui que seguimos com a ativação. 🚀`;
}
