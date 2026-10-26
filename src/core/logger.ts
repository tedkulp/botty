import { pino, type Logger, type LevelWithSilent } from 'pino';

export type { Logger };

/** JSON logs to stdout. This is the ops log; it never reaches the dashboard. */
export function createLogger(level: LevelWithSilent = 'info'): Logger {
  return pino({ level });
}
