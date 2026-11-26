import { describe, expect, it } from 'vitest';
import {
  CONTRACT_PLACEHOLDERS,
  DEFAULT_CONTRACT,
  renderContract,
  unknownContractPlaceholders,
} from './index.js';

describe('engagement contract', () => {
  it('ships a default that uses only known placeholders', () => {
    expect(unknownContractPlaceholders(DEFAULT_CONTRACT.body)).toEqual([]);
    const blocks = renderContract(DEFAULT_CONTRACT.body, CONTRACT_PLACEHOLDERS);
    expect(blocks.filter((b) => b.type === 'properties')).toHaveLength(1);
    expect(blocks.some((b) => b.type === 'text' && b.text.includes('{{'))).toBe(false);
  });
  it('fills values and finds typos', () => {
    expect(unknownContractPlaceholders('{{clent.name}} {{date}} {{clent.name}}')).toEqual([
      'clent.name',
    ]);
    expect(
      renderContract('Hi {{client.displayName}} {{nope}}\n\n\n{{ properties.table }}', {
        'client.displayName': 'Jo',
      }),
    ).toEqual([{ type: 'text', text: 'Hi Jo' }, { type: 'properties' }]);
  });
});
