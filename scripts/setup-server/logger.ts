import { logger } from '../../src/logger.js';

export const setupLogger = logger.child({ component: 'setup-server' });
