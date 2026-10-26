import { formatEnvErrors, parseEnv } from './core/env.js';
import { createLogger } from './core/logger.js';
import { SHUTDOWN_TIMEOUT_MS, start, type Botty } from './start.js';

const parsed = parseEnv(process.env);
if (!parsed.ok) {
  console.error(formatEnvErrors(parsed.errors));
  process.exit(1);
}
const env = parsed.env;
const logger = createLogger(env.LOG_LEVEL);

let botty: Botty;
try {
  botty = await start(env, logger);
} catch (err) {
  logger.fatal({ err }, 'startup failed');
  process.exit(1);
}

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  setTimeout(() => {
    logger.error('shutdown timed out; forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  botty.stop().then(
    () => {
      logger.info('shutdown complete');
      process.exit(0);
    },
    (err: unknown) => {
      logger.error({ err }, 'shutdown failed');
      process.exit(1);
    },
  );
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
