import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import {
  createDeviceRecognizer,
  createEndpointDetector,
  downsample,
  isDeviceSpeechSupported,
  prepareDeviceSpeech,
  rootMeanSquare,
  trimToSpeech,
} from '../js/device-speech.js';

const FRAME_MS = 50;
const NOISE = 0.002;
const VOICE = 0.1;

class FakeWorker {
  static instances = [];

  sent = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message) {
    this.sent.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  receive(data) {
    this.onmessage({ data });
  }
}

class FakeProcessor {
  connect() {}

  disconnect() {
    this.disconnected = true;
  }
}

class FakeContext {
  static instances = [];

  destination = {};

  constructor() {
    FakeContext.instances.push(this);
  }

  resume() {
    this.resumed = true;
    return Promise.resolve();
  }

  close() {
    this.closed = true;
    return Promise.resolve();
  }

  createScriptProcessor() {
    this.processor = new FakeProcessor();
    return this.processor;
  }

  createMediaStreamSource() {
    return { connect() {} };
  }
}

/** getUserMedia の結果が画面の処理へ届くのを待つ。 */
const settle = () => new Promise((resolve) => { setImmediate(resolve); });

function makeStream() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return { track, getTracks: () => [track] };
}

function useMicrophone(getUserMedia = async () => makeStream()) {
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia } }, configurable: true });
}

async function listen(getUserMedia) {
  useMicrophone(getUserMedia);
  const calls = { ready: 0, speechStart: [], processing: 0, interim: [], results: [], errors: [] };
  const recognizer = createDeviceRecognizer({
    onReady: () => { calls.ready += 1; },
    onSpeechStart: (ms) => calls.speechStart.push(ms),
    onInterim: (text) => calls.interim.push(text),
    onProcessing: () => { calls.processing += 1; },
    onResult: (candidates) => calls.results.push(candidates),
    onError: (kind, code) => calls.errors.push({ kind, code }),
  });
  recognizer.start();
  await settle();
  return { recognizer, calls, context: FakeContext.instances.at(-1) };
}

function emit(context, level, count = 1) {
  for (let index = 0; index < count; index += 1) {
    const samples = new Float32Array(2400).fill(level);
    context.processor.onaudioprocess?.({ inputBuffer: { sampleRate: 48_000, getChannelData: () => samples } });
  }
}

/** 静かな間、話し声、話し終えた後の静けさを順に流す。 */
function speakAndFinish(context) {
  emit(context, NOISE, 4);
  emit(context, VOICE, 20);
  emit(context, NOISE, 24);
}

/** 音声認識モデルの読み込みが終わった Worker を返す。 */
async function loadedWorker() {
  const preparing = prepareDeviceSpeech();
  const worker = FakeWorker.instances.at(-1);
  if (!worker.loadedForTest) {
    worker.loadedForTest = true;
    worker.receive({ type: 'loaded' });
  }
  await preparing;
  return worker;
}

const lastRequest = (worker) => worker.sent.filter(({ type }) => type === 'transcribe').at(-1);

beforeEach(() => {
  FakeContext.instances = [];
  globalThis.AudioContext = FakeContext;
  globalThis.Worker = FakeWorker;
  mock.timers.enable({ apis: ['setTimeout'] });
});

afterEach(() => {
  mock.timers.reset();
  delete globalThis.AudioContext;
  delete globalThis.Worker;
});

describe('音声の加工', () => {
  it('音量を求める', () => {
    assert.equal(rootMeanSquare(new Float32Array([0.5, -0.5])), 0.5);
    assert.equal(rootMeanSquare(new Float32Array()), 0);
  });

  it('48kHz の音声を、長さを保って 16kHz にする', () => {
    const output = downsample(new Float32Array(48_000), 48_000);
    assert.equal(output.length, 16_000);
  });

  it('44.1kHz の音声も、長さを保って 16kHz にする', () => {
    const output = downsample(new Float32Array(44_100), 44_100);
    assert.equal(output.length, 16_000);
  });

  it('間引くときは平均を取る', () => {
    const output = downsample(new Float32Array([0, 0.3, 0.6, 0, 0, 0]), 48_000);
    assert.equal(output.length, 2);
    assert.ok(Math.abs(output[0] - 0.3) < 1e-6);
    assert.equal(output[1], 0);
  });

  it('同じ形式なら、そのまま返す', () => {
    const samples = new Float32Array(10);
    assert.equal(downsample(samples, 16_000), samples);
  });

  it('話している部分の前後を残して切り出す', () => {
    const samples = new Float32Array(16_000 * 5);
    const speech = trimToSpeech(samples, 16_000, { startMs: 1000, endMs: 3000 });
    assert.equal(speech.length, 16_000 * 2.6);
  });

  it('切り出す範囲が音声の外に出ない', () => {
    const samples = new Float32Array(16_000);
    assert.equal(trimToSpeech(samples, 16_000, { startMs: 100, endMs: 950 }).length, 16_000);
  });
});

describe('話し始めと話し終わりの検出', () => {
  function run(frames) {
    const detector = createEndpointDetector();
    let state = 'waiting';
    for (const level of frames) state = detector.feed(level, FRAME_MS);
    return { state, range: detector.speechRange() };
  }
  const repeat = (level, milliseconds) => Array(Math.round(milliseconds / FRAME_MS)).fill(level);

  it('静かな間は待つ', () => {
    assert.equal(run(repeat(NOISE, 1000)).state, 'waiting');
  });

  it('話し声を見つける', () => {
    assert.equal(run([...repeat(NOISE, 500), ...repeat(VOICE, 300)]).state, 'speaking');
  });

  it('一瞬の物音は話し声にしない', () => {
    assert.equal(run([...repeat(NOISE, 500), VOICE, ...repeat(NOISE, 500)]).state, 'waiting');
  });

  it('話し声が約1.2秒止まったら、話し終えたとみなす', () => {
    const frames = [...repeat(NOISE, 500), ...repeat(VOICE, 1000)];
    assert.equal(run([...frames, ...repeat(NOISE, 1150)]).state, 'speaking');
    assert.equal(run([...frames, ...repeat(NOISE, 1200)]).state, 'end');
  });

  it('文の途中の短い間では終わらない', () => {
    const frames = [...repeat(NOISE, 500), ...repeat(VOICE, 500), ...repeat(NOISE, 800), ...repeat(VOICE, 500)];
    assert.equal(run(frames).state, 'speaking');
  });

  it('話している範囲を返す', () => {
    const { range } = run([...repeat(NOISE, 500), ...repeat(VOICE, 1000), ...repeat(NOISE, 1200)]);
    assert.deepEqual(range, { startMs: 500, endMs: 1500 });
  });

  it('話さないまま10秒たったら、聞き取れなかったことにする', () => {
    assert.equal(run(repeat(NOISE, 9950)).state, 'waiting');
    assert.equal(run(repeat(NOISE, 10_000)).state, 'no-speech');
  });

  it('話し続けても、15秒で区切る', () => {
    assert.equal(run([...repeat(NOISE, 500), ...repeat(VOICE, 14_500)]).state, 'end');
  });

  it('周囲がうるさくても、それより大きな声を見つける', () => {
    assert.equal(run([...repeat(0.03, 500), ...repeat(0.15, 300)]).state, 'speaking');
    assert.equal(run(repeat(0.03, 1000)).state, 'waiting');
  });

  it('マイクを開いた瞬間から話していても見つける', () => {
    assert.equal(run([...repeat(NOISE, 50), ...repeat(VOICE, 500)]).state, 'speaking');
  });
});

describe('対応の判定', () => {
  it('必要な機能がそろっていれば対応とする', () => {
    useMicrophone();
    assert.equal(isDeviceSpeechSupported(), true);
  });

  it('マイクを使えなければ対応なしとする', () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    assert.equal(isDeviceSpeechSupported(), false);
  });
});

// 読み込みの状態はアプリの動いている間ずっと残るので、失敗の確認を先に行う。
describe('音声認識モデルの読み込み', () => {
  it('読み込めなければ失敗を返し、次の学習でやり直せる', async () => {
    const preparing = prepareDeviceSpeech();
    const first = FakeWorker.instances.at(-1);
    first.receive({ type: 'error', message: 'download failed' });
    await assert.rejects(preparing, /download failed/);
    assert.equal(first.terminated, true);

    const again = prepareDeviceSpeech();
    assert.notEqual(FakeWorker.instances.at(-1), first);
    FakeWorker.instances.at(-1).receive({ type: 'error', message: 'still failing' });
    await assert.rejects(again, /still failing/);
  });

  it('Worker を起動できなくても失敗を返す', async () => {
    const preparing = prepareDeviceSpeech();
    FakeWorker.instances.at(-1).onerror({ message: 'import failed' });
    await assert.rejects(preparing, /import failed/);
  });

  it('ダウンロードの進み具合を、ファイルの合計で知らせる', async () => {
    const progress = [];
    const preparing = prepareDeviceSpeech((bytes) => progress.push(bytes));
    const worker = FakeWorker.instances.at(-1);
    worker.receive({ type: 'progress', file: 'a', loaded: 10 });
    worker.receive({ type: 'progress', file: 'b', loaded: 5 });
    worker.receive({ type: 'progress', file: 'a', loaded: 20 });
    assert.deepEqual(progress, [10, 15, 25]);
    worker.loadedForTest = true;
    worker.receive({ type: 'loaded' });
    await preparing;
  });

  it('2回目は読み込み直さない', async () => {
    const count = FakeWorker.instances.length;
    await prepareDeviceSpeech();
    assert.equal(FakeWorker.instances.length, count);
  });
});

describe('録音と文字への変換', () => {
  it('タップの処理の中で音声の処理を動かす', async () => {
    const { context } = await listen();
    assert.equal(context.resumed, true);
  });

  it('音が届き始めたら知らせる', async () => {
    const { calls, context } = await listen();
    assert.equal(calls.ready, 0);
    emit(context, NOISE, 2);
    assert.equal(calls.ready, 1);
  });

  it('話し終えたら 16kHz の音声を変換して、結果を返す', async () => {
    const worker = await loadedWorker();
    const { calls, context } = await listen();
    speakAndFinish(context);
    await settle();
    assert.equal(calls.processing, 1);
    const request = lastRequest(worker);
    // 話した1秒に、前は録音の始めまでの0.2秒、後ろは0.3秒を足した長さになる。
    assert.equal(request.audio.length, 16_000 * 1.5);
    worker.receive({ type: 'result', id: request.id, text: ' I am a student. ', elapsedMs: 800 });
    await settle();
    assert.deepEqual(calls.results, [['I am a student.']]);
    assert.equal(calls.errors.length, 0);
  });

  it('話し終えたらマイクを手放す', async () => {
    let stream;
    const { context } = await listen(async () => {
      stream = makeStream();
      return stream;
    });
    speakAndFinish(context);
    assert.equal(stream.track.stopped, true);
    assert.equal(context.closed, true);
    assert.equal(context.processor.disconnected, true);
  });

  it('話し終えるボタンで、そこまでの音声を変換する', async () => {
    const worker = await loadedWorker();
    const { recognizer, context } = await listen();
    const before = lastRequest(worker);
    emit(context, NOISE, 4);
    emit(context, VOICE, 10);
    recognizer.stop();
    await settle();
    assert.notEqual(lastRequest(worker), before);
  });

  it('何も話さずに話し終えるボタンを押したら、聞き取れなかったことにする', async () => {
    const { recognizer, calls, context } = await listen();
    emit(context, NOISE, 4);
    recognizer.stop();
    await settle();
    assert.deepEqual(calls.errors, [{ kind: 'no-speech', code: 'stop' }]);
  });

  it('話さないまま時間が過ぎたら、聞き取れなかったことにする', async () => {
    const { calls, context } = await listen();
    emit(context, NOISE, 200);
    assert.deepEqual(calls.errors, [{ kind: 'no-speech', code: 'silence' }]);
  });

  it('変換の結果が空なら、聞き取れなかったことにする', async () => {
    const worker = await loadedWorker();
    const { calls, context } = await listen();
    speakAndFinish(context);
    await settle();
    worker.receive({ type: 'result', id: lastRequest(worker).id, text: '  ', elapsedMs: 800 });
    await settle();
    assert.deepEqual(calls.errors, [{ kind: 'no-speech', code: 'empty' }]);
  });

  it('変換に失敗したら、エラーとして返す', async () => {
    const worker = await loadedWorker();
    const { calls, context } = await listen();
    speakAndFinish(context);
    await settle();
    worker.receive({ type: 'error', id: lastRequest(worker).id, message: 'out of memory' });
    await settle();
    assert.deepEqual(calls.errors, [{ kind: 'unsupported', code: 'transcribe' }]);
  });

  it('変換が終わらなくても、学習が止まらない', async () => {
    await loadedWorker();
    const { calls, context } = await listen();
    speakAndFinish(context);
    await settle();
    mock.timers.tick(30_000);
    await settle();
    assert.deepEqual(calls.errors, [{ kind: 'unsupported', code: 'transcribe' }]);
  });

  it('打ち切った後は結果を返さず、マイクを手放す', async () => {
    const worker = await loadedWorker();
    let stream;
    const { recognizer, calls, context } = await listen(async () => {
      stream = makeStream();
      return stream;
    });
    speakAndFinish(context);
    await settle();
    recognizer.abort();
    worker.receive({ type: 'result', id: lastRequest(worker).id, text: 'late', elapsedMs: 800 });
    await settle();
    assert.deepEqual(calls.results, []);
    assert.equal(stream.track.stopped, true);
  });

  it('話し始めを、マイクが音を拾い始めてから話し始めるまでの時間で1回だけ知らせる', async () => {
    const { recognizer, calls, context } = await listen();
    emit(context, NOISE, 4);
    emit(context, VOICE, 2);
    // 物音と区別するため、大きな音が続くまでは話し始めとみなさない。
    assert.deepEqual(calls.speechStart, []);
    emit(context, VOICE, 1);
    // 1回分は 50 ミリ秒。静かな4回の後に話し始めたので 200 ミリ秒。
    assert.deepEqual(calls.speechStart, [200]);
    emit(context, NOISE, 2);
    emit(context, VOICE, 4);
    assert.deepEqual(calls.speechStart, [200]);
    recognizer.abort();
  });

  it('許可の確認中に打ち切ったら、後から開いたマイクも閉じる', async () => {
    let finishOpening;
    const stream = makeStream();
    useMicrophone(() => new Promise((resolve) => { finishOpening = resolve; }));
    const recognizer = createDeviceRecognizer({ onResult() {}, onError() {} });
    recognizer.start();
    recognizer.abort();
    finishOpening(stream);
    await settle();
    assert.equal(stream.track.stopped, true);
  });

  it('マイクを許可されなければ denied を返す', async () => {
    const { calls } = await listen(async () => { throw new DOMException('no', 'NotAllowedError'); });
    assert.deepEqual(calls.errors, [{ kind: 'denied', code: 'NotAllowedError' }]);
  });

  it('マイクを開けなければ no-mic を返す', async () => {
    const { calls } = await listen(async () => { throw new DOMException('none', 'NotFoundError'); });
    assert.deepEqual(calls.errors, [{ kind: 'no-mic', code: 'NotFoundError' }]);
  });

  it('マイクを開いても音が届かなければ no-mic を返す', async () => {
    const { calls } = await listen();
    mock.timers.tick(6000);
    assert.deepEqual(calls.errors, [{ kind: 'no-mic', code: 'no-frames' }]);
  });

  describe('話している途中の文字', () => {
    const requestsOf = (worker) => worker.sent.filter(({ type }) => type === 'transcribe');
    const answer = async (worker, text) => {
      worker.receive({ type: 'result', id: lastRequest(worker).id, text, elapsedMs: 500 });
      await settle();
    };

    /** 話し始めて、最初の途中経過の変換が始まるところまで進める。 */
    async function startInterim() {
      const worker = await loadedWorker();
      const before = requestsOf(worker).length;
      const session = await listen();
      emit(session.context, NOISE, 4);
      emit(session.context, VOICE, 18);
      assert.equal(requestsOf(worker).length, before + 1);
      return { worker, before, ...session };
    }

    it('話し始めてすぐは変換しない', async () => {
      const worker = await loadedWorker();
      const before = requestsOf(worker).length;
      const { context } = await listen();
      emit(context, NOISE, 4);
      emit(context, VOICE, 10);
      assert.equal(requestsOf(worker).length, before);
    });

    it('話している途中の文字を知らせる', async () => {
      const { worker, calls } = await startInterim();
      await answer(worker, ' I am ');
      assert.deepEqual(calls.interim, ['I am']);
    });

    it('前の変換が終わるまで、次の変換を始めない', async () => {
      const { worker, before, context } = await startInterim();
      emit(context, VOICE, 20);
      assert.equal(requestsOf(worker).length, before + 1);
    });

    it('前の変換が終わったら、少し間をあけて次を始める', async () => {
      const { worker, before, context } = await startInterim();
      await answer(worker, 'I am');
      emit(context, VOICE, 5);
      assert.equal(requestsOf(worker).length, before + 1);
      emit(context, VOICE, 2);
      assert.equal(requestsOf(worker).length, before + 2);
    });

    it('話している部分だけを変換に渡す', async () => {
      const { worker } = await startInterim();
      // その時点で録音できている1.05秒分を渡す。
      assert.equal(lastRequest(worker).audio.length, 16_000 * 1.05);
    });

    it('話し声が止まったら、最後に話した部分までを変換して、それ以上は繰り返さない', async () => {
      const { worker, before, context } = await startInterim();
      await answer(worker, 'I am');
      emit(context, NOISE, 10);
      assert.equal(requestsOf(worker).length, before + 2);
      await answer(worker, 'I am a');
      emit(context, NOISE, 12);
      assert.equal(requestsOf(worker).length, before + 2);
    });

    it('空の途中経過は知らせない', async () => {
      const { worker, calls } = await startInterim();
      await answer(worker, '  ');
      assert.deepEqual(calls.interim, []);
    });

    it('録音が終わった後に届いた途中経過は無視し、最終結果で判定する', async () => {
      const { worker, before, calls, context } = await startInterim();
      const interimId = lastRequest(worker).id;
      emit(context, VOICE, 2);
      emit(context, NOISE, 24);
      await settle();
      assert.equal(requestsOf(worker).length, before + 2);
      worker.receive({ type: 'result', id: interimId, text: 'I am', elapsedMs: 500 });
      await answer(worker, 'I am a student.');
      assert.deepEqual(calls.interim, []);
      assert.deepEqual(calls.results, [['I am a student.']]);
    });

    it('途中経過の変換に失敗しても、最終結果で判定する', async () => {
      const { worker, calls, context } = await startInterim();
      worker.receive({ type: 'error', id: lastRequest(worker).id, message: 'busy' });
      await settle();
      emit(context, NOISE, 24);
      await settle();
      await answer(worker, 'I am a student.');
      assert.deepEqual(calls.errors, []);
      assert.deepEqual(calls.results, [['I am a student.']]);
    });

    it('途中経過の変換に失敗したら、その回はこれ以上変換しない', async () => {
      const { worker, before, context } = await startInterim();
      worker.receive({ type: 'error', id: lastRequest(worker).id, message: 'busy' });
      await settle();
      emit(context, VOICE, 40);
      assert.equal(requestsOf(worker).length, before + 1);
    });

    it('打ち切った後は途中経過を知らせない', async () => {
      const { worker, recognizer, calls } = await startInterim();
      recognizer.abort();
      await answer(worker, 'I am');
      assert.deepEqual(calls.interim, []);
    });
  });

  it('続けて何度でも録音できる', async () => {
    const worker = await loadedWorker();
    for (const text of ['first', 'second', 'third']) {
      const { calls, context } = await listen();
      speakAndFinish(context);
      await settle();
      worker.receive({ type: 'result', id: lastRequest(worker).id, text, elapsedMs: 800 });
      await settle();
      assert.deepEqual(calls.results, [[text]]);
    }
  });
});
