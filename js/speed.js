/**
 * 答えるまでの速さ。
 * 問題が出てから話し始めるまでの時間を、音声で答えて正解した初回の回答だけ記録する。
 * マイクの準備にかかる時間は端末によって違い、本人の速さではないので除く。
 */
import { addDays } from './review.js';

/** これより長い時間は、考えていたのではなく手を止めていたとみなし、記録しない。 */
export const MAX_SPEED_MS = 20_000;
/** 平均を出す期間。 */
export const WINDOW_DAYS = 7;
/** ホーム画面に推移を出す期間。 */
export const TREND_DAYS = 14;

export function emptySpeed() {
  return { days: {}, questions: {} };
}

/**
 * 問題が出てから話し始めるまでの時間。
 * @param {object} timing
 * @param {number} timing.shownAt 問題を出した時刻
 * @param {number} timing.pressedAt マイクのボタンを押した時刻
 * @param {number} timing.speechAfterReadyMs マイクが音を拾い始めてから、話し始めるまでの時間
 * @returns {number|null} ミリ秒(10ミリ秒単位)。測れなかったときと、長すぎるときは null。
 */
export function answerTime({ shownAt, pressedAt, speechAfterReadyMs }) {
  if (![shownAt, pressedAt, speechAfterReadyMs].every(Number.isFinite)) return null;
  const ms = Math.max(pressedAt - shownAt, 0) + Math.max(speechAfterReadyMs, 0);
  return ms <= MAX_SPEED_MS ? Math.round(ms / 10) * 10 : null;
}

/**
 * 速さを記録する。
 * @returns {number|null} 同じ問題の前回の時間。初めてなら null。
 */
export function recordSpeed(progress, id, ms, today) {
  progress.speed ??= emptySpeed();
  const previous = progress.speed.questions[id] ?? null;
  progress.speed.questions[id] = ms;
  const day = progress.speed.days[today] ?? { totalMs: 0, count: 0 };
  progress.speed.days[today] = { totalMs: day.totalMs + ms, count: day.count + 1 };
  return previous;
}

function averageOf(days, firstDay, length) {
  let totalMs = 0;
  let count = 0;
  for (let index = 0; index < length; index += 1) {
    const day = days[addDays(firstDay, index)];
    if (!day) continue;
    totalMs += day.totalMs;
    count += day.count;
  }
  return count === 0 ? null : Math.round(totalMs / count);
}

/**
 * ホーム画面に出す速さのまとめ。
 * @returns {{ recent: number|null, previous: number|null, trend: { day: string, ms: number|null }[] }}
 *   recent は今日までの7日の平均、previous はその前の7日の平均。trend は今日までの14日の日ごとの平均(古い順)。
 */
export function speedSummary(speed, today) {
  const days = speed?.days ?? {};
  return {
    recent: averageOf(days, addDays(today, 1 - WINDOW_DAYS), WINDOW_DAYS),
    previous: averageOf(days, addDays(today, 1 - 2 * WINDOW_DAYS), WINDOW_DAYS),
    trend: Array.from({ length: TREND_DAYS }, (_, index) => {
      const day = addDays(today, index + 1 - TREND_DAYS);
      return { day, ms: averageOf(days, day, 1) };
    }),
  };
}

/** 秒にして小数第1位まで出す。 */
export function formatSeconds(ms) {
  return (ms / 1000).toFixed(1);
}

/** 前の7日と比べた変化。比べられなければ null。0.1秒に満たない差は「ほぼ同じ」とする。 */
export function speedChange(recent, previous) {
  if (recent === null || previous === null) return null;
  const tenths = Math.round((previous - recent) / 100);
  if (tenths === 0) return { direction: 'same', text: '前の7日とほぼ同じです。' };
  const seconds = (Math.abs(tenths) / 10).toFixed(1);
  return tenths > 0
    ? { direction: 'faster', text: `前の7日より${seconds}秒速くなりました。` }
    : { direction: 'slower', text: `前の7日より${seconds}秒遅くなりました。` };
}
