// Точка входа Cloudflare Worker «repchess-api». Вся логика — в handler.js.
//
// Настройки (wrangler.toml [vars]): PGSCHEMA, FIREBASE_PROJECT_ID, ALLOWED_ORIGINS, AUTH_PROVIDERS.
// Секреты (wrangler secret put — вводит владелец): DATABASE_URL (строка подключения
// postgresql://…), SERVICE_KEY. Адрес, логин и пароль базы в репозитории не хранятся:
// он публичный, а порт базы открыт в интернет.

import { Client } from 'pg'
import { handle } from './handler.js'

export default {
  async fetch(request, env, ctx) {
    const withClient = async fn => {
      const schema = /^[a-z_]+$/.test(env.PGSCHEMA || '') ? env.PGSCHEMA : 'staging'
      // sslmode из строки перебил бы ssl ниже и включил проверку сертификата, а он у сервера
      // базы самоподписанный — убираем параметр, шифрование остаётся.
      const url = new URL(env.DATABASE_URL)
      url.searchParams.delete('sslmode')
      const client = new Client({
        connectionString: url.toString(),
        ssl: { rejectUnauthorized: false },   // сертификат сервера базы самоподписанный
        options: `-c search_path=${schema}`,
        application_name: 'repchess-api',
        connectionTimeoutMillis: 8000,
        statement_timeout: 15000,
      })
      await client.connect()
      try { return await fn(client) }
      finally { ctx.waitUntil(client.end().catch(() => {})) }
    }
    return handle(request, env, { withClient, log: e => console.error('api error', e && e.stack || e) })
  },
}
