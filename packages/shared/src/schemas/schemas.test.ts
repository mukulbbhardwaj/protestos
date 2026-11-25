import { describe, expect, it } from 'vitest';
import { CreateOrgInput, SignUpInput, UpdateOrgSettingsInput } from './index.js';

describe('shared schemas', () => {
  it('normalizes email', () => {
    const parsed = SignUpInput.parse({
      name: 'A',
      email: '  Owner@Firm.COM ',
      password: 'x'.repeat(10),
    });
    expect(parsed.email).toBe('owner@firm.com');
  });

  it('keeps percentages as decimal strings and caps them at 100', () => {
    expect(
      CreateOrgInput.parse({ name: 'Firm', defaultContingencyPct: 30 }).defaultContingencyPct,
    ).toBe('30');
    expect(CreateOrgInput.safeParse({ name: 'Firm', defaultContingencyPct: '100.5' }).success).toBe(
      false,
    );
    expect(CreateOrgInput.safeParse({ name: 'Firm', defaultContingencyPct: '-1' }).success).toBe(
      false,
    );
  });

  it('turns blank optional text into null', () => {
    expect(UpdateOrgSettingsInput.parse({ phone: '  ' }).phone).toBeNull();
  });
});
