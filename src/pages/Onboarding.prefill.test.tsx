import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, sessionApi: { ...actual.sessionApi, get: vi.fn(), saveResposta: vi.fn(async () => ({ ok: true, saved_at: '' })) } };
});
import { sessionApi } from '@/lib/api-client';
import Onboarding from './Onboarding';

const sessaoBase = {
  id: 's', slug: 'abc', empresa_nome: 'Provedor X', modo: 'completo',
  status_identificacao: 'concluido', status_sac_geral: 'pendente', status_financeiro: 'pendente', status_suporte: 'pendente', status_vendas: 'pendente',
};

function renderDept(dept: string) {
  return render(
    <MemoryRouter initialEntries={[`/abc/${dept}?token=tok-32-chars-xxxxxxxxxxxxxxxxxx`]}>
      <Routes><Route path="/:slug/:departamento" element={<Onboarding />} /></Routes>
    </MemoryRouter>
  );
}

describe('Onboarding — prefill do SAC Geral a partir do /cadastro', () => {
  beforeEach(() => vi.clearAllMocks());

  it('usa o endereço da sede do lookup de CNPJ quando ainda não há resposta', async () => {
    (sessionApi.get as never as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: {
        ...sessaoBase,
        cadastro: {
          cnpj: '11222333000181', razao_social: 'PROVEDOR X LTDA', nome_fantasia: 'Provedor X',
          endereco_sede: { cep: '86010-000', logradouro: 'Avenida Brasil', numero: '100', complemento: '', bairro: 'Centro', cidade: 'Londrina', uf: 'PR' },
        },
      },
      respostas: [],
    });
    renderDept('sac_geral');
    const cep = await screen.findByLabelText('CEP');
    expect((cep as HTMLInputElement).value).toBe('86010-000');
    expect((screen.getByLabelText('Rua / Avenida') as HTMLInputElement).value).toBe('Avenida Brasil');
    expect((screen.getByLabelText('Cidade') as HTMLInputElement).value).toBe('Londrina');
  });

  it('não sobrescreve o endereço que o cliente já respondeu', async () => {
    (sessionApi.get as never as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: {
        ...sessaoBase,
        cadastro: { cnpj: '11222333000181', endereco_sede: { cep: '86010-000', logradouro: 'Avenida Brasil', numero: '100', complemento: '', bairro: 'Centro', cidade: 'Londrina', uf: 'PR' } },
      },
      respostas: [{ departamento: 'sac_geral', pergunta_id: 'empresa_endereco_sede', valor: { cep: '80000-000', logradouro: 'Rua Nova', numero: '1', complemento: '', bairro: 'B', cidade: 'Curitiba', uf: 'PR' } }],
    });
    renderDept('sac_geral');
    const cep = await screen.findByLabelText('CEP');
    expect((cep as HTMLInputElement).value).toBe('80000-000');
  });
});

describe('Onboarding — Identificação 4.0', () => {
  beforeEach(() => vi.clearAllMocks());

  it('começa pelos números de WhatsApp, sem pedir CNPJ de novo', async () => {
    (sessionApi.get as never as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: { ...sessaoBase, status_identificacao: 'pendente', cadastro: { cnpj: '11222333000181' } },
      respostas: [],
    });
    renderDept('identificacao');
    expect(await screen.findByText('Quais números de WhatsApp a empresa usa no atendimento?')).toBeTruthy();
    expect(screen.queryByPlaceholderText('00.000.000/0000-00')).toBeNull();
  });
});
