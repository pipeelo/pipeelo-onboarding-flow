import { describe, it, expect } from 'vitest';
import { aplicarCompatLegado, parsePlanosTexto } from '../compat-legado';

const H = { segunda_sexta: { inicio: '08:00', fim: '18:00', nao_atende: false }, sabado: { inicio: '08:00', fim: '12:00', nao_atende: false }, domingo_feriado: { inicio: '', fim: '', nao_atende: true } };

const sessao = {
  empresa_nome: 'Provedor X', erp: 'Hubsoft', gerenciamento_rede: 'Smart OLT', qtd_sessoes: 4000,
  cadastro: { nome_fantasia: 'Provedor X Fibra', responsavel_email: 'ceo@x.com.br' },
};

function base() {
  return {
    identificacao: { whatsapp_numeros: [{ numero: '(43) 99111-2222', tipo: 'nao_oficial' }, { numero: '(43) 3000-1000', tipo: 'oficial' }] },
    sac_geral: {
      empresa_endereco_sede: { cep: '86010-000', logradouro: 'Av. Brasil', numero: '100', complemento: '', bairro: 'Centro', cidade: 'Londrina', uf: 'PR' },
      departamentos_lista: { selected: ['atendimento_geral', 'suporte', 'outro'], outroTexto: 'Ouvidoria, Instalação' },
      horario_atendimento_geral: H, horario_suporte: H, horario_outro_1: H,
      plantao_departamentos: { selected: ['suporte'] }, horario_plantao_suporte: '18h às 23h pelo mesmo número',
      cancelamento_padrao: 'sim', app_tem: 'sim', app_nome: 'Meu Provedor',
    },
    financeiro: {
      gateway_pagamento: 'fora_erp', gateway_outro: '7AZ Bemobi', vencimentos_disponiveis: '5, 10, 15, 28',
      regua_dias_antes: '10, 5, 0', regua_dias_depois: '1, 3, 20', regua_horarios: [{ horario: '09:00' }, { horario: '18:00' }],
      dias_liberacao_confianca: '48h', faturas_transfere_padrao: 'sim', followup_financeiro_padrao: 'nao',
      followup_financeiro_minutos_mensagem: 15, followup_financeiro_minutos_transferir: 7, taxa_visita: 'nao',
    },
    suporte: {
      protocolo_tr069: 'sim', viabilidade_kmz: 'sim', cliente_teste_cpf: '123.456.789-09',
      sinal_padrao: 'sim', sinal_fora_padrao_padrao: 'sim', fluxo_diagnostico_padrao: 'sim',
      alteracoes_remotas_padrao: 'padrao', followup_suporte_padrao: 'sim',
    },
    vendas: {
      planos_comercializados: [
        'INTERNET RESIDENCIAL (fibra)',
        '➡️ *Fibra 500 Mega* — 500 Mbps simétricos, Wi-Fi 6 em comodato — R$ 99,90/mês',
        '➡️ *Fibra 1 Giga* — 1 Gbps simétricos, 2 streamings — R$ 149,90/mês',
        'VARIAÇÕES', '- Sem fidelidade: + R$ 20,00/mês',
        'COMBOS', '➡️ *Fibra 750 + Telefone Fixo* — 750 Mega + linha fixa — R$ 139,90/mês',
        'EMPRESARIAL', '➡️ *Empresa 500* — 500 Mega simétricos, IP fixo, SLA 4h — R$ 249,90/mês',
      ].join('\n'),
      fluxo_vendas_padrao: 'sim', objecoes_padrao: 'nao', objecoes_texto: 'Não prometer instalação no mesmo dia.',
      agendamento_ia: 'sim', followup_vendas_padrao: 'sim',
    },
  } as Record<string, Record<string, unknown>>;
}

describe('compat-legado — ids antigos derivados do questions.json 4.x', () => {
  it('identificação: número oficial vira whatsapp_business; e-mail e faixa de assinantes vêm da sessão', () => {
    const r = aplicarCompatLegado(base(), sessao);
    expect(r.identificacao.whatsapp_business).toBe('(43) 3000-1000');
    expect(r.identificacao.admin_email).toBe('ceo@x.com.br');
    expect(r.identificacao.numero_assinantes).toBe('5k-15k');
  });

  it('SAC: endereço em 6 campos, nome oficial, horário geral, plantão, outros departamentos, cancelamento e app', () => {
    const r = aplicarCompatLegado(base(), sessao);
    const s = r.sac_geral;
    expect(s.empresa_nome_oficial).toBe('Provedor X Fibra');
    expect(s.empresa_cep).toBe('86010-000');
    expect(s.empresa_cidade).toBe('Londrina');
    expect(s.horario_atendimento).toEqual(H);
    expect(s.tem_plantao).toBe('sim');
    expect(s.horario_plantao).toBe('suporte: 18h às 23h pelo mesmo número');
    expect(s.departamentos_outros).toBe('Ouvidoria, Instalação');
    expect(s.cancelamento_coletar_motivo).toBe('sim');
    expect(String(s.cancelamento_departamento)).toContain('Padrão Pipeelo');
    expect(s.login_senha_app).toBe('Meu Provedor');
    expect(s.nps_nota_alta_acao).toBe('avaliacao_google');
  });

  it('financeiro: formatos antigos no id original e o valor novo em *_v4', () => {
    const r = aplicarCompatLegado(base(), sessao);
    const f = r.financeiro;
    expect(f.gateway_pagamento).toBe('7az');
    expect(f.gateway_pagamento_v4).toBe('fora_erp');
    expect(f.vencimentos_disponiveis).toEqual({ selected: ['5', '10', '15', 'outro'], outroTexto: '28' });
    expect(f.vencimentos_outros).toBe('28');
    expect(f.regua_dias_antes).toEqual({ selected: ['10_antes', '5_antes', 'no_dia'], outroTexto: '' });
    expect(f.regua_dias_depois).toEqual({ selected: ['1_depois', '3_depois', 'outro'], outroTexto: '20' });
    expect(f.regua_horario_disparo).toBe('09:00');
    expect(f.dias_liberacao_confianca).toBe(2);
    expect(f.dias_liberacao_confianca_v4).toBe('48h');
    expect(f.faturas_transfere_cobranca).toBe(2);
    expect(f.followup_financeiro_minutos).toBe(15);
    expect(f.followup_financeiro_transferir_minutos).toBe(7);
    expect(f.comprovante_enviado).toBe('libera_confianca');
    expect(r.suporte.taxa_visita).toBe('nao');
  });

  it('suporte: ERP/OLT da sessão, padrões de sinal, diagnóstico, alterações remotas e follow-up', () => {
    const r = aplicarCompatLegado(base(), sessao);
    const s = r.suporte;
    expect(s.erp_utilizado).toBe('hubsoft');
    expect(s.olt_sistema).toBe('smart_olt');
    expect(s.usar_base_conhecimento_ceps).toBe('sim');
    expect(s.cliente_teste_disponibilidade).toBe('sim');
    expect(s.sinal_onu_minimo).toBe('-27');
    expect(s.acao_sinal_fora_padrao).toBe('tenta_reset');
    expect(String(s.fluxo_diagnostico_texto)).toContain('8) Não resolveu');
    expect(s.troca_senha_wifi).toBe('sim');
    expect(s.verificar_dispositivos).toBe('sim_mostrar');
    expect(s.followup_suporte_ativo).toBe('sim');
    expect(s.followup_suporte_minutos).toBe(10);
    expect(s.pos_instalacao_ativo).toBe('nao');
  });

  it('vendas: planos em texto viram listas por serviço, combos, serviços e agendamento', () => {
    const r = aplicarCompatLegado(base(), sessao);
    const v = r.vendas;
    const res = v.planos_internet_residencial as Array<Record<string, unknown>>;
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ nome: 'Fibra 500 Mega', preco: '99.90', velocidade_download: 500, velocidade_upload: 500, simetrico: true });
    expect(res[1]).toMatchObject({ nome: 'Fibra 1 Giga', preco: '149.90', velocidade_download: 1000 });
    expect((v.planos_internet_pme as unknown[]).length).toBe(1);
    expect(v.tem_planos_empresariais).toBe('sim');
    expect(v.tem_combos).toBe('sim');
    expect(v.combos_disponiveis).toEqual([{ nome: 'Fibra 750 + Telefone Fixo', preco_final: '139.90', publico_alvo: '750 Mega + linha fixa' }]);
    expect(v.servicos_oferecidos).toEqual({ selected: ['internet_residencial', 'internet_pme'], outroTexto: '' });
    expect(String(v.planos_variacoes)).toContain('Sem fidelidade');
    expect(v.objecoes_comuns).toBe('Não prometer instalação no mesmo dia.');
    expect(v.agendamento_instalacao).toBe('ia_preenche_os');
    expect(v.followup_vendas_ativo).toBe('sim');
  });

  it('nunca sobrescreve resposta antiga já existente', () => {
    const r = base();
    r.sac_geral.empresa_nome_oficial = 'Nome Antigo';
    r.financeiro.gateway_pagamento = 'integrado_erp';
    const out = aplicarCompatLegado(r, sessao);
    expect(out.sac_geral.empresa_nome_oficial).toBe('Nome Antigo');
    expect(out.financeiro.gateway_pagamento).toBe('integrado_erp');
    expect(out.financeiro.gateway_pagamento_v4).toBeUndefined();
  });

  it('parsePlanosTexto tolera linha sem seta e preço sem centavos', () => {
    const p = parsePlanosTexto('Plano Start 300 Mega R$ 79\nTELEFONIA\n➡️ Fixo Ilimitado — ligações ilimitadas — + R$ 29,90/mês');
    expect(p.residencial[0]).toMatchObject({ nome: 'Plano Start 300 Mega R$ 79', preco: '79', velocidade_download: 300 });
    expect(p.telefonia_fixa[0]).toMatchObject({ nome: 'Fixo Ilimitado', preco: '29.90' });
  });
});
