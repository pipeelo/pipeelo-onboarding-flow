/**
 * Gera public/modelo-departamentos-equipe.xlsx — planilha modelo que o cliente
 * baixa na seção "Equipe e Acessos" do onboarding (sac_geral).
 *
 * Rodar: npm i --no-save xlsx && node scripts/gen-modelo-equipe.mjs
 * O .xlsx gerado é commitado como asset estático; este script só roda quando
 * o modelo precisar mudar.
 */
import * as XLSX from 'xlsx';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const departamentos = [
  ['Departamento', 'Cidades que atende', 'O que esse departamento trata'],
  ['Atendimento Geral / SAC', 'Todas', 'Dúvidas gerais, troca de titularidade, atualização de cadastro, reclamações'],
  ['Financeiro', 'Todas (centralizado na matriz)', '2ª via de boleto, desbloqueio em confiança, negociação de débitos, alteração de vencimento, estorno'],
  ['Cobrança', 'Todas', 'Contato com inadimplentes, parcelamento, aviso de corte'],
  ['Suporte Técnico N1', 'Londrina', 'Diagnóstico de conexão, reset de ONU, troca de senha e nome do Wi-Fi'],
  ['Suporte Técnico N1', 'Cambé', 'Diagnóstico de conexão, reset de ONU, troca de senha e nome do Wi-Fi'],
  ['Suporte Técnico N2', 'Todas (equipe em Londrina)', 'Casos escalados do N1, configurações avançadas, agendamento de visita técnica'],
  ['Comercial / Vendas', 'Londrina', 'Apresentação de planos, upgrades, novas instalações'],
  ['Comercial / Vendas', 'Cambé', 'Apresentação de planos, upgrades, novas instalações'],
];

const equipe = [
  ['Nome completo', 'E-mail (será o login)', 'Departamento(s)', 'Cidade/unidade', 'Papel (Gestor ou Atendente)'],
  ['Ana Souza', 'ana@provedor.com.br', 'Financeiro, Cobrança', 'Todas', 'Gestor'],
  ['Bruno Lima', 'bruno@provedor.com.br', 'Financeiro', 'Todas', 'Atendente'],
  ['Carla Nunes', 'carla@provedor.com.br', 'Suporte Técnico N1', 'Londrina', 'Atendente'],
  ['Diego Ramos', 'diego@provedor.com.br', 'Suporte Técnico N1', 'Cambé', 'Atendente'],
  ['Eduardo Alves', 'eduardo@provedor.com.br', 'Suporte Técnico N2', 'Todas', 'Gestor'],
  ['Fernanda Costa', 'fernanda@provedor.com.br', 'Comercial / Vendas', 'Londrina', 'Atendente'],
  ['João Pereira (sócio)', 'joao@provedor.com.br', 'Todos', 'Todas', 'Gestor'],
];

const wb = XLSX.utils.book_new();

const wsDep = XLSX.utils.aoa_to_sheet(departamentos);
wsDep['!cols'] = [{ wch: 26 }, { wch: 30 }, { wch: 95 }];
XLSX.utils.book_append_sheet(wb, wsDep, 'Departamentos');

const wsEq = XLSX.utils.aoa_to_sheet(equipe);
wsEq['!cols'] = [{ wch: 24 }, { wch: 30 }, { wch: 26 }, { wch: 18 }, { wch: 28 }];
XLSX.utils.book_append_sheet(wb, wsEq, 'Equipe');

const out = resolve(__dirname, '..', 'public', 'modelo-departamentos-equipe.xlsx');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
writeFileSync(out, buf);
console.log(`OK — gerado ${out} (${buf.length} bytes)`);
