import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import serveStatic from '@fastify/static';
import { createApp } from './app';

if (existsSync('.env')) process.loadEnvFile('.env');
const app = await createApp();
if (existsSync('dist/index.html')) {
  await app.register(serveStatic, { root: resolve('dist') });
  app.setNotFoundHandler((request, reply) =>
    request.url.startsWith('/api/')
      ? reply.code(404).send({ message: 'Not found' })
      : reply.sendFile('index.html'),
  );
}
await app.listen({ port: Number(process.env.PORT || 3001), host: process.env.HOST || '127.0.0.1' });
console.log(`Nodic API: ${app.listeningOrigin}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit());
  });
