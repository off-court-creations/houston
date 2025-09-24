import process from 'node:process';

export function resolveActor(): string {
  const envActor = process.env.HOUSTON_ACTOR;
  if (envActor) {
    return envActor;
  }
  const user = process.env.USER ?? process.env.LOGNAME ?? 'cli';
  return `user:${user}`;
}

export function resolveTimestamp(): string {
  return new Date().toISOString();
}
