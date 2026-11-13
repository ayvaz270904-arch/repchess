-- Rep Chess Education — схема Postgres для переноса с Firestore (этап 1 плана).
--
-- Принцип: одна таблица на коллекцию Firestore. id документа Firestore — первичный ключ,
-- поэтому ссылки между записями (занятие → группа, отзыв → занятие) не ломаются.
-- Весь документ лежит в doc (jsonb) как есть: при переносе не теряется ни одно поле,
-- даже редкое. Поля, по которым ищут и фильтруют, вычисляются из doc в отдельные
-- колонки (GENERATED ... STORED) с индексами: писать нужно только doc.
-- Отметки времени Firestore (Timestamp) хранятся в doc как {"__ts": "<ISO 8601, UTC>"} — тип
-- сохраняется: тренерка зовёт у них .toDate(), бот читает timestampValue. Даты занятий (_date)
-- — строкой 'гггг-мм-дд' по Москве, как сейчас: сервер базы живёт по Europe/Amsterdam,
-- и тип date со сдвигом пояса дал бы ошибку на день у вечерних записей.
--
-- Запуск повторяемый: CREATE ... IF NOT EXISTS. Схема (namespace) задаётся снаружи
-- через search_path — сначала staging для проверки, потом рабочая.

CREATE TABLE IF NOT EXISTS schema_meta (
  key   text PRIMARY KEY,
  value text NOT NULL,
  at    timestamptz NOT NULL DEFAULT now()
);

-- Тренеры и админ. id = uid Firebase Auth (вход остаётся в Firebase).
CREATE TABLE IF NOT EXISTS trainers (
  id         text PRIMARY KEY,
  doc        jsonb NOT NULL,
  email      text GENERATED ALWAYS AS (lower(doc->>'email')) STORED,
  role       text GENERATED ALWAYS AS (doc->>'role') STORED,
  name       text GENERATED ALWAYS AS (doc->>'name') STORED,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trainers_email_idx ON trainers (email);

-- Занятия (индивидуальные и записи участников групп). Баланс считается по ним.
CREATE TABLE IF NOT EXISTS lessons (
  id              text PRIMARY KEY,
  doc             jsonb NOT NULL,
  student_email   text GENERATED ALWAYS AS (lower(btrim(doc->>'studentEmail'))) STORED,
  lesson_date     text GENERATED ALWAYS AS (doc->>'_date') STORED,
  trainer_id      text GENERATED ALWAYS AS (doc->>'trainerId') STORED,
  group_lesson_id text GENERATED ALWAYS AS (doc->>'groupLessonId') STORED,
  status          text GENERATED ALWAYS AS (doc->>'status') STORED,
  lesson_type     text GENERATED ALWAYS AS (doc->>'type') STORED,
  lesson_format   text GENERATED ALWAYS AS (doc->>'format') STORED,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lessons_student_idx ON lessons (student_email);
CREATE INDEX IF NOT EXISTS lessons_date_idx    ON lessons (lesson_date);
CREATE INDEX IF NOT EXISTS lessons_trainer_idx ON lessons (trainer_id);
CREATE INDEX IF NOT EXISTS lessons_group_idx   ON lessons (group_lesson_id);
CREATE INDEX IF NOT EXISTS lessons_status_idx  ON lessons (status);

-- Групповые занятия (карточка группы: состав, гости, ссылки онлайн, запись).
CREATE TABLE IF NOT EXISTS group_lessons (
  id                text PRIMARY KEY,
  doc               jsonb NOT NULL,
  lesson_date       text    GENERATED ALWAYS AS (doc->>'_date') STORED,
  trainer_id        text    GENERATED ALWAYS AS (doc->>'trainerId') STORED,
  is_public         boolean GENERATED ALWAYS AS ((doc->>'isPublic')::boolean) STORED,
  attendance_marked boolean GENERATED ALWAYS AS ((doc->>'attendanceMarked')::boolean) STORED,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS group_lessons_date_idx    ON group_lessons (lesson_date);
CREATE INDEX IF NOT EXISTS group_lessons_trainer_idx ON group_lessons (trainer_id);
CREATE INDEX IF NOT EXISTS group_lessons_public_idx  ON group_lessons (is_public) WHERE is_public;
-- Поиск групп, где есть ученик: doc->'studentEmails' ? 'почта'
CREATE INDEX IF NOT EXISTS group_lessons_students_gin ON group_lessons USING gin ((doc->'studentEmails'));

-- Расписание тренера (шаблон недели, форматы слотов, исключения). id = uid тренера.
CREATE TABLE IF NOT EXISTS trainer_schedules (
  id         text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Промокоды/сертификаты REP-XXXX-XX. НИКОГДА не удалять — только архив (правило владельца).
CREATE TABLE IF NOT EXISTS cert_codes (
  id         text PRIMARY KEY,
  doc        jsonb NOT NULL,
  used_by    text    GENERATED ALWAYS AS (nullif(doc->>'usedBy', '')) STORED,
  archived   boolean GENERATED ALWAYS AS (coalesce((doc->>'archived')::boolean, false)) STORED,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cert_codes_used_by_idx ON cert_codes (used_by);

-- Отзывы о занятиях (запрос, оценка, текст). id = id занятия или группы+ученика.
CREATE TABLE IF NOT EXISTS lesson_feedback (
  id            text PRIMARY KEY,
  doc           jsonb NOT NULL,
  status        text GENERATED ALWAYS AS (doc->>'status') STORED,
  student_email text GENERATED ALWAYS AS (lower(btrim(doc->>'studentEmail'))) STORED,
  lesson_date   text GENERATED ALWAYS AS (doc->>'_date') STORED,
  lesson_id     text GENERATED ALWAYS AS (doc->>'lessonId') STORED,
  trainer_id    text GENERATED ALWAYS AS (doc->>'trainerId') STORED,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lesson_feedback_status_idx ON lesson_feedback (status);
CREATE INDEX IF NOT EXISTS lesson_feedback_date_idx   ON lesson_feedback (lesson_date);

-- Ставки тренеров с историей по датам. id = uid тренера.
CREATE TABLE IF NOT EXISTS trainer_rates (
  id         text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ручные цены (сейчас пусто, коллекция в коде используется).
CREATE TABLE IF NOT EXISTS price_overrides (
  id         text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Настройки: financePin (хэш), removedTrainers (копии удалённых тренеров) и т.п.
CREATE TABLE IF NOT EXISTS settings (
  id         text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Оплаты (с 11.11.2026): копия первого листа Table 2 («ГЛАВНАЯ»), все колонки ──
-- Источник остаётся в Google-таблице: Тильда пишет туда через Таблицу 1, правки руками —
-- тоже там. Копию целиком присылает только CRM-прокси (POST /v1/payments/sync → функция
-- payments_sync ниже): раз в минуту его зовёт расписание API, после своих записей
-- (ученик, ручной баланс) он шлёт копию сам, бот после своих записей просит его о том же.
-- Читают копию тренерка и CRM (CSV как у прокси) и бот (строки одного человека).
CREATE TABLE IF NOT EXISTS payments (
  row_num int   PRIMARY KEY,           -- номер строки листа (шапка — строка 1)
  cells   jsonb NOT NULL,              -- значения всех колонок по порядку payments_meta.columns; дата — {"d": "<ISO>"}
  line    text  NOT NULL,              -- эта же строка в CSV — ровно как её отдавал прокси
  email   text  NOT NULL DEFAULT '',   -- Email без кавычек Тильды и пробелов, строчными (как cleanVal в боте)
  phone10 text  NOT NULL DEFAULT ''    -- последние 10 цифр Phone; '' если цифр меньше 10 (normPhone в боте)
);
CREATE INDEX IF NOT EXISTS payments_email_idx ON payments (email);
CREATE INDEX IF NOT EXISTS payments_phone_idx ON payments (phone10);

CREATE TABLE IF NOT EXISTS payments_meta (
  id         int PRIMARY KEY CHECK (id = 1),
  columns    jsonb       NOT NULL,     -- шапка листа как есть
  header     text        NOT NULL,     -- шапка в CSV
  rows       int         NOT NULL,     -- строк данных (без шапки)
  digest     text        NOT NULL,     -- отпечаток копии (считает прокси): совпал — лист не менялся
  read_at    timestamptz NOT NULL,     -- когда прокси начал читать лист для этой копии
  synced_at  timestamptz NOT NULL,     -- когда копия последний раз менялась
  checked_at timestamptz NOT NULL,     -- когда последний раз подтверждено, что копия = лист
  source     text        NOT NULL      -- кто прислал: cron, crm, bot:…, setup
);

-- Замена копии одной транзакцией. Вся разборка JSON — здесь, а не в Worker: у бесплатного
-- Cloudflare 10 мс процессора на запрос, а копия весит сотни килобайт.
-- Отказ (ошибка 22023) — неполная шапка, неверный формат строк, резкое уменьшение числа
-- строк (похоже на сбой чтения; нарочное удаление пропускает allow_shrink).
-- search_path берётся из момента создания: схема (prod, staging, тесты) — та, в которой создана.
CREATE OR REPLACE FUNCTION payments_sync(body jsonb, allow_shrink boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  cols jsonb := body->'columns';
  rws  jsonb := body->'rows';
  dig  text  := body->>'digest';
  hdr  text  := body->>'header';
  src  text  := left(coalesce(body->>'source', ''), 40);
  rd   timestamptz;
  n    int;
  bad  int;
  miss text;
  m    record;
BEGIN
  IF jsonb_typeof(cols) IS DISTINCT FROM 'array' OR jsonb_typeof(rws) IS DISTINCT FROM 'array'
     OR jsonb_typeof(body->'header') IS DISTINCT FROM 'string' OR coalesce(dig, '') = '' THEN
    RAISE EXCEPTION 'нужны columns, header, rows и digest' USING ERRCODE = '22023';
  END IF;
  BEGIN
    rd := (body->>'readAt')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'readAt — не дата' USING ERRCODE = '22023';
  END;
  IF rd IS NULL THEN RAISE EXCEPTION 'нет readAt' USING ERRCODE = '22023'; END IF;

  SELECT string_agg(x, ', ') INTO miss
    FROM unnest(ARRAY['Name', 'Email', 'Phone', 'products', 'price', 'paymentid', 'sent']) AS x
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(cols) AS c WHERE btrim(c, E' \t\r\n') = x);
  IF miss IS NOT NULL THEN
    RAISE EXCEPTION 'в шапке листа нет колонок: %', miss USING ERRCODE = '22023';
  END IF;

  n := jsonb_array_length(rws);
  SELECT count(*) INTO bad FROM jsonb_array_elements(rws) AS x
   WHERE jsonb_typeof(x->'r') IS DISTINCT FROM 'number' OR jsonb_typeof(x->'c') IS DISTINCT FROM 'array'
      OR jsonb_typeof(x->'l') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'e') IS DISTINCT FROM 'string'
      OR jsonb_typeof(x->'p') IS DISTINCT FROM 'string' OR (x->>'r')::numeric < 2;
  IF bad > 0 THEN
    RAISE EXCEPTION 'строк в неверном формате: %', bad USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('repchess.payments_sync'));   -- по одной замене за раз
  SELECT * INTO m FROM payments_meta WHERE id = 1;
  IF FOUND THEN
    IF rd < m.read_at THEN   -- копия, прочитанная раньше уже записанной, — старее её
      RETURN jsonb_build_object('changed', false, 'skipped', 'older', 'rows', m.rows, 'digest', m.digest);
    END IF;
    IF dig = m.digest THEN   -- лист не менялся: только отмечаем проверку
      UPDATE payments_meta SET read_at = rd, checked_at = now() WHERE id = 1;
      RETURN jsonb_build_object('changed', false, 'rows', m.rows, 'digest', m.digest);
    END IF;
    IF NOT allow_shrink AND n < m.rows - 20 AND n < m.rows * 0.9 THEN
      RAISE EXCEPTION 'строк стало % вместо % — похоже на сбой чтения листа; если удаляли нарочно, запусти в прокси payForceSync', n, m.rows
        USING ERRCODE = '22023';
    END IF;
  END IF;

  DELETE FROM payments;
  INSERT INTO payments (row_num, cells, line, email, phone10)
  SELECT (x->>'r')::int, x->'c', x->>'l', x->>'e', x->>'p' FROM jsonb_array_elements(rws) AS x;
  INSERT INTO payments_meta (id, columns, header, rows, digest, read_at, synced_at, checked_at, source)
  VALUES (1, cols, hdr, n, dig, rd, now(), now(), src)
  ON CONFLICT (id) DO UPDATE SET columns = excluded.columns, header = excluded.header, rows = excluded.rows,
    digest = excluded.digest, read_at = excluded.read_at, synced_at = now(), checked_at = now(), source = excluded.source;
  RETURN jsonb_build_object('changed', true, 'rows', n, 'digest', dig);
END $$;

-- События бота и кабинета клиента (с 13.11.2026, схема 3): журнал действий человека,
-- сводка по дням и сигнал о резком падении. Пишет только бот (api/src/events.js).
CREATE TABLE IF NOT EXISTS events (
  id     bigserial   PRIMARY KEY,
  ts     timestamptz NOT NULL,              -- время самого события (кабинет шлёт пачками)
  src    text        NOT NULL,              -- 'app' — кабинет, 'bot' — бот
  tg_id  text        NOT NULL DEFAULT '',   -- Telegram id человека
  email  text        NOT NULL DEFAULT '',   -- почта из привязки на момент события ('' у гостя)
  event  text        NOT NULL,              -- open, tab, start, error, …
  detail text        NOT NULL DEFAULT '',   -- раздел, метка ссылки, текст ошибки
  ver    text        NOT NULL DEFAULT ''    -- версия кабинета или бота
);
CREATE INDEX IF NOT EXISTS events_ts_idx    ON events (ts);
CREATE INDEX IF NOT EXISTS events_tg_idx    ON events (tg_id, ts) WHERE tg_id <> '';
CREATE INDEX IF NOT EXISTS events_email_idx ON events (email, ts) WHERE email <> '';

INSERT INTO schema_meta (key, value) VALUES ('schema_version', '3')
ON CONFLICT (key) DO UPDATE SET value = excluded.value, at = now();
