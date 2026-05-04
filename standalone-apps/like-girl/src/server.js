'use strict';

const { createLikeGirlHttpServer } = require('./http-app');
const { defaultHost, resolvePort } = require('./paths');

async function main() {
  const port = resolvePort();
  const host = process.env.HOST || defaultHost;
  const server = createLikeGirlHttpServer();
  server.on('error', (error) => {
    console.error(`LikeGirl failed to listen on ${host}:${port}: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`LikeGirl listening on http://${host}:${port}`);
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
