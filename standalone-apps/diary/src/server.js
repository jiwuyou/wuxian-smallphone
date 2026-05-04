'use strict';

const { createDiaryHttpServer } = require('./http-app');
const { defaultHost, resolvePort } = require('./paths');

async function main() {
  const port = resolvePort();
  const host = process.env.HOST || defaultHost;
  const server = createDiaryHttpServer();

  server.on('error', (error) => {
    console.error(`SmallPhone Diary failed to listen on ${host}:${port}: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    const address = server.address();
    const resolvedPort = typeof address === 'object' && address ? address.port : port;
    console.log(`SmallPhone Diary listening on http://${host}:${resolvedPort}`);
  });

  return server;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
};
