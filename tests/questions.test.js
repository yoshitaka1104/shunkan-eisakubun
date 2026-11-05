import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { judge } from '../js/judge.js';

const questions = JSON.parse(await readFile(new URL('../data/questions.json', import.meta.url), 'utf8'));

describe('問題データ', () => {
  it('全部で 50 問ある', () => {
    assert.equal(questions.length, 50);
  });

  it('3 レベルに分かれている', () => {
    const levels = new Set(questions.map((question) => question.level));
    assert.deepEqual([...levels].sort(), [1, 2, 3]);
  });

  it('id が重複していない', () => {
    const ids = questions.map((question) => question.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('各問に必要な項目がある', () => {
    for (const question of questions) {
      assert.match(question.id, /^L\d-\d{3}$/, question.id);
      assert.ok(question.pattern, question.id);
      assert.ok(question.ja.endsWith('。'), question.id);
      assert.ok(question.answers.length >= 1, question.id);
    }
  });

  it('全ての正解例が、自身に対して正解と判定される', () => {
    for (const question of questions) {
      for (const answer of question.answers) {
        const stripped = answer.replace(/[.,?!]/g, '').toLowerCase();
        const verdict = judge({ candidates: [stripped], answers: question.answers });
        assert.equal(verdict.result, 'correct', `${question.id}: ${answer}`);
      }
    }
  });
});
