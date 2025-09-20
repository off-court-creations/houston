import { isPlainObject } from '../utils/object.js';

export function ensureSignature<T extends Record<string, unknown>>(data: T, generator: string): T {
  if (!isPlainObject(data)) {
    throw new Error('Cannot sign non-object payloads');
  }
  (data as Record<string, unknown>).generated_by = generator;
  return data;
}

export function hasValidSignature(value: unknown, expectedPrefix = 'stardate@'): value is { generated_by: string } {
  if (!isPlainObject(value)) {
    return false;
  }
  const signature = value.generated_by;
  return typeof signature === 'string' && signature.startsWith(expectedPrefix);
}
