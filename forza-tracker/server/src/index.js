import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import routes from './routes.js';
import './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '0.0.0.0';
const UPLOADS_DIR = resolve(__dirname, '..', 'uploads');
mkdirSync(UPLOADS_DIR, { recursive: true });

const app = Fastify({ logger: { level: 'info' }, bodyLimit: 20 * 1024 * 1024 });
await app.register(cookie, { secret: process.env.FORZA_COOKIE_SECRET || 'forza-tracker-dev-secret' });
await app.register(multipart, {
  limits: { fileSize: 15 * 1024 * 1024, files: 8 },
});
await app.register(staticPlugin, {
  root: UPLOADS_DIR,
  prefix: '/uploads/',
  decorateReply: false,
});
await app.register(routes, { uploadsDir: UPLOADS_DIR });

const clientDist = resolve(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  await app.register(staticPlugin, { root: clientDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

app.listen({ port: PORT, host: HOST }).then(() => {
  app.log.info(`forza-tracker listening on http://${HOST}:${PORT}`);
}).catch(err => {
  app.log.error(err);
  process.exit(1);
});
