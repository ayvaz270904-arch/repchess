# Rep Chess Education — project guide

Chess school CRM. Three static apps + Telegram bot. Owner is admin; Russian UI, Russian replies to user.

## Deploy & files
- Push to `main` → Cloudflare auto-deploys: `https://repchess.ayvaz-270904.workers.dev/{index,trainer,client}.html`
- `index.html` — CRM admin (reads Google Sheets via GAS proxy)
- `trainer.html` — trainer/admin cabinet (Firebase Firestore + same GAS proxy for student base). ~4600 lines, single file.
- `client.html` — Telegram Mini App client cabinet (talks to bot GAS)
- `gas/` — **local-only mirrors** of the two Apps Script projects (crm-proxy.gs, bot.gs) + `firestore.rules` copy + `backup/`. NEVER commit (contains bot token; repo is public).
- **gas/ has NO git safety net.** Before any scripted/bulk edit of `gas/*.gs`, `cp` it to `gas/backup/` first. Marker-to-marker slicing (`s[a:b]`) already destroyed 50KB of bot.gs once — always assert the cut is small and contains only the target before writing. Rescue paths if it happens again: the TextEdit window still holds the pre-edit text (`osascript -e 'tell application "TextEdit" to get text of document "bot.gs"'`), and the deployed GAS project has the last shipped version. User copies file content into script.google.com and redeploys: Deploy → Manage deployments → ✏️ → New version.
- Verify JS syntax after editing any html: `./check.sh` (no node on this Mac; parse-pass = OK, runtime errors like `console.error is not a function` are sandbox artifacts).

## Data flow & security
- Payments: Tilda → Table 1 → trigger → Table 2 (private) → CRM GAS `doGet` returns CSV (admin: all rows; trainer: only `assignedStudents`). Role check: idToken → accounts:lookup → uid; role read from Firestore `trainers/{uid}` **via ScriptApp.getOAuthToken()** (user-token REST path hit permanent quota 429 — do not go back to it).
- Firestore Security Rules are THE access boundary (not client-side isAdmin checks). Trainers cannot delete confirmed lessons (status done/cancelled/legacy-none) — rules + UI.
- Bot token lives only in GAS. Client data confidentiality is top priority; trainers must never get full student base access.

## Business rules (easy to break — see memory repchess-architecture)
- Paid = paymentid matches /tinkoff|sber|pay/i. Promo = `tinkoff:0`; certificates = `tinkoff:0-cert` + products `«Сертификат <код> — <Индив.|Групп.> <офлайн|онлайн>, N занятий»`.
- `identifyProduct()` is duplicated in index.html, trainer.html, gas/bot.gs — keep all three in sync.
- Balance: only status 'done' (or legacy no-status) burns lessons; FIFO against expired packs; 1 lesson=1mo, 4=3mo, 10=6mo validity.
- Cert promo codes: Firestore `certCodes/{code}` (REP-XXXX-XX, alphabet excludes 0O1ILX), redeemed by bot `action=redeemCert`.
- Group self-booking (bot `joinGroup`/`leaveGroup`): needs active group pack matching lesson format + total remaining > 0; cancel only before lesson day.
- Cabinet is open to EVERYONE (guest mode): unknown phone → link with empty email. Empty email must NEVER reach Firestore/sheet queries (matches technical rows) — every booking action guards `if (!link.email)`. Guest cert redemption mints `cert-<phone>@repchess.local`; doGet auto-upgrades guests via findClientByPhone every 10 min.

## Firestore quota discipline (Spark 50K reads/day; exhausted once — 2026-07-09)
- NEVER add unconditional `loadAdminData()/loadHomePage()/loadGroupLessons()` after user actions.
- Patch local caches instead: `_patchGroupCaches()`, `_homeIndivCache/_homeGrpCache`, `loadHomePage(true)` = render from cache (0 reads).
- `_enrichStudentsWithRemaining()` reads the whole lessons collection — guarded by 5-min memory + 10-min sessionStorage cache (`repchess_used_v1`); refresh button resets both.

## trainer.html structure (search by these anchors, don't trust line numbers)
- Tabs: Главная (home, actions only) / История (archive; trainer=view, admin=edit) / Групповые / График (per-slot format: `formats {0..6:{"16:00":"offline"|"online"}}`, no entry = both) / Финансы / Админ
- Key functions: `loadHomePage(fromCache)`, `lessonItemHTML`, `groupFeedItemHTML`, `histLessonItemHTML`, `openEditModal(id, viewMode)`, `openEditGroupModal(id, viewMode)`, `openAttendModal`, `submitAttendance`, `approveAttendance` (reads extras from form inputs `.extra-attend-inp` — admin edits them even after approve; re-matches vs full base, promotes found into studentEmails, syncs isExtraAttendee lessons: deleted rows → batch.delete, renamed → recreate), `generateCertCodes`, `submitAddStudent` (POST to GAS, no Content-Type header — avoids preflight), `_openModal/_closeModal` (scroll-lock, nested-safe), `getLessonFlags/getGroupFlags`.
- Modals are `.overlay` divs; delegated click handler near end of file (`data-edit-id`, `data-edit-group-id`).

## Working conventions (user's standing rules)
- ALWAYS give complete code for anything the user must paste elsewhere (GAS → edit `gas/*.gs` and tell user to copy the file; never partial snippets).
- ALWAYS ask when uncertain — user wants questions, not guesses.
- Edit html files directly, run `./check.sh`, commit with descriptive RU/EN message, push (auto-deploy). User verifies with Cmd+Shift+R.
- Keep responses in Russian.

## Дисциплина правок (введено 2026-08-27 после разбора накопившихся ошибок)

Эти пять правил появились не из общих соображений — каждое написано по конкретной ошибке, которая стоила владельцу времени или сломала работу клиенту. Соблюдать их, а не полагаться на аккуратность.

**1. Чинить КЛАСС ошибки, а не случай.** Нашёл баг — проверь, живёт ли он в остальных поверхностях: `index.html`, `trainer.html`, `client-app/`, `gas/bot.gs`, `gas/crm-proxy.gs`. В ответе приводить доказательство проверки («в index.html кэша нет вообще, пакеты собираются из CSV»), а не утверждение «там всё нормально».
*Откуда:* ловушку «JSON в кэше убивает Date» поймали в trainer.html, но не проверили bot.gs — она укусила повторно и клиентка не могла записаться при живом пакете. См. [[repchess-precrm-balances]].

**2. Не выбирать за владельца.** Всё, что касается конкретных людей, денег, боевых данных и текстов для клиентов — спрашивать, даже если вариант кажется очевидным. Диагностическая функция не должна сама решать, чей баланс читать.
*Откуда:* `perfProbe` дважды подряд выбрала человека для замера сама — сначала служебный аккаунт, потом случайного клиента.

**3. Один пункт плана за раз.** Если владелец вклинивает срочное — явно сказать «встаём на пункте X, вернёмся после», а не делать вид, что план идёт. Прыжки между задачами — главный усилитель остальных ошибок.

**4. Логику GAS проверять тестом ДО выдачи.** Запустить Apps Script локально нельзя, поэтому: синтаксис — `cp gas/bot.gs /tmp/chk.js && node --check /tmp/chk.js` (расширение `.gs` node не понимает), а логику — отдельным скриптом на выдуманных данных. Так поймали баг с датами в кэше, границы окна акции и согласованность фильтров занятий — три раза до пользователя, а не после.

**5. Проверять допущения о среде, а не догадываться.** Уже стоило кругов: `Logger.log` НЕ виден в «Выполнениях» для веб-приложения (нужен `console.log` → Cloud Logging; `Logger.log` работает только для запусков из редактора); `JSON.stringify` в кэше превращает Date в строку; CSS-селектор вида `.prof-ava img` цепляет и фото пользователя, не только заглушку.

Плюс к этому — уже действующее правило: перед любой скриптовой правкой `gas/*.gs` делать `cp` в `gas/backup/` (у папки нет git-подстраховки).
