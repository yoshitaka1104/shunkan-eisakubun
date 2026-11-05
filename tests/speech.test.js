import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { canAutoSpeak, createRecognizer, isIOS } from '../js/speech.js';

const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 };
const IPAD = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 };
const MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 };
const WINDOWS = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0', platform: 'Win32', maxTouchPoints: 0 };

function useDevice(device) {
  Object.defineProperty(globalThis, 'navigator', { value: device, configurable: true });
}

class FakeRecognition {
  static instances = [];

  static throwOnStart = false;

  constructor() {
    this.started = 0;
    this.stopped = 0;
    this.aborted = 0;
    FakeRecognition.instances.push(this);
  }

  start() {
    if (FakeRecognition.throwOnStart) throw new DOMException('busy', 'InvalidStateError');
    this.started += 1;
  }

  stop() {
    this.stopped += 1;
  }

  abort() {
    this.aborted += 1;
  }

  emitResult(alternatives, isFinal) {
    const result = Object.assign(alternatives.map((transcript) => ({ transcript })), { isFinal });
    this.onresult({ results: [result] });
  }
}

function listen() {
  const calls = { interim: [], results: [], errors: [] };
  const recognizer = createRecognizer({
    onInterim: (text) => calls.interim.push(text),
    onResult: (candidates) => calls.results.push(candidates),
    onError: (kind, code, trace) => calls.errors.push({ kind, code, trace }),
  });
  recognizer.start();
  return { recognizer, calls, recognition: FakeRecognition.instances.at(-1) };
}

beforeEach(() => {
  FakeRecognition.instances = [];
  FakeRecognition.throwOnStart = false;
  globalThis.window = { webkitSpeechRecognition: FakeRecognition };
  useDevice(WINDOWS);
  mock.timers.enable({ apis: ['setTimeout'] });
});

afterEach(() => {
  mock.timers.reset();
});

describe('端末の判別', () => {
  it('iPhone を判別する', () => {
    useDevice(IPHONE);
    assert.equal(isIOS(), true);
  });

  it('Mac を名乗る iPad を判別する', () => {
    useDevice(IPAD);
    assert.equal(isIOS(), true);
  });

  it('Mac は iOS と判別しない', () => {
    useDevice(MAC);
    assert.equal(isIOS(), false);
  });

  it('Windows は iOS と判別しない', () => {
    assert.equal(isIOS(), false);
  });

  it('iOS では自動で読み上げない', () => {
    useDevice(IPHONE);
    assert.equal(canAutoSpeak(), false);
  });

  it('PC では自動で読み上げる', () => {
    assert.equal(canAutoSpeak(), true);
  });
});

describe('音声認識の基本', () => {
  it('英語で認識し、候補を上位3件まで求める', () => {
    const { recognition } = listen();
    assert.equal(recognition.lang, 'en-US');
    assert.equal(recognition.maxAlternatives, 3);
    assert.equal(recognition.interimResults, true);
  });

  it('確定した候補を確度の高い順に返す', () => {
    const { calls, recognition } = listen();
    recognition.emitResult(['first', 'second', 'third'], true);
    assert.deepEqual(calls.results, [['first', 'second', 'third']]);
  });

  it('途中結果を画面へ渡す', () => {
    const { calls, recognition } = listen();
    recognition.emitResult(['I am'], false);
    assert.deepEqual(calls.interim, ['I am']);
    assert.deepEqual(calls.results, []);
  });

  it('結果は1回だけ返す', () => {
    const { calls, recognition } = listen();
    recognition.emitResult(['first'], true);
    recognition.onend();
    assert.equal(calls.results.length, 1);
    assert.equal(calls.errors.length, 0);
  });

  it('途中結果だけで終わった場合は、途中結果を回答にする', () => {
    const { calls, recognition } = listen();
    recognition.emitResult(['I am a student'], false);
    recognition.onend();
    assert.deepEqual(calls.results, [['I am a student']]);
  });

  it('打ち切った後は結果を返さない', () => {
    const { recognizer, calls, recognition } = listen();
    recognizer.abort();
    recognition.onend();
    assert.equal(recognition.aborted, 1);
    assert.deepEqual(calls, { interim: [], results: [], errors: [] });
  });
});

describe('マイクの解放', () => {
  it('結果を受け取ったらマイクを手放す', () => {
    const { recognition } = listen();
    recognition.emitResult(['first'], true);
    assert.equal(recognition.aborted, 1);
  });

  it('エラーの後もマイクを手放す', () => {
    const { recognition } = listen();
    recognition.onerror({ error: 'no-speech' });
    assert.equal(recognition.aborted, 1);
  });

  it('前回の認識が残っていれば、次を始める前に止める', () => {
    const first = listen();
    const second = listen();
    assert.equal(first.recognition.aborted, 1);
    assert.equal(second.recognition.started, 1);
  });

  it('終わった認識は、次を始めるときに止め直さない', () => {
    const first = listen();
    first.recognition.emitResult(['first'], true);
    listen();
    assert.equal(first.recognition.aborted, 1);
  });

  it('毎回新しい認識を作る', () => {
    listen();
    listen();
    assert.equal(FakeRecognition.instances.length, 2);
  });
});

describe('エラー', () => {
  const cases = [
    ['not-allowed', 'denied'],
    ['service-not-allowed', 'denied'],
    ['audio-capture', 'no-mic'],
    ['network', 'network'],
    ['language-not-supported', 'unsupported'],
    ['no-speech', 'no-speech'],
    ['something-new', 'no-speech'],
  ];
  for (const [code, kind] of cases) {
    it(`${code} を ${kind} として扱う`, () => {
      const { calls, recognition } = listen();
      recognition.onerror({ error: code });
      assert.equal(calls.errors[0].kind, kind);
      assert.equal(calls.errors[0].code, code);
    });
  }

  it('調査用に、起きた出来事の順番を返す', () => {
    const { calls, recognition } = listen();
    recognition.onstart();
    recognition.onaudiostart();
    recognition.onerror({ error: 'audio-capture' });
    assert.deepEqual(
      calls.errors[0].trace.map((entry) => entry.split('@')[0]),
      ['start', 'audiostart', 'error:audio-capture'],
    );
  });

  it('開始に失敗してもエラーとして返す', () => {
    FakeRecognition.throwOnStart = true;
    const { calls } = listen();
    assert.equal(calls.errors[0].code, 'start-failed');
  });
});

describe('iOS で報告されている動き', () => {
  beforeEach(() => useDevice(IPHONE));

  it('開始直後に何も起きず終了しても、エラーとして返す', () => {
    const { calls, recognition } = listen();
    recognition.onend();
    assert.equal(calls.errors[0].kind, 'no-speech');
    assert.equal(calls.errors[0].code, 'no-result');
  });

  it('aborted だけでは失敗にせず、終了を待つ', () => {
    const { calls, recognition } = listen();
    recognition.onerror({ error: 'aborted' });
    assert.equal(calls.errors.length, 0);
    recognition.onend();
    assert.equal(calls.errors[0].kind, 'no-speech');
  });

  it('結果が確定しなくても、話し終えたら止めて途中結果で判定する', () => {
    const { calls, recognition } = listen();
    recognition.onstart();
    recognition.emitResult(['I am a student'], false);
    mock.timers.tick(1799);
    assert.equal(recognition.stopped, 0);
    mock.timers.tick(1);
    assert.equal(recognition.stopped, 1);
    mock.timers.tick(1000);
    assert.deepEqual(calls.results, [['I am a student']]);
  });

  it('話し続けている間は止めない', () => {
    const { recognition } = listen();
    recognition.onstart();
    recognition.emitResult(['I am'], false);
    mock.timers.tick(1500);
    recognition.emitResult(['I am a student'], false);
    mock.timers.tick(1500);
    assert.equal(recognition.stopped, 0);
  });

  it('止めた後に確定した結果があれば、そちらを使う', () => {
    const { calls, recognition } = listen();
    recognition.onstart();
    recognition.emitResult(['I am a stud'], false);
    mock.timers.tick(1800);
    recognition.emitResult(['I am a student'], true);
    assert.deepEqual(calls.results, [['I am a student']]);
  });

  it('イベントが何も届かなくても、学習が止まらない', () => {
    const { calls } = listen();
    mock.timers.tick(20_000);
    assert.equal(calls.errors[0].kind, 'no-speech');
    assert.equal(calls.errors[0].code, 'timeout');
  });

  it('開始の後に結果が届かなくても、学習が止まらない', () => {
    const { calls, recognition } = listen();
    recognition.onstart();
    recognition.onaudiostart();
    mock.timers.tick(12_000);
    assert.equal(calls.errors[0].code, 'timeout');
  });

  it('話し終えるボタンの後に反応がなくても、学習が止まらない', () => {
    const { recognizer, calls, recognition } = listen();
    recognition.onstart();
    recognizer.stop();
    mock.timers.tick(1000);
    assert.equal(calls.errors[0].code, 'stop-timeout');
  });
});

describe('PC の動き', () => {
  it('途中結果が止まっても、ブラウザの確定を待つ', () => {
    const { recognition } = listen();
    recognition.onstart();
    recognition.emitResult(['I am'], false);
    mock.timers.tick(5000);
    assert.equal(recognition.stopped, 0);
  });
});
