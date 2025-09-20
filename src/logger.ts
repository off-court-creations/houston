import process from 'node:process';
import { c } from './lib/colors.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type Logger = {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  isVerbose: () => boolean;
  setLevel: (next: LogLevel) => void;
};

function resolveLevel(): LogLevel {
  const raw = process.env.STARDATE_LOG_LEVEL?.toLowerCase();
  if (raw && raw in LEVELS) {
    return raw as LogLevel;
  }
  if (process.env.DEBUG === '*' || process.env.DEBUG?.includes('stardate')) {
    return 'debug';
  }
  return 'info';
}

export function createLogger(): Logger {
  let level = resolveLevel();

  return {
    debug(message: string) {
      if (LEVELS[level] <= LEVELS.debug) {
        process.stderr.write(`${c.dim('[debug]')} ${message}\n`);
      }
    },
    info(message: string) {
      if (LEVELS[level] <= LEVELS.info) {
        process.stdout.write(`${message}\n`);
      }
    },
    warn(message: string) {
      if (LEVELS[level] <= LEVELS.warn) {
        process.stderr.write(`${c.warn('[warn]')} ${message}\n`);
      }
    },
    error(message: string) {
      process.stderr.write(`${c.error('[error]')} ${message}\n`);
    },
    isVerbose() {
      return LEVELS[level] <= LEVELS.debug;
    },
    setLevel(next: LogLevel) {
      level = next;
    },
  };
}
