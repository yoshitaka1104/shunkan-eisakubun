/**
 * 連続学習日数。
 * 1問でも答えた日を学習した日として数える(記録は review.js が progress.days に残す)。
 * 今日まだ学習していなくても、昨日まで続いていれば、今日のうちは途切れていないものとして扱う。
 */
import { addDays } from './review.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function studied(days, day) {
  return (days[day] ?? 0) > 0;
}

/**
 * @param {Record<string, number>} days 'YYYY-MM-DD' ごとの回答数
 * @param {string} today
 * @returns {{current: number, best: number, studiedToday: boolean}}
 */
export function studyStreak(days, today) {
  const studiedToday = studied(days, today);
  let current = 0;
  for (let day = studiedToday ? today : addDays(today, -1); studied(days, day); day = addDays(day, -1)) current += 1;

  const studiedDays = Object.keys(days).filter((day) => studied(days, day)).sort();
  let best = 0;
  let run = 0;
  let previous = null;
  for (const day of studiedDays) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return { current, best: Math.max(best, current), studiedToday };
}

/** 今日までの直近 n 日。古い順。 */
export function recentDays(days, today, count = 7) {
  return Array.from({ length: count }, (_, index) => {
    const day = addDays(today, index - count + 1);
    const [year, month, date] = day.split('-').map(Number);
    return {
      day,
      weekday: WEEKDAYS[new Date(year, month - 1, date).getDay()],
      studied: studied(days, day),
      isToday: day === today,
    };
  });
}

/** 1日に答えた問題数の最大。 */
export function busiestDay(days) {
  return Math.max(0, ...Object.values(days));
}
