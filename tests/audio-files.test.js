import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { audioFileFor, SILENCE_FILE } from '../js/audio-files.js';

const questions = JSON.parse(readFileSync('data/questions.json', 'utf8'));
const answers = [...new Set(questions.flatMap((question) => question.answers))];

describe('音声ファイルの名前', () => {
  it('小文字と記号の整理で、文からファイル名を作る', () => {
    assert.equal(audioFileFor('I drink coffee every morning.'), 'audio/i-drink-coffee-every-morning.mp3');
  });

  it('アポストロフィは詰める', () => {
    assert.equal(audioFileFor("I'm a student."), 'audio/im-a-student.mp3');
    assert.equal(audioFileFor('I’m a student.'), 'audio/im-a-student.mp3');
  });

  it('疑問文の記号も取り除く', () => {
    assert.equal(audioFileFor('Can I take a picture here?'), 'audio/can-i-take-a-picture-here.mp3');
  });

  it('正解例どうしで名前が重ならない', () => {
    assert.equal(new Set(answers.map(audioFileFor)).size, answers.length);
  });
});

describe('音声ファイルの用意', () => {
  for (const answer of answers) {
    it(`「${answer}」の音声がある`, () => {
      assert.ok(existsSync(audioFileFor(answer)));
    });
  }

  it('無音のファイルがある', () => {
    assert.ok(existsSync(SILENCE_FILE));
  });

  it('ローカルサーバーが音声ファイルを配信する', () => {
    assert.match(readFileSync('server.js', 'utf8'), /'\.mp3': 'audio\/mpeg'/);
  });
});
