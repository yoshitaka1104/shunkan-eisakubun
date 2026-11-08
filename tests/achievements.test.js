import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACHIEVEMENTS, achievementProgress, earnedCount, unlockAchievements } from '../js/achievements.js';

const TODAY = '2026-11-08';

function stats(overrides = {}) {
  return {
    attempts: 0,
    correct: 0,
    mastered: 0,
    completeItems: 0,
    totalItems: 105,
    levels: { 1: [0, 17], 2: [0, 64], 3: [0, 24] },
    bestStreak: 0,
    busiestDay: 0,
    perfectSession: false,
    reviewFinished: false,
    ...overrides,
  };
}

const ids = (achievements) => achievements.map(({ id }) => id);

describe('実績の定義', () => {
  it('全部で 20 個あり、id が重複していない', () => {
    assert.equal(ACHIEVEMENTS.length, 20);
    assert.equal(new Set(ids(ACHIEVEMENTS)).size, 20);
  });

  it('何もしていなければ、どれも獲得しない', () => {
    assert.deepEqual(unlockAchievements({ achievements: {} }, stats(), TODAY), []);
  });
});

describe('獲得', () => {
  it('条件を満たした実績を、獲得した日とともに記録する', () => {
    const progress = { achievements: {} };
    const unlocked = unlockAchievements(progress, stats({ attempts: 120, correct: 80 }), TODAY);
    assert.deepEqual(ids(unlocked), ['first-correct', 'answers-50', 'answers-100']);
    assert.equal(progress.achievements['answers-100'], TODAY);
  });

  it('獲得済みの実績は、もう一度は知らせない', () => {
    const progress = { achievements: { 'first-correct': '2026-11-01' } };
    assert.deepEqual(ids(unlockAchievements(progress, stats({ correct: 1 }), TODAY)), []);
    assert.equal(progress.achievements['first-correct'], '2026-11-01');
  });

  it('連続日数は最長記録で判定する', () => {
    assert.deepEqual(ids(unlockAchievements({ achievements: {} }, stats({ bestStreak: 7 }), TODAY)), ['streak-3', 'streak-7']);
  });

  it('マスターと項目の完成', () => {
    const unlocked = unlockAchievements({ achievements: {} }, stats({ mastered: 3, completeItems: 1 }), TODAY);
    assert.deepEqual(ids(unlocked), ['mastered-1', 'item-1']);
  });

  it('学校段階の項目をすべて完成させたら制覇', () => {
    const unlocked = unlockAchievements(
      { achievements: {} },
      stats({ levels: { 1: [17, 17], 2: [10, 64], 3: [0, 24] } }),
      TODAY,
    );
    assert.ok(ids(unlocked).includes('level-1'));
    assert.ok(!ids(unlocked).includes('level-2'));
  });

  it('学校段階の項目数がわからないときは、制覇を獲得しない', () => {
    const unlocked = unlockAchievements({ achievements: {} }, stats({ levels: {} }), TODAY);
    assert.ok(!ids(unlocked).some((id) => id.startsWith('level-')));
  });

  it('全制覇は105項目すべての完成', () => {
    const unlocked = unlockAchievements({ achievements: {} }, stats({ completeItems: 105 }), TODAY);
    assert.ok(ids(unlocked).includes('all-complete'));
  });

  it('1日に30問答えたら集中の一日', () => {
    assert.deepEqual(ids(unlockAchievements({ achievements: {} }, stats({ busiestDay: 30 }), TODAY)), ['busy-day']);
  });

  it('1回の学習の結果で決まる実績', () => {
    const unlocked = unlockAchievements({ achievements: {} }, stats({ perfectSession: true, reviewFinished: true }), TODAY);
    assert.deepEqual(ids(unlocked), ['no-miss', 'review-done']);
  });

  it('獲得した数を数える(知らない id は数えない)', () => {
    assert.equal(earnedCount({ achievements: { 'first-correct': TODAY, unknown: TODAY } }), 1);
  });
});

describe('進み具合', () => {
  const find = (id) => ACHIEVEMENTS.find((achievement) => achievement.id === id);

  it('現在の数と目標を返す', () => {
    assert.deepEqual(achievementProgress(find('answers-100'), stats({ attempts: 37 })), { current: 37, target: 100 });
  });

  it('目標を超えた分は目標にそろえる', () => {
    assert.deepEqual(achievementProgress(find('answers-50'), stats({ attempts: 80 })), { current: 50, target: 50 });
  });

  it('学校段階の制覇は、完成した項目数で進む', () => {
    assert.deepEqual(
      achievementProgress(find('level-2'), stats({ levels: { 1: [0, 17], 2: [12, 64], 3: [0, 24] } })),
      { current: 12, target: 64 },
    );
  });
});
