/**
 * 連続正解。1回の学習の中で、初回の回答で続けて正解した問題の数を数える。
 *
 * 再挑戦で正解しても、続きにはしない。「この回答を正解にする」で正解にした問題は、正解として数える。
 * 結果は出題順に並べた、各問の初回の結果('correct'、'close'、'wrong'、まだなら undefined)で受け取る。
 */

/** 区切りの数。ここに届いたときだけ、大きく祝う。 */
export function isComboMilestone(count) {
  return count === 3 || count === 5 || (count >= 10 && count % 5 === 0);
}

/** index 番目の問題までで、続けて正解している数。 */
export function comboAt(results, index) {
  let count = 0;
  for (let position = index; position >= 0 && results[position] === 'correct'; position -= 1) count += 1;
  return count;
}

/** いちばん長く続いた連続正解の数。 */
export function longestCombo(results) {
  let best = 0;
  let run = 0;
  for (const result of results) {
    run = result === 'correct' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * 正解の画面に出す、連続正解の知らせ。2問続いたら出す。
 * 区切りの数では、ひとことを添えて大きく祝う。続くほど演出を大きくする。
 * @returns {{ count: number, milestone: boolean, cheer: string, size: 'small'|'medium'|'large' }|null}
 */
export function comboMessage(count) {
  if (count < 2) return null;
  const milestone = isComboMilestone(count);
  let cheer = '';
  if (count === 5) cheer = 'いい調子！';
  else if (count === 10) cheer = 'すごい！';
  else if (milestone && count > 10) cheer = 'その調子！';
  let size = 'small';
  if (count >= 10) size = 'large';
  else if (count >= 5) size = 'medium';
  return { count, milestone, cheer, size };
}
