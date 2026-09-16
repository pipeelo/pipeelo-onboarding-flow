// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { GUIA_ONBOARDING_URL, WELCOME_TEMPLATE } from '../welcome-template';

describe('WELCOME_TEMPLATE', () => {
  it('leva o link do formulário e o guia de preenchimento', () => {
    const texto = WELCOME_TEMPLATE('https://onboarding.pipeelo.com/s/abc123');
    expect(texto).toContain('https://onboarding.pipeelo.com/s/abc123');
    expect(texto).toContain(GUIA_ONBOARDING_URL);
    expect(GUIA_ONBOARDING_URL).toBe('https://treinamentos.pipeelo.com/onboarding');
  });

  it('manda a dúvida para o grupo', () => {
    expect(WELCOME_TEMPLATE('x')).toContain('chamar aqui no grupo');
  });
});
