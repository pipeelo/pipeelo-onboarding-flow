import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    sessionApi: {
      ...actual.sessionApi,
      get: vi.fn(),
      cnpjLookup: vi.fn(async () => ({ razao_social: 'PROVEDOR X LTDA', nome_fantasia: 'Provedor X' })),
      cadastroSubmit: vi.fn(),
      uploadArquivo: vi.fn(),
    },
  };
});
import { sessionApi } from '@/lib/api-client';
import Cadastro from './Cadastro';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/cadastro/abc?token=tok-32-chars-xxxxxxxxxxxxxxxxxx']}>
      <Routes><Route path="/cadastro/:slug" element={<Cadastro />} /></Routes>
    </MemoryRouter>
  );
}

describe('Cadastro', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('mostra o passo 1 com o nome da empresa e preenche pela BrasilAPI', async () => {
    (sessionApi.get as never as ReturnType<typeof vi.fn>).mockResolvedValue({ session: { id: 's', slug: 'abc', empresa_nome: 'Provedor X', cadastro_enviado_at: null }, respostas: [] });
    renderPage();
    expect(await screen.findByText(/Dados da empresa/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/CNPJ/i), { target: { value: '11222333000181' } });
    await waitFor(() => expect(sessionApi.cnpjLookup).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByLabelText(/Razão social/i) as HTMLInputElement).value).toBe('PROVEDOR X LTDA'));
  });

  it('mostra confirmação quando o cadastro já foi enviado', async () => {
    (sessionApi.get as never as ReturnType<typeof vi.fn>).mockResolvedValue({ session: { id: 's', slug: 'abc', empresa_nome: 'Provedor X', cadastro_enviado_at: '2026-09-01', grupo_jid: '1@g.us', grupo_invite_url: 'https://chat.whatsapp.com/x' }, respostas: [] });
    renderPage();
    expect(await screen.findByText(/Cadastro recebido/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /entrar no grupo/i })).toHaveAttribute('href', 'https://chat.whatsapp.com/x');
  });

  it('não avança o passo 1 sem CNPJ válido', async () => {
    (sessionApi.get as never as ReturnType<typeof vi.fn>).mockResolvedValue({ session: { id: 's', slug: 'abc', empresa_nome: 'Provedor X', cadastro_enviado_at: null }, respostas: [] });
    renderPage();
    await screen.findByText(/Dados da empresa/i);
    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/CNPJ/i);
  });
});
