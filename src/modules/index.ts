import type { AnyModule } from '../core/modules/index.js';
import { linkCollector } from './link-collector/module.js';

/** Every Module compiled into the bot. Adding a Module = one file plus one line here. */
export const modules: readonly AnyModule[] = [linkCollector];
