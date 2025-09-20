import process from 'node:process';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

type Logger = {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  isVerbose: () => boolean;
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
        process.stderr.write(`[debug] ${message}\n`);
      }
    },
    info(message: string) {
      if (LEVELS[level] <= LEVELS.info) {
        process.stdout.write(`${message}\n`);
      }
    },
    warn(message: string) {
      if (LEVELS[level] <= LEVELS.warn) {
        process.stderr.write(`[warn] ${message}\n`);
      }
    },
    error(message: string) {
      process.stderr.write(`[error] ${message}\n`);
    },
    isVerbose() {
      return LEVELS[level] <= LEVELS.debug;
    },
  };
}

export type { Logger };
