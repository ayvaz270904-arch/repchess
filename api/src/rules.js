// Права доступа — перенос gas/firestore.rules в код API, правило в правило.
// Пока данные лежали в Firestore, именно эти правила не давали тренеру увидеть чужих
// учеников. Любое изменение здесь — изменение безопасности: сверять с firestore.rules
// и прогонять api/test/run.mjs.
//
// auth = { uid, role, isService }:
//   isService — бот и CRM-прокси по служебному ключу; как OAuth владельца скрипта
//   сейчас, правила они обходят.
//   role — из trainers/{uid}.role ('admin' | 'trainer' | …), uid — из токена входа.

export const COLLECTIONS = [
  'trainers', 'lessons', 'groupLessons', 'trainerSchedules', 'certCodes',
  'lessonFeedback', 'trainerRates', 'priceOverrides', 'settings',
]

const isAdmin = a => a.role === 'admin'
const signedIn = a => !!(a && (a.uid || a.isService))
const strOr = (v, d) => (v === undefined || v === null ? d : v)

// Чтение одного документа (get) или документа из выдачи запроса (list).
export function canRead(auth, coll, id, data, kind /* 'get' | 'list' */) {
  if (!signedIn(auth)) return false
  if (auth.isService) return true
  switch (coll) {
    case 'lessons':
    case 'groupLessons':
      return data.trainerId === auth.uid || isAdmin(auth)
    case 'trainers':
      // get — свой документ или админ; list — только админ (assignedStudents = почты учеников)
      return kind === 'list' ? isAdmin(auth) : (auth.uid === id || isAdmin(auth))
    case 'trainerRates':
    case 'trainerSchedules':
      return auth.uid === id || isAdmin(auth)
    case 'priceOverrides':
      return true
    case 'settings':
    case 'certCodes':
    case 'lessonFeedback':
      return isAdmin(auth)
    default:
      return false
  }
}

// Можно ли вообще выполнить запрос (как Firestore: запрос, который МОГ БЫ вернуть
// чужой документ, отклоняется целиком, а не фильтруется молча).
export function canQuery(auth, coll, where) {
  if (!signedIn(auth)) return false
  if (auth.isService || isAdmin(auth)) return COLLECTIONS.includes(coll)
  switch (coll) {
    case 'lessons':
    case 'groupLessons':
      // тренеру — только с фильтром trainerId == его uid
      return where.some(([f, op, v]) => f === 'trainerId' && op === '==' && v === auth.uid)
    case 'priceOverrides':
      return true
    default:
      return false   // trainers, trainerRates, trainerSchedules, settings, certCodes, lessonFeedback
  }
}

// Запись. op: 'create' | 'update' | 'delete'; before — документ до (null при create),
// after — документ после (null при delete).
export function canWrite(auth, coll, id, op, before, after) {
  if (!signedIn(auth)) return false
  // Промокоды не удаляет никто — ни админ, ни бот: только архив (правило владельца после
  // 20.10.2026, когда чистка «старше 14 дней» стёрла выданные коды). Строже, чем было в Firestore.
  if (coll === 'certCodes' && op === 'delete') return false
  if (auth.isService) return true
  const admin = isAdmin(auth)
  switch (coll) {
    case 'lessons':
      if (op === 'create') return after.trainerId === auth.uid || admin
      if (op === 'update') {
        if (admin) return true
        // свои занятия, без смены «чьё оно» и «чей ученик»
        return before.trainerId === auth.uid
          && after.trainerId === before.trainerId
          && strOr(after.studentEmail, '') === strOr(before.studentEmail, '')
      }
      // delete: админ — любые; тренер — только свои неподтверждённые
      return admin || (before.trainerId === auth.uid && ['pending', 'rescheduled'].includes(before.status))
    case 'groupLessons':
      if (op === 'create' || op === 'delete') return admin
      return before.trainerId === auth.uid || admin
    case 'trainers':
    case 'trainerRates':
    case 'priceOverrides':
    case 'settings':
    case 'certCodes':
      return admin
    case 'trainerSchedules':
      return auth.uid === id || admin
    case 'lessonFeedback':
      return false   // пишет только бот (служебный ключ)
    default:
      return false
  }
}
