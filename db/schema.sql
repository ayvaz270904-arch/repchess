-- Rep Chess Education — схема Postgres для переноса с Firestore (этап 1 плана).
--
-- Принцип: одна таблица на коллекцию Firestore. id документа Firestore — первичный ключ,
-- поэтому ссылки между записями (занятие → группа, отзыв → занятие) не ломаются.
-- Весь документ лежит в doc (jsonb) как есть: при переносе не теряется ни одно поле,
-- даже редкое. Поля, по которым ищут и фильтруют, вычисляются из doc в отдельные
-- колонки (GENERATED ... STORED) с индексами: писать нужно только doc.
-- Отметки времени Firestore хранятся в doc строкой ISO 8601 (UTC). Даты занятий (_date)
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

INSERT INTO schema_meta (key, value) VALUES ('schema_version', '1')
ON CONFLICT (key) DO UPDATE SET value = excluded.value, at = now();
