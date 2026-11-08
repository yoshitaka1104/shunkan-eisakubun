/**
 * 出題の選び方と学習記録の更新。
 * 保存方法には関与しない純粋関数だけを置く(保存は storage.js)。
 */

export const DEFAULT_TIME_LIMIT_SEC = 10;

export function emptyProgress() {
  return {
    settings: { timeLimitSec: DEFAULT_TIME_LIMIT_SEC },
    speechNoticeSeen: false,
    stats: {},
    customAnswers: {},
    /** 最後に記録を書き出した日時(ISO 形式)。 */
    lastBackupAt: null,
    /** 問題ごとの習熟度の段階と、次の復習の予定日(review.js)。 */
    review: {},
    /** 学習した日ごとの回答数。キーは 'YYYY-MM-DD'。 */
    days: {},
    /** 獲得した実績と、獲得した日(achievements.js)。 */
    achievements: {},
  };
}

function shuffled(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 出題する問題を選ぶ。
 *
 * @param {object[]} questions
 * @param {object} filter
 * @param {number|'all'} [filter.level]
 * @param {number|'all'} [filter.count]
 * @param {string[]} [filter.ids] 指定すると、この問題だけを出す。
 * @param {() => number} [random]
 */
export function pickQuestions(questions, { level = 'all', count = 'all', ids }, random = Math.random) {
  const pool = questions.filter((question) => {
    if (ids) return ids.includes(question.id);
    return level === 'all' || question.level === level;
  });
  const ordered = shuffled(pool, random);
  return count === 'all' ? ordered : ordered.slice(0, count);
}

/** 問題に用意された正解例と、利用者が追加した正解例をまとめて返す。 */
export function answersFor(question, progress) {
  return [...question.answers, ...(progress.customAnswers[question.id] ?? [])];
}

/** 問題ごとの初回の結果を記録する。再挑戦の結果は記録しない。 */
export function recordResult(progress, questionId, result, now = Date.now()) {
  const stat = progress.stats[questionId] ?? { attempts: 0, correct: 0, close: 0, wrong: 0 };
  stat.attempts += 1;
  stat[result] += 1;
  stat.last = result;
  stat.lastAt = now;
  progress.stats[questionId] = stat;
}

/** 「正解にする」を押した問題の直近の結果を正解へ付け替える。 */
export function reclassifyAsCorrect(progress, questionId, previousResult) {
  const stat = progress.stats[questionId];
  if (!stat || previousResult === 'correct') return;
  stat[previousResult] -= 1;
  stat.correct += 1;
  stat.last = 'correct';
}

/** 回答を正解例へ追加する。同じ英文は重ねて追加しない。 */
export function addCustomAnswer(progress, questionId, text) {
  const answers = progress.customAnswers[questionId] ?? [];
  if (!answers.includes(text)) answers.push(text);
  progress.customAnswers[questionId] = answers;
}

/** 直近の結果が正解ではない問題を、苦手な問題として返す。 */
export function weakQuestionIds(progress) {
  return Object.entries(progress.stats)
    .filter(([, stat]) => stat.last !== 'correct')
    .map(([id]) => id);
}

/**
 * 全期間の回答数と正解率を求める。
 * knownIds を渡すと、その問題だけを数える。問題を入れ替えた後も古い記録は消さないため、ここで除く。
 */
export function totals(progress, knownIds = null) {
  const stats = Object.entries(progress.stats)
    .filter(([id]) => !knownIds || knownIds.has(id))
    .map(([, stat]) => stat);
  const attempts = stats.reduce((sum, stat) => sum + stat.attempts, 0);
  const correct = stats.reduce((sum, stat) => sum + stat.correct, 0);
  return { attempts, correct, rate: attempts === 0 ? 0 : Math.round((correct / attempts) * 100) };
}
