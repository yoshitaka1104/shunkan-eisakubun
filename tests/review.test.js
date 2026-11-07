import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyProgress } from '../js/progress.js';
import {
  addDays,
  daysBetween,
  dueQuestionIds,
  grammarMap,
  isDue,
  localDate,
  MASTERED_STAGE,
  masteryState,
  masterySummary,
  nextReview,
  recordAsCorrectInstead,
  recordReview,
} from '../js/review.js';

const DAY = '2026-11-08';

/** 予定日ごとに正解し続けたときの、各回の段階と次の予定日。 */
function answerOnEachDueDay(times) {
  const progress = emptyProgress();
  let today = DAY;
  const history = [];
  for (let i = 0; i < times; i += 1) {
    const { after, mastered } = recordReview(progress, 'a', 'correct', today);
    history.push({ today, stage: after.stage, due: after.due, mastered });
    today = after.due;
  }
  return history;
}

describe('日付', () => {
  it('端末の時刻で日付を作る', () => {
    assert.equal(localDate(new Date(2026, 10, 8, 23, 59)), '2026-11-08');
    assert.equal(localDate(new Date(2026, 10, 9, 0, 0)), '2026-11-09');
  });

  it('月末と年末をまたいで日数を足す', () => {
    assert.equal(addDays('2026-11-30', 1), '2026-12-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  });

  it('日付の差を日数で求める', () => {
    assert.equal(daysBetween('2026-11-08', '2026-11-15'), 7);
    assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  });
});

describe('間隔をあけた繰り返し', () => {
  it('予定日に正解するたびに、間隔が 1日、3日、7日、14日、30日と延びる', () => {
    const history = answerOnEachDueDay(6);
    assert.deepEqual(history.map(({ stage }) => stage), [1, 2, 3, 4, 5, 5]);
    const gaps = history.map(({ today, due }) => daysBetween(today, due));
    assert.deepEqual(gaps, [1, 3, 7, 14, 30, 30]);
  });

  it('3回目の正解でマスターになり、知らせるのはその1回だけ', () => {
    const history = answerOnEachDueDay(5);
    assert.deepEqual(history.map(({ mastered }) => mastered), [false, false, true, false, false]);
    assert.equal(history[2].stage, MASTERED_STAGE);
  });

  it('マスターまでは最短で5日かかる', () => {
    const history = answerOnEachDueDay(3);
    assert.equal(daysBetween(DAY, history[2].today), 4);
  });

  it('予定日より前に正解しても、段階は上がらない', () => {
    const progress = emptyProgress();
    recordReview(progress, 'a', 'correct', DAY);
    const { after } = recordReview(progress, 'a', 'correct', DAY);
    assert.deepEqual(after, { stage: 1, due: '2026-11-09' });
  });

  it('予定日を過ぎてから正解しても、段階は上がる', () => {
    const progress = emptyProgress();
    recordReview(progress, 'a', 'correct', DAY);
    const { after } = recordReview(progress, 'a', 'correct', '2026-11-20');
    assert.deepEqual(after, { stage: 2, due: '2026-11-23' });
  });

  it('間違えたら段階0に戻り、翌日に出す', () => {
    const progress = emptyProgress();
    recordReview(progress, 'a', 'correct', DAY);
    const { after } = recordReview(progress, 'a', 'wrong', '2026-11-09');
    assert.deepEqual(after, { stage: 0, due: '2026-11-10' });
  });

  it('惜しいも間違いとして扱う', () => {
    const progress = emptyProgress();
    assert.equal(recordReview(progress, 'a', 'close', DAY).after.stage, 0);
  });

  it('マスターした問題でも、間違えたらマスターではなくなる', () => {
    const progress = emptyProgress();
    progress.review.a = { stage: 4, due: DAY };
    recordReview(progress, 'a', 'wrong', DAY);
    assert.equal(masteryState(progress.review.a), 'learning');
  });

  it('答えた日の回答数を数える', () => {
    const progress = emptyProgress();
    recordReview(progress, 'a', 'correct', DAY);
    recordReview(progress, 'b', 'wrong', DAY);
    recordReview(progress, 'c', 'correct', '2026-11-09');
    assert.deepEqual(progress.days, { '2026-11-08': 2, '2026-11-09': 1 });
  });

  it('初めて答える問題は、予定日が来ているものとして扱う', () => {
    assert.equal(isDue(undefined, DAY), true);
    assert.equal(isDue({ stage: 1, due: '2026-11-09' }, DAY), false);
    assert.equal(isDue({ stage: 1, due: DAY }, DAY), true);
  });
});

describe('「正解にする」の付け替え', () => {
  it('間違えて段階0に戻した記録を、正解として記録し直す', () => {
    const progress = emptyProgress();
    progress.review.a = { stage: 2, due: DAY };
    const { before } = recordReview(progress, 'a', 'wrong', DAY);
    const { after, mastered } = recordAsCorrectInstead(progress, 'a', before, DAY);
    assert.deepEqual(after, { stage: 3, due: '2026-11-15' });
    assert.equal(mastered, true);
  });

  it('初めての問題なら、段階1にする', () => {
    const progress = emptyProgress();
    const { before } = recordReview(progress, 'a', 'wrong', DAY);
    assert.deepEqual(recordAsCorrectInstead(progress, 'a', before, DAY).after, { stage: 1, due: '2026-11-09' });
  });

  it('学習した日の回答数は増やさない', () => {
    const progress = emptyProgress();
    const { before } = recordReview(progress, 'a', 'wrong', DAY);
    recordAsCorrectInstead(progress, 'a', before, DAY);
    assert.deepEqual(progress.days, { [DAY]: 1 });
  });
});

describe('今日の復習', () => {
  const progress = emptyProgress();
  progress.review = {
    overdue: { stage: 1, due: '2026-11-05' },
    today: { stage: 2, due: DAY },
    tomorrow1: { stage: 1, due: '2026-11-09' },
    tomorrow2: { stage: 0, due: '2026-11-09' },
    later: { stage: 3, due: '2026-11-20' },
    removed: { stage: 1, due: '2026-11-01' },
  };
  const known = new Set(['overdue', 'today', 'tomorrow1', 'tomorrow2', 'later']);

  it('予定日が今日まで来た問題を出す', () => {
    assert.deepEqual(dueQuestionIds(progress, DAY, known).sort(), ['overdue', 'today']);
  });

  it('収録されなくなった問題は出さない', () => {
    assert.ok(dueQuestionIds(progress, DAY).includes('removed'));
    assert.ok(!dueQuestionIds(progress, DAY, known).includes('removed'));
  });

  it('次の予定日と問題数を返す', () => {
    assert.deepEqual(nextReview(progress, DAY, known), { day: '2026-11-09', count: 2 });
  });

  it('先の予定がなければ null', () => {
    assert.equal(nextReview(emptyProgress(), DAY), null);
  });
});

describe('文法マップ', () => {
  const questions = [
    { id: 'E-001', level: 1, pattern: '単文' },
    { id: 'E-002', level: 1, pattern: '単文' },
    { id: 'E-003', level: 1, pattern: '単文' },
    { id: 'E-004', level: 1, pattern: '命令文' },
    { id: 'J-001', level: 2, pattern: '重文' },
  ];
  const progress = emptyProgress();
  progress.review = {
    'E-001': { stage: 3, due: DAY },
    'E-002': { stage: 5, due: DAY },
    'E-003': { stage: 4, due: DAY },
    'E-004': { stage: 0, due: DAY },
  };

  it('レベルごとに文法項目を並べ、各問の習熟度を添える', () => {
    const map = grammarMap(questions, progress);
    assert.deepEqual(map.map(({ level }) => level), [1, 2]);
    assert.deepEqual(map[0].items.map(({ pattern }) => pattern), ['単文', '命令文']);
    assert.deepEqual(map[0].items[1].questions, [{ id: 'E-004', state: 'learning' }]);
    assert.deepEqual(map[1].items[0].questions, [{ id: 'J-001', state: 'new' }]);
  });

  it('すべての問題をマスターした項目を完成とする', () => {
    const map = grammarMap(questions, progress);
    assert.equal(map[0].items[0].complete, true);
    assert.equal(map[0].items[1].complete, false);
  });

  it('マスターした問題数と完成した項目数を数える', () => {
    assert.deepEqual(masterySummary(questions, progress), { mastered: 3, total: 5, completeItems: 1, totalItems: 3 });
  });

  it('習熟度は段階から決める', () => {
    assert.deepEqual(
      [undefined, { stage: 0 }, { stage: 1 }, { stage: 2 }, { stage: 3 }, { stage: 5 }].map(masteryState),
      ['new', 'learning', 'growing', 'growing', 'mastered', 'mastered'],
    );
  });
});
