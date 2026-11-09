import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  answerTime,
  emptySpeed,
  formatSeconds,
  MAX_SPEED_MS,
  recordSpeed,
  speedChange,
  speedSummary,
} from '../js/speed.js';

const TODAY = '2026-11-09';

describe('答えるまでの時間', () => {
  it('ボタンを押すまでと、マイクの準備ができてから話し始めるまでを足す', () => {
    assert.equal(answerTime({ shownAt: 1000, pressedAt: 1800, speechAfterReadyMs: 650 }), 1450);
  });

  it('マイクの準備にかかった時間は含めない', () => {
    // 押してから準備ができるまでの時間は、shownAt と pressedAt にも speechAfterReadyMs にも入らない。
    assert.equal(answerTime({ shownAt: 0, pressedAt: 500, speechAfterReadyMs: 0 }), 500);
  });

  it('10ミリ秒単位にそろえる', () => {
    assert.equal(answerTime({ shownAt: 0, pressedAt: 1234.4, speechAfterReadyMs: 3 }), 1240);
  });

  it('話し始めを測れなかったときは記録しない', () => {
    assert.equal(answerTime({ shownAt: 0, pressedAt: 500, speechAfterReadyMs: null }), null);
    assert.equal(answerTime({ shownAt: 0, pressedAt: null, speechAfterReadyMs: 200 }), null);
  });

  it('長すぎる時間は記録しない', () => {
    assert.equal(answerTime({ shownAt: 0, pressedAt: MAX_SPEED_MS, speechAfterReadyMs: 0 }), MAX_SPEED_MS);
    assert.equal(answerTime({ shownAt: 0, pressedAt: MAX_SPEED_MS, speechAfterReadyMs: 10 }), null);
  });
});

describe('速さの記録', () => {
  it('日ごとの合計と回数、問題ごとの最新の時間を残し、前回の時間を返す', () => {
    const progress = { speed: emptySpeed() };
    assert.equal(recordSpeed(progress, 'J-001', 2400, TODAY), null);
    assert.equal(recordSpeed(progress, 'J-001', 1800, TODAY), 2400);
    recordSpeed(progress, 'J-002', 3000, TODAY);
    assert.deepEqual(progress.speed, {
      days: { [TODAY]: { totalMs: 7200, count: 3 } },
      questions: { 'J-001': 1800, 'J-002': 3000 },
    });
  });

  it('速さの欄がない古い記録にも書ける', () => {
    const progress = {};
    recordSpeed(progress, 'E-001', 1000, TODAY);
    assert.equal(progress.speed.questions['E-001'], 1000);
  });
});

describe('速さのまとめ', () => {
  const speed = {
    days: {
      '2026-10-20': { totalMs: 9000, count: 1 }, // 14日より前は使わない
      '2026-10-27': { totalMs: 6000, count: 2 }, // 前の7日(10/27〜11/2)
      '2026-11-02': { totalMs: 4000, count: 1 },
      '2026-11-03': { totalMs: 5000, count: 2 }, // 直近の7日(11/3〜11/9)
      '2026-11-09': { totalMs: 3000, count: 2 },
    },
    questions: {},
  };

  it('直近7日と、その前の7日の平均を回答数で重み付けして出す', () => {
    const { recent, previous } = speedSummary(speed, TODAY);
    assert.equal(recent, 2000);
    assert.equal(previous, 3333);
  });

  it('14日の推移を古い順に出し、学習していない日は null', () => {
    const { trend } = speedSummary(speed, TODAY);
    assert.equal(trend.length, 14);
    assert.deepEqual(trend[0], { day: '2026-10-27', ms: 3000 });
    assert.deepEqual(trend.at(-1), { day: TODAY, ms: 1500 });
    assert.equal(trend[1].ms, null);
  });

  it('記録がなければすべて null', () => {
    const { recent, previous, trend } = speedSummary(emptySpeed(), TODAY);
    assert.equal(recent, null);
    assert.equal(previous, null);
    assert.ok(trend.every(({ ms }) => ms === null));
    assert.equal(speedSummary(undefined, TODAY).recent, null);
  });
});

describe('表示', () => {
  it('秒にして小数第1位まで出す', () => {
    assert.equal(formatSeconds(2350), '2.4');
    assert.equal(formatSeconds(800), '0.8');
  });

  it('前の7日と比べる', () => {
    assert.deepEqual(speedChange(2000, 2400), { direction: 'faster', text: '前の7日より0.4秒速くなりました。' });
    assert.deepEqual(speedChange(3100, 2400), { direction: 'slower', text: '前の7日より0.7秒遅くなりました。' });
    assert.deepEqual(speedChange(2420, 2400), { direction: 'same', text: '前の7日とほぼ同じです。' });
    assert.equal(speedChange(2000, null), null);
    assert.equal(speedChange(null, 2000), null);
  });
});
