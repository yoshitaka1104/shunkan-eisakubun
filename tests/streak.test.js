import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { busiestDay, recentDays, studyStreak } from '../js/streak.js';

const TODAY = '2026-11-08';

describe('連続学習日数', () => {
  it('今日まで続けて学習した日数を数える', () => {
    const days = { '2026-11-06': 3, '2026-11-07': 1, '2026-11-08': 5 };
    assert.deepEqual(studyStreak(days, TODAY), { current: 3, best: 3, studiedToday: true });
  });

  it('今日まだ学習していなくても、昨日まで続いていれば途切れていない', () => {
    const days = { '2026-11-06': 3, '2026-11-07': 1 };
    assert.deepEqual(studyStreak(days, TODAY), { current: 2, best: 2, studiedToday: false });
  });

  it('昨日も学習していなければ 0 日', () => {
    const days = { '2026-11-05': 3, '2026-11-06': 1 };
    assert.equal(studyStreak(days, TODAY).current, 0);
  });

  it('最長記録は、途中で途切れた期間も含めて数える', () => {
    const days = {
      '2026-10-01': 1, '2026-10-02': 1, '2026-10-03': 1, '2026-10-04': 1,
      '2026-11-07': 1, '2026-11-08': 1,
    };
    assert.deepEqual(studyStreak(days, TODAY), { current: 2, best: 4, studiedToday: true });
  });

  it('月末と年末をまたいでも続けて数える', () => {
    const days = { '2026-12-30': 1, '2026-12-31': 1, '2027-01-01': 1 };
    assert.equal(studyStreak(days, '2027-01-01').current, 3);
  });

  it('回答数が 0 の日は学習した日に数えない', () => {
    const days = { '2026-11-07': 0, '2026-11-08': 2 };
    assert.equal(studyStreak(days, TODAY).current, 1);
  });

  it('記録がなければすべて 0', () => {
    assert.deepEqual(studyStreak({}, TODAY), { current: 0, best: 0, studiedToday: false });
  });
});

describe('直近の学習日', () => {
  it('今日までの7日を古い順に並べ、曜日と学習の有無を添える', () => {
    const week = recentDays({ '2026-11-08': 1, '2026-11-05': 2 }, TODAY);
    assert.equal(week.length, 7);
    assert.deepEqual(week[0], { day: '2026-11-02', weekday: '月', studied: false, isToday: false });
    assert.deepEqual(week.at(-1), { day: '2026-11-08', weekday: '日', studied: true, isToday: true });
    assert.equal(week.find(({ day }) => day === '2026-11-05').studied, true);
  });
});

describe('1日の最多回答数', () => {
  it('いちばん多く答えた日の問題数を返す', () => {
    assert.equal(busiestDay({ a: 3, b: 31, c: 7 }), 31);
    assert.equal(busiestDay({}), 0);
  });
});
