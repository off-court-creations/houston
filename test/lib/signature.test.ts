import { describe, expect, it } from 'vitest';
import { ensureSignature, hasValidSignature } from '../../src/lib/signature.js';

describe('signature helpers', () => {
  it('adds generated_by field', () => {
    const payload = ensureSignature({ foo: 'bar' }, 'stardate@0.1.0');
    expect(payload.generated_by).toBe('stardate@0.1.0');
  });

  it('verifies signature prefix', () => {
    expect(hasValidSignature({ generated_by: 'stardate@0.1.0' })).toBe(true);
    expect(hasValidSignature({ generated_by: 'someone-else' })).toBe(false);
  });
});
