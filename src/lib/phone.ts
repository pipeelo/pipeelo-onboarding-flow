/**
 * Máscara e validação de telefone brasileiro — mesma lógica do `case 'phone'`
 * do renderer de perguntas do onboarding.
 *
 * maskPhone: formata progressivamente (00) 0000-0000 / (00) 00000-0000.
 * phoneDigits: só os dígitos.
 * isPhoneBrValid: DDD + 8 (fixo) ou 9 (celular) dígitos.
 */

export function maskPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}

export function phoneDigits(v: string): string {
  return v.replace(/\D/g, '');
}

export function isPhoneBrValid(v: string): boolean {
  const d = phoneDigits(v);
  return d.length === 10 || d.length === 11;
}
