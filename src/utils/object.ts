export type PlainObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && value.constructor === Object;
}

export function deepSortObject<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepSortObject(item)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const sortedEntries = Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => [key, deepSortObject(value[key])]);
    return Object.fromEntries(sortedEntries) as T;
  }
  return value;
}
