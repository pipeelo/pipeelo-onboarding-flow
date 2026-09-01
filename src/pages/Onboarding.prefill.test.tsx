import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, sessionApi: { ...actual.sessionApi, get: vi.fn(), saveResposta: vi.fn(async () => ({ ok: true, saved_at: '' })) } };
});
import { sessionApi } from '@/lib/api-client';
import Onboarding from './Onboarding';

describe('Onboarding — prefill da Identificação', () => {
  beforeEach(() => vi.clearAllMocks());
  it('usa o CNPJ do cadastro quando ainda não há resposta', async () => {
    (sessionApi.get as never as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: {
        id: 's', slug: 'abc', empresa_nome: 'Provedor X', modo: 'completo',
        status_identificacao: 'pendente', status_sac_geral: 'pendente', status_financeiro: 'pendente', status_suporte: 'pendente', status_vendas: 'pendente',
        cadastro: { cnpj: '11222333000181', razao_social: 'PROVEDOR X LTDA', nome_fantasia: 'Provedor X' },
      },
      respostas: [],
    });
    render(
      <MemoryRouter initialEntries={['/abc/identificacao?token=tok-32-chars-xxxxxxxxxxxxxxxxxx']}>
        <Routes><Route path="/:slug/:departamento" element={<Onboarding />} /></Routes>
      </MemoryRouter>
    );
    const input = await screen.findByPlaceholderText('00.000.000/0000-00');
    expect((input as HTMLInputElement).value).toBe('11.222.333/0001-81');
  });
});
