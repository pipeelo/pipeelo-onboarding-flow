/**
 * Camada de compatibilidade — questions.json 4.x → ids "legado" (≤ 3.7).
 *
 * O admin-pipeelo (gerador de prompts, KBs e produtos do CRM) lê as respostas
 * pelo id antigo das perguntas. A revisão de 17–18/09/2026 removeu ou trocou
 * ~120 ids (endereço em 1 tela, "segue o padrão? sim/não", planos em texto
 * livre, horário por departamento…). Em vez de mexer no admin, o payload de
 * conclusão sai com os DOIS conjuntos: as respostas novas como estão e, ao
 * lado, os ids antigos derivados delas.
 *
 * Regras:
 * - Nunca sobrescreve uma resposta que já existe (sessão antiga continua igual).
 * - Só deriva o que tem tradução mecânica. "Segue o padrão" vira o valor fixo
 *   que o padrão representa; texto livre vai junto para o admin ler.
 * - Planos em texto livre são parseados por heurística (linhas com ➡️ ou R$)
 *   nas listas antigas por serviço. O texto bruto continua em
 *   `planos_comercializados` para o time conferir.
 */

type Bucket = Record<string, unknown>;
export type RespostasPorDepartamento = Record<string, Bucket>;

export interface SessaoCompat {
  empresa_nome?: string | null;
  erp?: string | null;
  gerenciamento_rede?: string | null;
  qtd_sessoes?: number | string | null;
  cadastro?: {
    nome_fantasia?: string;
    responsavel_email?: string;
    responsavel_whatsapp?: string;
  } | null;
}

const ERP_LABEL_TO_VALUE: Record<string, string> = {
  IXC: 'ixc', 'MK Solution': 'mk_solutions', Voalle: 'voalle', Hubsoft: 'hubsoft', 'Topp Sap': 'topsapp', SGP: 'sgp', RBX: 'outro', Outros: 'outro',
};
const REDE_LABEL_TO_VALUE: Record<string, string> = {
  'Smart OLT': 'smart_olt', 'OLT Cloud': 'olt_cloud', 'IXC-ACS': 'ixc_acs', Anlix: 'outro', 'Made 4 Graph': 'outro', Outros: 'outro',
};

const FLUXO_DIAGNOSTICO_PADRAO = [
  '1) Conferir se a conexão está bloqueada por débito — se estiver, encaminhar ao Financeiro.',
  '2) Verificar falha massiva na região — se houver, informar o cliente e não abrir chamado.',
  '3) Reconhecer cliente recorrente (3º contato em 7 dias vai direto para a equipe com prioridade).',
  '4) Perguntar se está sem conexão ou lenta — em lentidão, checar consumo anormal.',
  '5) Pedir que fique perto do roteador e mande foto dos LEDs; conferir fibra e cabos.',
  '6) Consultar o sinal da ONU — crítico vai para a equipe com nota técnica.',
  '7) Sinal OK: perguntas sobre aparelhos e sites, testes simples (outro aparelho, 2.4G/5G), diagnóstico de Wi-Fi e 1 reinício remoto.',
  '8) Não resolveu: diagnóstico automático N2, transferir para o suporte com resumo e abrir chamado.',
].join('\n');

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const isSim = (v: unknown) => str(v) === 'sim';
const vazio = (v: unknown) => v === undefined || v === null || v === '';
const selected = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : v && typeof v === 'object' && Array.isArray((v as { selected?: unknown }).selected)
    ? ((v as { selected: unknown[] }).selected).map(String)
    : [];
const outroTexto = (v: unknown): string => (v && typeof v === 'object' ? str((v as { outroTexto?: unknown }).outroTexto) : '');
const numeros = (texto: string): number[] =>
  texto.split(/[,;\n/]+/).map((s) => parseInt(s.replace(/\D/g, ''), 10)).filter((n) => Number.isFinite(n));

/** Só preenche se ainda não existir (sessões antigas continuam intactas). */
function def(b: Bucket, id: string, valor: unknown) {
  if (b[id] === undefined && !vazio(valor)) b[id] = valor;
}

// ----------------------------------------------------------------- planos
export interface PlanoLegado {
  nome: string; preco: string; velocidade_download?: number; velocidade_upload?: number; simetrico?: boolean;
  beneficios: string; publico_alvo?: string; argumento_venda?: string; taxa_instalacao?: string;
}
export interface PlanosParseados {
  residencial: PlanoLegado[]; pme: PlanoLegado[]; radio: PlanoLegado[]; telefonia_fixa: PlanoLegado[];
  chip_movel: PlanoLegado[]; tv_streaming: PlanoLegado[]; combos: Array<{ nome: string; preco_final: string; publico_alvo: string }>;
  variacoes: string[];
}

function categoriaDoTitulo(linha: string): keyof PlanosParseados | null {
  const t = linha.toLowerCase();
  if (/combo|pacote/.test(t)) return 'combos';
  if (/empres|pme|corporat/.test(t)) return 'pme';
  if (/r[aá]dio|rural/.test(t)) return 'radio';
  if (/m[oó]vel|chip|celular/.test(t)) return 'chip_movel';
  if (/telefon|fixo/.test(t)) return 'telefonia_fixa';
  if (/\btv\b|stream|iptv/.test(t)) return 'tv_streaming';
  if (/varia|condi/.test(t)) return 'variacoes';
  if (/internet|fibra|residenc|plano/.test(t)) return 'residencial';
  return null;
}

function parsePlano(linha: string): PlanoLegado {
  const semSeta = linha.replace(/^[\s➡️▶•\-*]+/, '').trim();
  const partes = semSeta.split(/\s+[—–-]\s+/).map((s) => s.trim()).filter(Boolean);
  const nomeBruto = partes[0] ?? semSeta;
  const nome = nomeBruto.replace(/[*_]/g, '').replace(/\s*[:.]\s*$/, '').trim();
  const precoMatch = semSeta.match(/R\$\s*([\d.]+,\d{2}|[\d.]+)/i);
  const preco = precoMatch ? precoMatch[1].replace(/\./g, '').replace(',', '.') : '';
  const velMatch = semSeta.match(/(\d+(?:[.,]\d+)?)\s*(giga|gbps|gb|mega|mbps|mb)\b/i);
  let velocidade_download: number | undefined;
  if (velMatch) {
    const n = parseFloat(velMatch[1].replace(',', '.'));
    velocidade_download = /giga|gbps|gb/i.test(velMatch[2]) ? Math.round(n * 1000) : Math.round(n);
  }
  const simetrico = /sim[eé]tric/i.test(semSeta);
  const beneficios = partes.slice(1).filter((p) => !/R\$/.test(p)).join(' — ');
  return {
    nome, preco, velocidade_download,
    velocidade_upload: simetrico ? velocidade_download : undefined,
    simetrico: simetrico || undefined,
    beneficios,
  };
}

/** Heurística sobre o texto livre `planos_comercializados` (formato do placeholder do onboarding 4.3). */
export function parsePlanosTexto(texto: string): PlanosParseados {
  const out: PlanosParseados = { residencial: [], pme: [], radio: [], telefonia_fixa: [], chip_movel: [], tv_streaming: [], combos: [], variacoes: [] };
  let atual: keyof PlanosParseados = 'residencial';
  for (const raw of texto.split(/\r?\n/)) {
    const linha = raw.trim();
    if (!linha) continue;
    const ehPlano = /^[➡️▶•\-*]/.test(linha) || /R\$\s*\d/.test(linha);
    if (!ehPlano) {
      const cat = categoriaDoTitulo(linha);
      if (cat && cat !== 'variacoes' && linha.length < 60) { atual = cat; continue; }
      if (cat === 'variacoes') { atual = 'variacoes'; continue; }
      // linha solta de texto: trata como variação/condição
      out.variacoes.push(linha);
      continue;
    }
    if (atual === 'variacoes') { out.variacoes.push(linha.replace(/^[\s➡️▶•\-*]+/, '')); continue; }
    const p = parsePlano(linha);
    if (atual === 'combos') out.combos.push({ nome: p.nome, preco_final: p.preco, publico_alvo: p.beneficios });
    else out[atual].push(p);
  }
  return out;
}

// ----------------------------------------------------------------- horário
function primeiroHorario(b: Bucket, prefixo: string, ignorar: RegExp): unknown {
  const chaves = Object.keys(b).filter((k) => k.startsWith(prefixo) && !ignorar.test(k));
  const preferido = chaves.find((k) => k === 'horario_atendimento_geral') ?? chaves[0];
  return preferido ? b[preferido] : undefined;
}

// ----------------------------------------------------------------- principal
export function aplicarCompatLegado(r: RespostasPorDepartamento, sessao: SessaoCompat): RespostasPorDepartamento {
  const idn = (r.identificacao ??= {});
  const sac = (r.sac_geral ??= {});
  const fin = (r.financeiro ??= {});
  const sup = (r.suporte ??= {});
  const ven = (r.vendas ??= {});
  const cad = sessao.cadastro ?? {};

  // ---- Identificação
  const numeros_wa = Array.isArray(idn.whatsapp_numeros) ? (idn.whatsapp_numeros as Array<{ numero?: string; tipo?: string }>) : [];
  const oficial = numeros_wa.find((n) => n.tipo === 'oficial') ?? numeros_wa[0];
  def(idn, 'whatsapp_business', str(oficial?.numero));
  def(idn, 'admin_email', str(cad.responsavel_email));
  const sessoes = Number(sessao.qtd_sessoes);
  if (Number.isFinite(sessoes) && sessoes > 0) {
    const base = sessoes * 2; // regra comercial: sessões ≈ metade da base ativa
    def(idn, 'numero_assinantes', base < 1000 ? '<1k' : base < 5000 ? '1k-5k' : base < 15000 ? '5k-15k' : base < 50000 ? '15k-50k' : '50k+');
  }

  // ---- SAC Geral
  def(sac, 'empresa_nome_oficial', str(cad.nome_fantasia) || str(sessao.empresa_nome));
  const end = sac.empresa_endereco_sede as Record<string, string> | undefined;
  if (end && typeof end === 'object') {
    def(sac, 'empresa_cep', str(end.cep));
    def(sac, 'empresa_logradouro', str(end.logradouro));
    def(sac, 'empresa_numero', str(end.numero));
    def(sac, 'empresa_complemento', str(end.complemento));
    def(sac, 'empresa_bairro', str(end.bairro));
    def(sac, 'empresa_cidade', str(end.cidade));
    def(sac, 'empresa_uf', str(end.uf));
  }
  def(sac, 'horario_atendimento', primeiroHorario(sac, 'horario_', /^horario_plantao/));
  const plantao = selected(sac.plantao_departamentos);
  if (sac.plantao_departamentos !== undefined) {
    def(sac, 'tem_plantao', plantao.length ? 'sim' : 'nao');
    const textos = Object.keys(sac).filter((k) => k.startsWith('horario_plantao_')).map((k) => `${k.replace('horario_plantao_', '')}: ${str(sac[k])}`);
    def(sac, 'horario_plantao', textos.join(' | '));
  }
  def(sac, 'departamentos_outros', outroTexto(sac.departamentos_lista));
  if (sac.cancelamento_padrao !== undefined) {
    def(sac, 'cancelamento_coletar_motivo', 'sim');
    def(sac, 'cancelamento_tentar_reter', 'coletar_transferir');
    def(sac, 'cancelamento_departamento', isSim(sac.cancelamento_padrao)
      ? 'Padrão Pipeelo: coleta o motivo e transfere para o departamento que trata cancelamento na descrição de atividades (Cancelamento/Retenção; senão Financeiro/SAC).'
      : str(sac.cancelamento_fluxo_desejado));
    def(sac, 'cancelamento_fluxo', 'retencao');
  }
  def(sac, 'nps_nota_baixa_acao', 'coletar_motivo');
  def(sac, 'nps_nota_alta_acao', 'avaliacao_google');
  def(sac, 'suspensao_temporaria_departamento', 'financeiro');
  def(sac, 'ponto_adicional_departamento', 'comercial');
  if (sac.app_tem !== undefined) def(sac, 'login_senha_app', isSim(sac.app_tem) ? str(sac.app_nome) : '');

  // ---- Financeiro
  // Ids que MANTIVERAM o nome mas trocaram de formato: o admin lê o formato antigo,
  // então o valor novo vai para `<id>_v4` e o id original recebe o formato legado.
  const trocaFormato = (b: Bucket, id: string, legado: unknown) => {
    if (b[`${id}_v4`] !== undefined) return; // já convertido
    b[`${id}_v4`] = b[id];
    b[id] = legado;
  };
  if (str(fin.gateway_pagamento) === 'fora_erp') {
    const nome = str(fin.gateway_outro).toLowerCase();
    trocaFormato(fin, 'gateway_pagamento', /7az|bemobi/.test(nome) ? '7az' : 'outro');
  }
  if (typeof fin.vencimentos_disponiveis === 'string') {
    const dias = numeros(fin.vencimentos_disponiveis);
    const padrao = dias.filter((d) => [5, 10, 15, 20, 25].includes(d)).map(String);
    const outros = dias.filter((d) => ![5, 10, 15, 20, 25].includes(d));
    trocaFormato(fin, 'vencimentos_disponiveis', { selected: outros.length ? [...padrao, 'outro'] : padrao, outroTexto: outros.join(', ') });
    def(fin, 'vencimentos_outros', outros.join(', '));
  }
  const reguaLegado = (texto: string, sufixo: string, zero: string) => {
    const dias = numeros(texto);
    const conhecidos = sufixo === '_antes' ? [10, 7, 5, 3, 1] : [1, 3, 5, 7, 10, 15];
    const sel = dias.map((d) => (d === 0 ? zero : conhecidos.includes(d) ? `${d}${sufixo}` : null)).filter((x): x is string => !!x);
    const outros = dias.filter((d) => d !== 0 && !conhecidos.includes(d));
    return { selected: outros.length ? [...sel, 'outro'] : sel, outroTexto: outros.join(', ') };
  };
  if (typeof fin.regua_dias_antes === 'string') trocaFormato(fin, 'regua_dias_antes', reguaLegado(fin.regua_dias_antes, '_antes', 'no_dia'));
  if (typeof fin.regua_dias_depois === 'string') trocaFormato(fin, 'regua_dias_depois', reguaLegado(fin.regua_dias_depois, '_depois', 'no_dia'));
  const horarios = Array.isArray(fin.regua_horarios) ? (fin.regua_horarios as Array<{ horario?: string }>) : [];
  def(fin, 'regua_horario_disparo', str(horarios[0]?.horario));
  const dl = str(fin.dias_liberacao_confianca);
  if (/^\d+h$/.test(dl)) trocaFormato(fin, 'dias_liberacao_confianca', Math.max(1, Math.round(parseInt(dl, 10) / 24)));
  else if (dl === 'outro') trocaFormato(fin, 'dias_liberacao_confianca', numeros(str(fin.dias_liberacao_confianca_outro))[0] ?? str(fin.dias_liberacao_confianca_outro));
  if (fin.faturas_transfere_padrao !== undefined) {
    def(fin, 'faturas_transfere_cobranca', isSim(fin.faturas_transfere_padrao) ? 2 : numeros(str(fin.faturas_transfere_fluxo))[0] ?? str(fin.faturas_transfere_fluxo));
  }
  def(fin, 'cobranca_incorreta', 'coletar_transferir');
  def(fin, 'pagamento_duplicado', 'coletar_transferir');
  def(fin, 'comprovante_enviado', 'libera_confianca');
  if (fin.followup_financeiro_padrao !== undefined) {
    def(fin, 'followup_financeiro_ativo', 'sim');
    def(fin, 'followup_financeiro_minutos', isSim(fin.followup_financeiro_padrao) ? 10 : Number(fin.followup_financeiro_minutos_mensagem) || 10);
    def(fin, 'followup_financeiro_transferir_minutos', isSim(fin.followup_financeiro_padrao) ? 5 : Number(fin.followup_financeiro_minutos_transferir) || 5);
  }
  // taxa de visita mudou de Suporte para Financeiro › Taxas: espelha no Suporte.
  for (const k of ['taxa_visita', 'taxa_visita_valor', 'taxa_visita_regras']) def(sup, k, fin[k]);

  // ---- Suporte
  def(sup, 'erp_utilizado', sessao.erp ? ERP_LABEL_TO_VALUE[sessao.erp] ?? 'outro' : undefined);
  if (sessao.erp && !ERP_LABEL_TO_VALUE[sessao.erp]) def(sup, 'erp_outro_nome', sessao.erp);
  def(sup, 'olt_sistema', sessao.gerenciamento_rede ? REDE_LABEL_TO_VALUE[sessao.gerenciamento_rede] ?? 'outro' : undefined);
  if (sessao.gerenciamento_rede && REDE_LABEL_TO_VALUE[sessao.gerenciamento_rede] === 'outro') def(sup, 'olt_sistema_outro', sessao.gerenciamento_rede);
  def(sup, 'erp_credenciais_disponiveis', 'sim');
  def(sup, 'usar_base_conhecimento_ceps', str(sup.viabilidade_kmz));
  if (sup.cliente_teste_cpf !== undefined || sup.cliente_teste_observacoes !== undefined) {
    def(sup, 'cliente_teste_disponibilidade', str(sup.cliente_teste_cpf) ? 'sim' : 'preparar');
  }
  if (sup.sinal_padrao !== undefined) {
    if (isSim(sup.sinal_padrao)) {
      def(sup, 'sinal_onu_minimo', '-27');
      def(sup, 'sinal_onu_maximo', '-8');
      def(sup, 'sinal_onu_aceitavel', '-18');
    } else {
      def(sup, 'sinal_onu_observacao', str(sup.sinal_padrao_proprio));
    }
  }
  if (sup.sinal_fora_padrao_padrao !== undefined) {
    def(sup, 'acao_sinal_fora_padrao', isSim(sup.sinal_fora_padrao_padrao) ? 'tenta_reset' : 'transfere_suporte');
    if (!isSim(sup.sinal_fora_padrao_padrao)) def(sup, 'acao_sinal_fora_padrao_texto', str(sup.sinal_fora_padrao_fluxo));
  }
  if (sup.fluxo_diagnostico_padrao !== undefined) {
    def(sup, 'fluxo_diagnostico_texto', isSim(sup.fluxo_diagnostico_padrao) ? FLUXO_DIAGNOSTICO_PADRAO : str(sup.fluxo_diagnostico_texto));
    def(sup, 'tipos_problema_comuns', { selected: ['sem_internet', 'lentidao', 'wifi_sinal', 'senha_wifi', 'nome_wifi', 'mudar_endereco', 'ping_alto', 'iptv'], outroTexto: '' });
    def(sup, 'cliente_inadimplente_acao', 'transfere_financeiro');
  }
  if (sup.alteracoes_remotas_padrao !== undefined) {
    const tr069 = str(sup.protocolo_tr069);
    const pode = tr069 === 'sim' || tr069 === 'parcial' ? 'sim' : 'nao';
    def(sup, 'troca_senha_wifi', pode);
    def(sup, 'troca_nome_wifi', pode);
    def(sup, 'validacao_troca_senha', { selected: ['data_nascimento', 'email'], outroTexto: '' });
    def(sup, 'verificar_dispositivos', pode === 'sim' ? 'sim_mostrar' : 'nao');
    if (str(sup.alteracoes_remotas_padrao) === 'diferente') def(sup, 'alteracoes_remotas_observacao', str(sup.alteracoes_remotas_texto));
  }
  def(sup, 'pos_instalacao_ativo', 'nao');
  def(sup, 'pos_suporte_ativo', 'nao');
  if (sup.followup_suporte_padrao !== undefined) {
    def(sup, 'followup_suporte_ativo', 'sim');
    def(sup, 'followup_suporte_minutos', isSim(sup.followup_suporte_padrao) ? 10 : Number(sup.followup_suporte_minutos_mensagem) || 10);
    def(sup, 'followup_suporte_transferir_minutos', isSim(sup.followup_suporte_padrao) ? 5 : Number(sup.followup_suporte_minutos_transferir) || 5);
  }

  // ---- Vendas
  const textoPlanos = str(ven.planos_comercializados);
  if (textoPlanos) {
    const p = parsePlanosTexto(textoPlanos);
    const servicos: string[] = [];
    if (p.residencial.length) { def(ven, 'planos_internet_residencial', p.residencial); servicos.push('internet_residencial'); }
    if (p.pme.length) { def(ven, 'planos_internet_pme', p.pme); servicos.push('internet_pme'); }
    if (p.radio.length) { def(ven, 'planos_internet_radio', p.radio); servicos.push('internet_radio'); }
    if (p.telefonia_fixa.length) { def(ven, 'planos_telefonia_fixa', p.telefonia_fixa); servicos.push('telefonia_fixa'); }
    if (p.chip_movel.length) { def(ven, 'planos_chip_movel', p.chip_movel); servicos.push('chip_movel'); }
    if (p.tv_streaming.length) { def(ven, 'planos_tv_streaming', p.tv_streaming); servicos.push('tv_streaming'); }
    def(ven, 'servicos_oferecidos', { selected: servicos.length ? servicos : ['internet_residencial'], outroTexto: '' });
    def(ven, 'tem_planos_empresariais', p.pme.length ? 'sim' : 'mesmos');
    def(ven, 'tem_combos', p.combos.length ? 'sim' : 'nao');
    if (p.combos.length) def(ven, 'combos_disponiveis', p.combos);
    if (p.variacoes.length) def(ven, 'planos_variacoes', p.variacoes.join('\n'));
  }
  if (ven.fluxo_vendas_padrao !== undefined) {
    def(ven, 'perguntas_qualificacao_lista', { selected: [], outroTexto: '' });
    def(ven, 'metodo_vendas', isSim(ven.fluxo_vendas_padrao) ? 'Padrão Pipeelo (fluxo Direct): viabilidade → modalidades → planos → instalação/fidelidade → pré-cadastro → CRM.' : str(ven.fluxo_vendas_alteracoes));
  }
  if (ven.objecoes_padrao !== undefined) {
    def(ven, 'objecoes_comuns', isSim(ven.objecoes_padrao) ? 'Padrão Pipeelo (biblioteca de objeções do fluxo Direct).' : str(ven.objecoes_texto));
  }
  def(ven, 'cancelamento_fluxo', 'retencao');
  if (ven.agendamento_ia !== undefined) {
    def(ven, 'agendamento_instalacao', isSim(ven.agendamento_ia) ? 'ia_preenche_os' : 'comercial_humano');
    def(ven, 'janela_agendamento', 'periodo');
  }
  if (ven.followup_vendas_padrao !== undefined) {
    def(ven, 'followup_vendas_ativo', 'sim');
    def(ven, 'followup_vendas_minutos', isSim(ven.followup_vendas_padrao) ? 10 : Number(ven.followup_vendas_minutos_mensagem) || 10);
    def(ven, 'followup_vendas_transferir_minutos', isSim(ven.followup_vendas_padrao) ? 5 : Number(ven.followup_vendas_minutos_transferir) || 5);
  }

  return r;
}
