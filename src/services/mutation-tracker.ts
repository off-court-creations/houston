export type ChangeType =
  | 'tickets'
  | 'backlog'
  | 'sprints'
  | 'repos'
  | 'routing'
  | 'people'
  | 'components'
  | 'labels'
  | 'schema'
  | 'transitions';

let recorded = new Set<ChangeType>();

export function recordChange(type: ChangeType): void {
  recorded.add(type);
}

export function getChangeTypes(): ChangeType[] {
  return Array.from(recorded.values()).sort();
}

export function clearChangeTypes(): void {
  recorded.clear();
}

