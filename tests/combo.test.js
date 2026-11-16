import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { comboAt, comboMessage, isComboMilestone, longestCombo } from '../js/combo.js';

const C = 'correct';
const N = 'close';
const W = 'wrong';

describe('連続正解の数え方', () => {
  it('今の問題から前へ、続けて正解した数を数える', () => {
    const results = [W, C, C, C];
    assert.equal(comboAt(results, 3), 3);
    assert.equal(comboAt(results, 1), 1);
    assert.equal(comboAt(results, 0), 0);
  });

  it('惜しいも不正解と同じく、連続を止める', () => {
    assert.equal(comboAt([C, C, N, C], 3), 1);
  });

  it('まだ答えていない問題は数えない', () => {
    assert.equal(comboAt([C, undefined], 1), 0);
  });

  it('いちばん長く続いた数を求める', () => {
    assert.equal(longestCombo([C, C, W, C, C, C, N, C]), 3);
    assert.equal(longestCombo([W, N]), 0);
    assert.equal(longestCombo([]), 0);
  });
});

describe('連続正解の知らせ', () => {
  it('1問だけなら出さない', () => {
    assert.equal(comboMessage(0), null);
    assert.equal(comboMessage(1), null);
  });

  it('2問から出し、区切りでない数では祝わない', () => {
    assert.deepEqual(comboMessage(2), { count: 2, milestone: false, cheer: '', size: 'small' });
    assert.equal(comboMessage(4).milestone, false);
  });

  it('3、5、10問と、その後は5問ごとに大きく祝う', () => {
    const milestones = Array.from({ length: 30 }, (_, index) => index + 1).filter(isComboMilestone);
    assert.deepEqual(milestones, [3, 5, 10, 15, 20, 25, 30]);
  });

  it('続くほど演出を大きくし、ひとことを添える', () => {
    assert.deepEqual(comboMessage(3), { count: 3, milestone: true, cheer: '', size: 'small' });
    assert.deepEqual(comboMessage(5), { count: 5, milestone: true, cheer: 'いい調子！', size: 'medium' });
    assert.deepEqual(comboMessage(10), { count: 10, milestone: true, cheer: 'すごい！', size: 'large' });
    assert.deepEqual(comboMessage(15), { count: 15, milestone: true, cheer: 'その調子！', size: 'large' });
    assert.deepEqual(comboMessage(12), { count: 12, milestone: false, cheer: '', size: 'large' });
  });
});
