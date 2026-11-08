/**
 * 実績バッジ。
 * 条件は、画面側が集計した数字(achievementStats)だけから判定する。
 * 一度獲得した実績は、条件を満たさなくなっても消さない。獲得した日を progress.achievements に残す。
 */

/**
 * kind はバッジの絵柄の種類。goal は獲得までの進み具合を返す。
 * once が true の実績は、1回の学習の結果で決まるので、進み具合を数字で出さない。
 */
export const ACHIEVEMENTS = [
  { id: 'first-correct', kind: 'start', name: 'はじめの一歩', description: '初めて正解する', goal: (s) => [s.correct, 1] },
  { id: 'answers-50', kind: 'answers', name: '50回答', description: '50問に答える', goal: (s) => [s.attempts, 50] },
  { id: 'answers-100', kind: 'answers', name: '100回答', description: '100問に答える', goal: (s) => [s.attempts, 100] },
  { id: 'answers-500', kind: 'answers', name: '500回答', description: '500問に答える', goal: (s) => [s.attempts, 500] },
  { id: 'answers-1000', kind: 'answers', name: '1000回答', description: '1000問に答える', goal: (s) => [s.attempts, 1000] },
  { id: 'streak-3', kind: 'streak', name: '3日連続', description: '3日続けて学習する', goal: (s) => [s.bestStreak, 3] },
  { id: 'streak-7', kind: 'streak', name: '7日連続', description: '7日続けて学習する', goal: (s) => [s.bestStreak, 7] },
  { id: 'streak-30', kind: 'streak', name: '30日連続', description: '30日続けて学習する', goal: (s) => [s.bestStreak, 30] },
  { id: 'streak-100', kind: 'streak', name: '100日連続', description: '100日続けて学習する', goal: (s) => [s.bestStreak, 100] },
  { id: 'mastered-1', kind: 'mastery', name: '初マスター', description: '1問をマスターする', goal: (s) => [s.mastered, 1] },
  { id: 'mastered-50', kind: 'mastery', name: '50問マスター', description: '50問をマスターする', goal: (s) => [s.mastered, 50] },
  { id: 'mastered-100', kind: 'mastery', name: '100問マスター', description: '100問をマスターする', goal: (s) => [s.mastered, 100] },
  { id: 'item-1', kind: 'complete', name: '項目完成', description: '1つの文法項目の3問をすべてマスターする', goal: (s) => [s.completeItems, 1] },
  { id: 'level-1', kind: 'complete', name: '小学校制覇', description: '小学校の17項目をすべて完成させる', goal: (s) => s.levels[1] ?? [0, 0] },
  { id: 'level-2', kind: 'complete', name: '中学校制覇', description: '中学校の64項目をすべて完成させる', goal: (s) => s.levels[2] ?? [0, 0] },
  { id: 'level-3', kind: 'complete', name: '高校制覇', description: '高校の24項目をすべて完成させる', goal: (s) => s.levels[3] ?? [0, 0] },
  { id: 'all-complete', kind: 'complete', name: '全制覇', description: '105項目をすべて完成させる', goal: (s) => [s.completeItems, s.totalItems] },
  { id: 'busy-day', kind: 'day', name: '集中の一日', description: '1日に30問答える', goal: (s) => [s.busiestDay, 30] },
  { id: 'no-miss', kind: 'perfect', name: 'ノーミス', description: '1回の学習で10問以上を全問正解する', once: true, goal: (s) => [s.perfectSession ? 1 : 0, 1] },
  { id: 'review-done', kind: 'review', name: '復習完了', description: '今日の復習をすべて終える', once: true, goal: (s) => [s.reviewFinished ? 1 : 0, 1] },
];

/** 獲得までの進み具合。current は target を超えない。 */
export function achievementProgress(achievement, stats) {
  const [current, target] = achievement.goal(stats);
  return { current: Math.min(current, target), target };
}

function reached(achievement, stats) {
  const { current, target } = achievementProgress(achievement, stats);
  return target > 0 && current >= target;
}

/**
 * 条件を満たした実績を記録し、今回新しく獲得したものを返す。
 * @param {object} progress progress.achievements に { id: 'YYYY-MM-DD' } を書く。
 * @param {object} stats achievementStats の結果
 * @param {string} today
 * @returns {object[]} 新しく獲得した実績
 */
export function unlockAchievements(progress, stats, today) {
  const unlocked = [];
  for (const achievement of ACHIEVEMENTS) {
    if (progress.achievements[achievement.id] || !reached(achievement, stats)) continue;
    progress.achievements[achievement.id] = today;
    unlocked.push(achievement);
  }
  return unlocked;
}

export function earnedCount(progress) {
  return ACHIEVEMENTS.filter(({ id }) => progress.achievements[id]).length;
}
