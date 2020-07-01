import { buildLogger } from '@bct/b-logger';

import { start } from './index';

const logger = buildLogger('main');

start(() => {
  logger.info('server has started');
});
