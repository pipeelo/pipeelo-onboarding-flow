import { describe, it, expect } from 'vitest';
import { maskPhone, isPhoneBrValid } from './phone';
describe('phone', () => {
  it('mascara celular e fixo', () => {
    expect(maskPhone('43996661541')).toBe('(43) 99666-1541');
    expect(maskPhone('4333221100')).toBe('(43) 3322-1100');
  });
  it('valida DDD + 8/9 dígitos', () => {
    expect(isPhoneBrValid('(43) 99666-1541')).toBe(true);
    expect(isPhoneBrValid('99666')).toBe(false);
  });
});
