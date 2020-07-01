import config from 'config';
import { buildLogger } from '@bct/b-logger';
import { setupConnection, setupPublishing, shutdownConnection } from "@bct/simple-amqp-client";
import { connect } from '@bct/trading-zoo-node-models';

import PublishChannel from './publish';
import app from './express';

const logger = buildLogger('app');
const { host, port } = config.app;

const server = {};

async function setupDaemon() {
  await setupConnection(config.amqp);
}
server.start = async function serverStart(cb) {
  const connection = connect({ ...config.db, logger: { info: () => { } } });

  await setupDaemon();

  const publishToUserData = await setupPublishing('UpdateUserBalancesRequest');
  PublishChannel.setPublishChannel('UpdateUserBalancesRequest', publishToUserData);

  process.on('SIGTERM', () => {
    if (connection) connection.close();
    shutdownConnection();
  });

  app.listen(port, host, () => {
    logger.info(`Server is listening to ${host}:${port}`);
    cb(null, app);
  });
};

module.exports = server;
