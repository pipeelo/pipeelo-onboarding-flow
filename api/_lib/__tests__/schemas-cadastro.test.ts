import { describe, it, expect } from 'vitest';
import { CadastroSchema, PhoneBrSchema } from '../schemas/cadastro';

const upload = { path: 'sess/cadastro/doc/1-a.pdf', nome_original: 'a.pdf', tamanho: 10 };

const valido = {
  cnpj: '11.222.333/0001-81',
  razao_social: 'Provedor Exemplo Ltda',
  nome_fantasia: 'Provedor Exemplo',
  inscricao_estadual: 'Isento',
  cobranca_email: 'financeiro@exemplo.com.br',
  cobranca_telefone: '(43) 3322-1100',
  dia_vencimento: 10,
  contrato_email: 'juridico@exemplo.com.br',
  doc_contrato_social: [upload],
  doc_responsaveis: [upload],
  responsavel_nome: 'Ana Souza',
  responsavel_cargo: 'Diretora',
  responsavel_email: 'ana@exemplo.com.br',
  responsavel_whatsapp: '(43) 99666-1541',
  contatos_extras: [{ nome: 'João', whatsapp: '(43) 99111-2233' }],
  aceite_dados: true,
};

describe('PhoneBrSchema', () => {
  it('normaliza máscara brasileira para dígitos', () => {
    expect(PhoneBrSchema.parse('(43) 99666-1541')).toBe('43996661541');
  });
  it('remove o 55 da frente', () => {
    expect(PhoneBrSchema.parse('+55 43 99666-1541')).toBe('43996661541');
  });
  it('rejeita sem DDD', () => {
    expect(() => PhoneBrSchema.parse('996661541')).toThrow();
  });
});

describe('CadastroSchema', () => {
  it('aceita payload completo e normaliza cnpj e e-mails', () => {
    const r = CadastroSchema.parse(valido);
    expect(r.cnpj).toBe('11222333000181');
    expect(r.cobranca_email).toBe('financeiro@exemplo.com.br');
    expect(r.responsavel_whatsapp).toBe('43996661541');
  });
  it('rejeita mais de 2 contatos extras', () => {
    const extras = [1, 2, 3].map((i) => ({ nome: `P${i}`, whatsapp: '(43) 99111-223' + i }));
    expect(() => CadastroSchema.parse({ ...valido, contatos_extras: extras })).toThrow();
  });
  it('exige aceite', () => {
    expect(() => CadastroSchema.parse({ ...valido, aceite_dados: false })).toThrow();
  });
  it('exige ao menos 1 documento de cada', () => {
    expect(() => CadastroSchema.parse({ ...valido, doc_contrato_social: [] })).toThrow();
  });
  it('rejeita dia de vencimento fora da lista', () => {
    expect(() => CadastroSchema.parse({ ...valido, dia_vencimento: 12 })).toThrow();
  });
});
