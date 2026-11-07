/**
 * 習熟度と今日の復習。
 *
 * 問題ごとに段階を持たせ、復習の予定日に正解するたびに次の復習までの間隔を延ばす(間隔をあけた繰り返し)。
 * 段階3でマスターとし、間違えたら段階0に戻す。予定日より前に正解しても段階は上げない。
 * 数えるのは各問の初回の回答だけで、答えを見た直後の再挑戦は数えない(呼び出す側で選ぶ)。
 * 日付は端末の時刻で 'YYYY-MM-DD' の文字列として扱い、0時で日を切り替える。
 */

export const MASTERED_STAGE = 3;
export const MAX_STAGE = 5;
/** 正解して上がった段階ごとの、次の復習までの日数。添え字が上がった後の段階。 */
const INTERVAL_DAYS = [1, 1, 3, 7, 14, 30];
/** 間違えたときの、次の復習までの日数。 */
const RETRY_DAYS = 1;

export const MASTERY_LABELS = {
  new: '未挑戦',
  learning: '練習中',
  growing: '覚えかけ',
  mastered: 'マスター',
};

function pad(value) {
  return String(value).padStart(2, '0');
}

/** 端末の時刻での日付を 'YYYY-MM-DD' で返す。 */
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 'YYYY-MM-DD' の日付に日数を足す。 */
export function addDays(day, days) {
  const [year, month, date] = day.split('-').map(Number);
  return localDate(new Date(year, month - 1, date + days));
}

/** 2つの日付の差を日数で返す(later − earlier)。 */
export function daysBetween(earlier, later) {
  const toTime = (day) => {
    const [year, month, date] = day.split('-').map(Number);
    return Date.UTC(year, month - 1, date);
  };
  return Math.round((toTime(later) - toTime(earlier)) / 86_400_000);
}

/** 復習の予定日が来ているか。まだ答えたことのない問題も、段階を上げてよい。 */
export function isDue(entry, today) {
  return !entry || !entry.due || entry.due <= today;
}

export function masteryState(entry) {
  if (!entry) return 'new';
  if (entry.stage >= MASTERED_STAGE) return 'mastered';
  if (entry.stage >= 1) return 'growing';
  return 'learning';
}

/**
 * 各問の初回の回答を、習熟度と学習した日に記録する。
 *
 * @param {object} progress
 * @param {string} id
 * @param {'correct'|'close'|'wrong'} result
 * @param {string} today 'YYYY-MM-DD'
 * @param {{countDay?: boolean}} [options] countDay が false なら、学習した日の回答数を増やさない。
 * @returns {{before: object|undefined, after: object, mastered: boolean}}
 *   before は記録前の状態(「正解にする」で付け替えるときに使う)。mastered は今回マスターになったとき true。
 */
export function recordReview(progress, id, result, today, { countDay = true } = {}) {
  const before = progress.review[id];
  let after;
  if (result !== 'correct') {
    after = { stage: 0, due: addDays(today, RETRY_DAYS) };
  } else if (isDue(before, today)) {
    const stage = Math.min((before?.stage ?? 0) + 1, MAX_STAGE);
    after = { stage, due: addDays(today, INTERVAL_DAYS[stage]) };
  } else {
    after = { ...before };
  }
  progress.review[id] = after;
  if (countDay) progress.days[today] = (progress.days[today] ?? 0) + 1;
  const wasMastered = (before?.stage ?? 0) >= MASTERED_STAGE;
  return { before, after, mastered: !wasMastered && after.stage >= MASTERED_STAGE };
}

/** 「正解にする」を押した問題を、記録前の状態から正解として記録し直す。学習した日の回答数は変えない。 */
export function recordAsCorrectInstead(progress, id, before, today) {
  if (before) progress.review[id] = before;
  else delete progress.review[id];
  return recordReview(progress, id, 'correct', today, { countDay: false });
}

function knownEntries(progress, knownIds) {
  return Object.entries(progress.review).filter(([id]) => !knownIds || knownIds.has(id));
}

/** 今日までに復習の予定日が来た問題。 */
export function dueQuestionIds(progress, today, knownIds = null) {
  return knownEntries(progress, knownIds)
    .filter(([, entry]) => entry.due && entry.due <= today)
    .map(([id]) => id);
}

/** 明日以降で、いちばん近い復習の予定日とその問題数。なければ null。 */
export function nextReview(progress, today, knownIds = null) {
  const upcoming = knownEntries(progress, knownIds)
    .map(([, entry]) => entry.due)
    .filter((due) => due && due > today)
    .sort();
  if (upcoming.length === 0) return null;
  return { day: upcoming[0], count: upcoming.filter((due) => due === upcoming[0]).length };
}

/**
 * 文法マップ。レベルごとに文法項目を並べ、各問の習熟度を添える。
 * @returns {{level: number, items: {pattern: string, questions: {id: string, state: string}[], complete: boolean}[]}[]}
 */
export function grammarMap(questions, progress) {
  const levels = new Map();
  for (const question of questions) {
    if (!levels.has(question.level)) levels.set(question.level, new Map());
    const items = levels.get(question.level);
    if (!items.has(question.pattern)) items.set(question.pattern, []);
    items.get(question.pattern).push({ id: question.id, state: masteryState(progress.review[question.id]) });
  }
  return [...levels]
    .sort(([a], [b]) => a - b)
    .map(([level, items]) => ({
      level,
      items: [...items].map(([pattern, entries]) => ({
        pattern,
        questions: entries,
        complete: entries.every(({ state }) => state === 'mastered'),
      })),
    }));
}

/** マスターした問題数と、3問ともマスターした文法項目の数。 */
export function masterySummary(questions, progress) {
  const map = grammarMap(questions, progress);
  const items = map.flatMap((level) => level.items);
  return {
    mastered: items.reduce((sum, item) => sum + item.questions.filter(({ state }) => state === 'mastered').length, 0),
    total: questions.length,
    completeItems: items.filter((item) => item.complete).length,
    totalItems: items.length,
  };
}
