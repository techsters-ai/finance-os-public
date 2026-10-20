import { describe, expect, it } from 'vitest';
import { splitTax, taxCategory, taxRuleFor } from './tax';
import { account, category } from './fixtures.test-utils';

const card = account({ id: 'card', currency: 'USD' });
const dep = account({ id: 'dep', currency: 'TRY', type: 'deposit', tax_rate: 0.1, auto_tax: 'net', interest_to: 'card' });
const own = account({ id: 'own', currency: 'GEL', tax_rate: 0.05, auto_tax: 'gross' });

describe('automatic tax', () => {
  it("an account's own setting, or for interest the deposit paying into it", () => {
    expect(taxRuleFor(own, false, [own])).toMatchObject({ rate: 0.05, mode: 'gross', from: { id: 'own' } });
    expect(taxRuleFor(card, true, [card, dep])).toMatchObject({ rate: 0.1, mode: 'net', from: { id: 'dep' } });
    expect(taxRuleFor(card, false, [card, dep])).toBeUndefined(); // work income on the card: no tax
    expect(taxRuleFor(account({ id: 'x', currency: 'USD', tax_rate: 0.1 }), false, [])).toBeUndefined(); // switch off
  });
  it('before tax: the tax comes off; after tax: the income is grossed up', () => {
    expect(splitTax(1000, { rate: 0.05, mode: 'gross', from: own }, 'GEL')).toEqual({ income: 1000, tax: 50 });
    expect(splitTax(90, { rate: 0.1, mode: 'net', from: dep }, 'USD')).toEqual({ income: 100, tax: 10 });
  });
  it('taxes go to the Taxes category on every board', () => {
    const cats = [category({ id: 'exp_tax_old', name: 'Tax fines', kind: 'expense' }), category({ id: 'exp_taxes', name: 'Taxes', kind: 'expense', scope: 'liquid, business, investment' })];
    expect(taxCategory(cats)?.id).toBe('exp_taxes');
  });
});
