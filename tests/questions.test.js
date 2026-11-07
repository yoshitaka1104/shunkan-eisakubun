import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { judge } from '../js/judge.js';

const questions = JSON.parse(await readFile(new URL('../data/questions.json', import.meta.url), 'utf8'));

describe('問題データ', () => {
  it('全部で 315 問ある', () => {
    assert.equal(questions.length, 315);
  });

  it('小学校、中学校、高校の 3 レベルに分かれている', () => {
    const count = (level) => questions.filter((question) => question.level === level).length;
    assert.deepEqual([count(1), count(2), count(3)], [51, 192, 72]);
  });

  it('文法項目は全部で 105 ある', () => {
    const items = new Set(questions.map((question) => `${question.level}:${question.pattern}`));
    assert.equal(items.size, 105);
  });

  it('1 項目につき 3 問ある', () => {
    const counts = new Map();
    for (const { level, pattern } of questions) {
      const key = `${level}:${pattern}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) assert.equal(count, 3, key);
  });

  it('日本語文が重複していない', () => {
    const japanese = questions.map((question) => question.ja);
    assert.equal(new Set(japanese).size, japanese.length);
  });

  it('id が重複していない', () => {
    const ids = questions.map((question) => question.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('各問に必要な項目がある', () => {
    for (const question of questions) {
      assert.match(question.id, /^[EJH]-\d{3}$/, question.id);
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
