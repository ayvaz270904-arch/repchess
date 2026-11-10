// Локальный запуск API без Cloudflare — для проверок на этом компьютере.
// Запуск: PGHOST=… PGDATABASE=… PGUSER=… PG_MODULE=<путь к pg> SERVICE_KEY=<любой> \
//         PGSCHEMA=staging PORT=8791 node api/test/serve.mjs
// Пароль базы pg берёт из ~/.pgpass. Слушает только 127.0.0.1.

import http from 'node:http'
import { createRequire } from 'node:module'
import { handle } from '../src/handler.js'

const require = createRequire(import.meta.url)
const { Pool } = require(process.env.PG_MODULE || 'pg')
for (const v of ['PGHOST', 'PGDATABASE', 'PGUSER', 'SERVICE_KEY']) if (!process.env[v]) throw new Error(`не задана переменная ${v}`)
const schema = /^[a-z_]+$/.test(process.env.PGSCHEMA || '') ? process.env.PGSCHEMA : 'staging'
const pool = new Pool({ ssl: { rejectUnauthorized: false }, options: `-c search_path=${schema}`, max: 4, application_name: 'repchess-api-local' })

const env = {
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || 'repchess-trainer',
  SERVICE_KEY: process.env.SERVICE_KEY,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'https://repchess.ayvaz-270904.workers.dev',
  AUTH_PROVIDERS: process.env.AUTH_PROVIDERS || 'firebase,service',
}
const deps = {
  withClient: async fn => { const c = await pool.connect(); try { return await fn(c) } finally { c.release() } },
  log: e => console.error('api error', e && e.stack || e),
}

const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const ch of req) chunks.push(ch)
  const body = Buffer.concat(chunks)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
  const request = new Request(`http://127.0.0.1${req.url}`, {
    method: req.method, headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !body.length ? undefined : body,
  })
  const out = await handle(request, env, deps)
  res.writeHead(out.status, Object.fromEntries(out.headers))
  res.end(Buffer.from(await out.arrayBuffer()))
})
const port = Number(process.env.PORT || 8791)
server.listen(port, '127.0.0.1', () => console.log(`repchess-api локально: http://127.0.0.1:${port} (схема ${schema})`))
