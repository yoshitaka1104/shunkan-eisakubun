import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addCustomAnswer,
  answersFor,
  emptyProgress,
  pickQuestions,
  reclassifyAsCorrect,
  recordResult,
  totals,
  weakQuestionIds,
} from '../js/progress.js';

const questions = [
  { id: 'a', level: 1, answers: ['A.'] },
  { id: 'b', level: 1, answers: ['B.'] },
  { id: 'c', level: 2, answers: ['C.'] },
  { id: 'd', level: 3, answers: ['D.'] },
];

describe('出題の選択', () => {
  it('レベルで絞り込む', () => {
    const picked = pickQuestions(questions, { level: 1 });
    assert.deepEqual(picked.map((question) => question.id).sort(), ['a', 'b']);
  });

  it('問題数で切り詰める', () => {
    assert.equal(pickQuestions(questions, { level: 'all', count: 2 }).length, 2);
  });

  it('問題数が総数を超えても全問を返す', () => {
    assert.equal(pickQuestions(questions, { level: 'all', count: 99 }).length, 4);
  });

  it('id を指定すると、その問題だけを返す', () => {
    const picked = pickQuestions(questions, { ids: ['c', 'd'] });
    assert.deepEqual(picked.map((question) => question.id).sort(), ['c', 'd']);
  });

  it('元の配列を並べ替えない', () => {
    const before = questions.map((question) => question.id);
    pickQuestions(questions, { level: 'all' }, () => 0);
    assert.deepEqual(questions.map((question) => question.id), before);
  });
});

describe('学習記録', () => {
  it('結果ごとに回数を数える', () => {
    const progress = emptyProgress();
    recordResult(progress, 'a', 'correct', 1);
    recordResult(progress, 'a', 'wrong', 2);
    assert.deepEqual(progress.stats.a, {
      attempts: 2, correct: 1, close: 0, wrong: 1, last: 'wrong', lastAt: 2,
    });
  });

  it('直近が正解でない問題を苦手な問題とする', () => {
    const progress = emptyProgress();
    recordResult(progress, 'a', 'correct');
    recordResult(progress, 'b', 'close');
    recordResult(progress, 'c', 'wrong');
    assert.deepEqual(weakQuestionIds(progress).sort(), ['b', 'c']);
  });

  it('次に正解すると苦手な問題から外れる', () => {
    const progress = emptyProgress();
    recordResult(progress, 'a', 'wrong');
    recordResult(progress, 'a', 'correct');
    assert.deepEqual(weakQuestionIds(progress), []);
  });

  it('正解率を計算する', () => {
    const progress = emptyProgress();
    recordResult(progress, 'a', 'correct');
    recordResult(progress, 'b', 'correct');
    recordResult(progress, 'c', 'wrong');
    assert.deepEqual(totals(progress), { attempts: 3, correct: 2, rate: 67 });
  });

  it('記録がなければ正解率は 0', () => {
    assert.deepEqual(totals(emptyProgress()), { attempts: 0, correct: 0, rate: 0 });
  });
});

describe('正解の追加', () => {
  it('追加した英文が次回から正解例に含まれる', () => {
    const progress = emptyProgress();
    addCustomAnswer(progress, 'a', 'Another answer');
    assert.deepEqual(answersFor(questions[0], progress), ['A.', 'Another answer']);
  });

  it('同じ英文は重ねて追加しない', () => {
    const progress = emptyProgress();
    addCustomAnswer(progress, 'a', 'Another answer');
    addCustomAnswer(progress, 'a', 'Another answer');
    assert.equal(progress.customAnswers.a.length, 1);
  });

  it('問題データそのものは変更しない', () => {
    const progress = emptyProgress();
    addCustomAnswer(progress, 'a', 'Another answer');
    assert.deepEqual(questions[0].answers, ['A.']);
  });

  it('記録の結果を正解へ付け替える', () => {
    const progress = emptyProgress();
    recordResult(progress, 'a', 'close');
    reclassifyAsCorrect(progress, 'a', 'close');
    assert.equal(progress.stats.a.close, 0);
    assert.equal(progress.stats.a.correct, 1);
    assert.equal(progress.stats.a.attempts, 1);
    assert.deepEqual(weakQuestionIds(progress), []);
  });
});
