// Точка входа Cloudflare Worker «repchess-api». Вся логика — в handler.js.
//
// Настройки (wrangler.toml [vars]): PGSCHEMA, FIREBASE_PROJECT_ID, ALLOWED_ORIGINS, AUTH_PROVIDERS.
// Секреты (wrangler secret put — вводит владелец): DATABASE_URL (строка подключения
// postgresql://…), SERVICE_KEY. Адрес, логин и пароль базы в репозитории не хранятся:
// он публичный, а порт базы открыт в интернет.
//
// Подключение к базе — два пути:
//  1) через Hyperdrive (привязка HYPERDRIVE в wrangler.toml) — основной. Hyperdrive держит
//     пул соединений рядом с базой и сам проверяет её сертификат (sslmode verify-ca
//     с загруженным сертификатом центра). Кэш запросов у него должен быть выключен
//     (--caching-disabled), иначе чтение после записи вернёт старые данные.
//  2) напрямую по DATABASE_URL — запасной. Сокеты Workers всегда проверяют сертификат,
//     поэтому этот путь работает, только если у сервера базы сертификат от публичного центра
//     и подключение идёт по имени, на которое он выписан.
//
// Расписание (wrangler.toml [triggers] crons, раз в минуту): просит CRM-прокси сверить лист
// оплат Table 2 с копией в базе (payments.js → paymentsCron). Адрес прокси — PAYMENTS_PROXY_URL.

import { Client } from 'pg'
import { handle } from './handler.js'
import { setSchema } from './store.js'
import { paymentsCron } from './payments.js'

function makeDeps(env, ctx) {
  setSchema(/^[a-z_]+$/.test(env.PGSCHEMA || '') ? env.PGSCHEMA : 'staging')
  const withClient = async fn => {
    let client
    if (env.HYPERDRIVE) {
      client = new Client({ connectionString: env.HYPERDRIVE.connectionString })
    } else {
      const url = new URL(env.DATABASE_URL)
      url.searchParams.delete('sslmode')   // иначе pg перебьёт настройку ssl ниже
      client = new Client({
        connectionString: url.toString(),
        ssl: true,
        application_name: 'repchess-api',
        connectionTimeoutMillis: 8000,
        statement_timeout: 15000,
      })
    }
    await client.connect()
    try { return await fn(client) }
    finally { ctx.waitUntil(client.end().catch(() => {})) }
  }
  return { withClient, log: e => console.error('api error', e && e.stack || e) }
}

export default {
  async fetch(request, env, ctx) {
    return handle(request, env, makeDeps(env, ctx))
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(paymentsCron(env, makeDeps(env, ctx))
      .then(r => { if (r && (r.changed || r.skipped)) console.log('payments cron', JSON.stringify(r)) })
      .catch(e => console.error('payments cron', e && e.message || e)))
  },
}
