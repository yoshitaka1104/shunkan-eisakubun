/**
 * 端末の中で英語を文字に変換する音声認識。
 *
 * iOS 27 の Safari は、標準の音声認識が2回目以降に音を受け取らなくなる
 * (https://bugs.webkit.org/show_bug.cgi?id=321436)。実機の診断でも回避策が見つからなかったため、
 * iPhone と iPad ではマイクの録音と文字への変換をこのアプリで行う。
 * 録音した音声は端末の外へ送らない。
 */
import { logEvent } from './diagnostics.js';

const MODEL = 'onnx-community/moonshine-base-ONNX';
const MODEL_TYPES = { encoder_model: 'q8', decoder_model_merged: 'q8' };

/** 音声認識モデルが受け取る音声の形式。 */
const TARGET_SAMPLE_RATE = 16_000;
const FRAME_SIZE = 2048;

/** これより小さい音は、周囲が静かでも話し声として扱わない。 */
const MIN_SPEECH_LEVEL = 0.008;
/** 周囲の音の何倍の大きさなら話し声とみなすか。 */
const NOISE_MARGIN = 3;
/** 録音の最初の音から周囲の音を見積もるときの上限。これより大きな音は話し声の可能性が高い。 */
const MAX_INITIAL_NOISE = 0.02;
/** 物音を話し声と間違えないよう、大きな音がこの時間続いてから話し始めとみなす。 */
const SPEECH_CONFIRM_MS = 120;
/** 話し声が止まってから、話し終えたとみなすまでの時間。 */
const END_SILENCE_MS = 1200;
/** 話し始めを待つ時間。 */
const NO_SPEECH_LIMIT_MS = 10_000;
/** 1回の回答で録音する最長の時間。 */
const MAX_LISTEN_MS = 15_000;
/** 話し声の前後に残す時間。語頭と語尾が切れないようにする。 */
const SPEECH_PADDING_MS = 300;
/** マイクを開いてから、音が届き始めるまで待つ時間。 */
const FIRST_FRAME_LIMIT_MS = 6000;
/** 文字への変換を待つ時間。 */
const TRANSCRIBE_LIMIT_MS = 30_000;
/** 話し始めてから、最初の途中経過を出すまでの時間。短すぎる音声は誤変換が多い。 */
const INTERIM_FIRST_DELAY_MS = 700;
/** 途中経過の変換が終わってから、次を始めるまでの時間。電池の消費と発熱を抑える。 */
const INTERIM_GAP_MS = 300;

export function isDeviceSpeechSupported() {
  return Boolean(
    globalThis.navigator?.mediaDevices?.getUserMedia
    && audioContextClass()
    && globalThis.Worker
    && globalThis.WebAssembly,
  );
}

function audioContextClass() {
  return globalThis.AudioContext ?? globalThis.webkitAudioContext;
}

export function rootMeanSquare(samples) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** 音声の長さを変えずに、サンプリングレートを下げる。 */
export function downsample(samples, fromRate, toRate = TARGET_SAMPLE_RATE) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.floor(samples.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const from = Math.floor(index * ratio);
    const to = Math.max(from + 1, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let position = from; position < to; position += 1) sum += samples[position];
    output[index] = sum / (to - from);
  }
  return output;
}

/** 音声から、話している部分の前後を残して切り出す。 */
export function trimToSpeech(samples, sampleRate, { startMs, endMs }) {
  const toIndex = (ms) => Math.round((ms / 1000) * sampleRate);
  const from = Math.max(0, toIndex(startMs - SPEECH_PADDING_MS));
  const to = Math.min(samples.length, toIndex(endMs + SPEECH_PADDING_MS));
  return samples.subarray(from, to);
}

/**
 * 音量の変化から、話し始めと話し終わりを見つける。
 * 周囲の音の大きさを追いながら判定するので、多少うるさい場所でも動く。
 */
export function createEndpointDetector() {
  let elapsedMs = 0;
  let loudMs = 0;
  let quietMs = 0;
  let noise = null;
  let speechStartMs = null;
  let speechEndMs = 0;

  return {
    /**
     * 音量を1回分受け取り、今の状態を返す。
     * @returns {'waiting'|'speaking'|'end'|'no-speech'}
     */
    feed(level, frameMs) {
      // 最初の音がすでに話し声だと、その大きさを周囲の音とみなして話し始めを見逃す。
      // 周囲の音の見積もりは上限から始め、本当にうるさい場所なら静かな間に少しずつ上げる。
      noise ??= Math.min(level, MAX_INITIAL_NOISE);
      const threshold = Math.max(MIN_SPEECH_LEVEL, noise * NOISE_MARGIN);
      elapsedMs += frameMs;
      if (level >= threshold) {
        loudMs += frameMs;
        quietMs = 0;
        speechEndMs = elapsedMs;
        if (speechStartMs === null && loudMs >= SPEECH_CONFIRM_MS) speechStartMs = elapsedMs - loudMs;
      } else {
        loudMs = 0;
        quietMs += frameMs;
        noise = Math.min(level, noise * 1.05);
      }
      if (speechStartMs === null) return elapsedMs >= NO_SPEECH_LIMIT_MS ? 'no-speech' : 'waiting';
      return quietMs >= END_SILENCE_MS || elapsedMs >= MAX_LISTEN_MS ? 'end' : 'speaking';
    },
    /** 話している部分の範囲。話し声がなければ null。 */
    speechRange() {
      return speechStartMs === null ? null : { startMs: speechStartMs, endMs: speechEndMs };
    },
  };
}

let worker = null;
let preparation = null;
let nextRequestId = 1;
const requests = new Map();

function failAllRequests(error) {
  requests.forEach(({ reject }) => reject(error));
  requests.clear();
}

/** 読み込みに失敗したら作り直せるよう、状態を捨てる。 */
function resetWorker() {
  worker?.terminate();
  worker = null;
  preparation = null;
}

function loadModel(onProgress) {
  return new Promise((resolve, reject) => {
    const loadedBytes = new Map();
    worker = new Worker(new URL('./transcribe-worker.js?v=1.9.1', import.meta.url), { type: 'module' });
    worker.onerror = (event) => {
      const error = new Error(event.message || 'worker failed');
      reject(error);
      failAllRequests(error);
    };
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        loadedBytes.set(data.file, data.loaded);
        onProgress([...loadedBytes.values()].reduce((sum, bytes) => sum + bytes, 0));
      } else if (data.type === 'loaded') {
        resolve();
      } else if (data.type === 'result') {
        requests.get(data.id)?.resolve(data);
        requests.delete(data.id);
      } else if (data.type === 'error') {
        const error = new Error(data.message);
        if (data.id === undefined) reject(error);
        requests.get(data.id)?.reject(error);
        requests.delete(data.id);
      }
    };
    worker.postMessage({ type: 'load', model: MODEL, dtype: MODEL_TYPES });
  });
}

/**
 * 音声認識モデルを読み込む。2回目からはすぐに終わる。
 * @param {(loadedBytes: number) => void} onProgress
 */
export function prepareDeviceSpeech(onProgress = () => {}) {
  preparation ??= loadModel(onProgress).catch((error) => {
    resetWorker();
    throw error;
  });
  return preparation;
}

function transcribe(audio) {
  return new Promise((resolve, reject) => {
    const id = nextRequestId;
    nextRequestId += 1;
    const limit = setTimeout(() => {
      requests.delete(id);
      reject(new Error('transcribe timeout'));
    }, TRANSCRIBE_LIMIT_MS);
    requests.set(id, {
      resolve: (result) => {
        clearTimeout(limit);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(limit);
        reject(error);
      },
    });
    worker.postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
  });
}

function concatenate(chunks) {
  const output = new Float32Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

let recognitionCount = 0;

/**
 * 1回分の音声認識を作る。speech.js の認識と同じ形で使える。
 *
 * onResult か onError のどちらかが、必ず1回だけ呼ばれる(abort した場合を除く)。
 * start は画面のタップの処理の中で呼ぶ。iOS は操作なしでは音声の処理を始められない。
 *
 * 録音中は、そこまでの音声を繰り返し変換して onInterim で知らせる。
 * 前の変換が終わってから次を始めるので、端末が遅くても変換待ちはたまらない。
 *
 * @param {object} handlers
 * @param {() => void} [handlers.onReady] マイクが音を拾い始めたとき。
 * @param {(msAfterReady: number) => void} [handlers.onSpeechStart] 話し始めたとき。マイクが音を拾い始めてから話し始めるまでの時間を渡す。
 * @param {(text: string) => void} [handlers.onInterim] 話している途中の英文。後から変わることがある。
 * @param {() => void} [handlers.onProcessing] 録音を終え、文字への変換を始めたとき。
 * @param {(candidates: string[]) => void} handlers.onResult
 * @param {(kind: 'no-speech'|'denied'|'no-mic'|'unsupported', code: string) => void} handlers.onError
 */
export function createDeviceRecognizer({
  onReady = () => {},
  onSpeechStart = () => {},
  onInterim = () => {},
  onProcessing = () => {},
  onResult,
  onError,
}) {
  recognitionCount += 1;
  logEvent(`#${recognitionCount}`);

  const startedAt = performance.now();
  const chunks = [];
  const detector = createEndpointDetector();
  let context = null;
  let stream = null;
  let processor = null;
  let sampleRate = 0;
  let peak = 0;
  let speechNoted = false;
  let capturing = true;
  let canceled = false;
  let firstFrameTimer = null;
  let recordedMs = 0;
  let nextInterimMs = Infinity;
  let interimBusy = false;
  let interimCount = 0;
  let interimSpeechEndMs = 0;

  const note = (label) => logEvent(`${label}@${Math.round(performance.now() - startedAt)}`);

  /** 話している部分を切り出して、変換に渡せる形にする。 */
  const speechAudio = () => {
    const speech = trimToSpeech(concatenate(chunks), sampleRate, detector.speechRange());
    return downsample(speech, sampleRate).slice();
  };

  const releaseMicrophone = () => {
    capturing = false;
    clearTimeout(firstFrameTimer);
    if (processor) processor.onaudioprocess = null;
    processor?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    context?.close().catch(() => {});
    logEvent(`peak=${peak.toFixed(3)}`);
  };

  const fail = (kind, code) => {
    if (!capturing) return;
    note(`error:${code}`);
    releaseMicrophone();
    onError(kind, code);
  };

  const finishRecording = async () => {
    if (!capturing) return;
    note('recorded');
    releaseMicrophone();
    if (!detector.speechRange()) {
      onError('no-speech', 'stop');
      return;
    }
    onProcessing();
    try {
      const { text, elapsedMs } = await transcribe(speechAudio());
      logEvent(`stt=${elapsedMs}ms interim=${interimCount}`);
      if (canceled) return;
      if (text.trim()) onResult([text.trim()]);
      else onError('no-speech', 'empty');
    } catch (error) {
      logEvent(`stt-error:${error.message}`);
      if (!canceled) onError('unsupported', 'transcribe');
    }
  };

  /** 前の変換より後に話した部分があり、次の変換を始められるとき true。 */
  const canUpdateInterim = () => !interimBusy
    && recordedMs >= nextInterimMs
    && detector.speechRange().endMs > interimSpeechEndMs;

  const updateInterim = async () => {
    interimBusy = true;
    interimSpeechEndMs = detector.speechRange().endMs;
    try {
      const { text } = await transcribe(speechAudio());
      interimCount += 1;
      if (capturing && text.trim()) onInterim(text.trim());
      nextInterimMs = recordedMs + INTERIM_GAP_MS;
      interimBusy = false;
    } catch (error) {
      // 途中経過が出なくても判定はできるので、この回はこれ以上変換しない。
      logEvent(`interim-error:${error.message}`);
    }
  };

  const handleFrame = ({ inputBuffer }) => {
    if (!capturing) return;
    if (!sampleRate) {
      sampleRate = inputBuffer.sampleRate;
      clearTimeout(firstFrameTimer);
      note(`mic:${sampleRate}`);
      onReady();
    }
    const samples = new Float32Array(inputBuffer.getChannelData(0));
    chunks.push(samples);
    const level = rootMeanSquare(samples);
    peak = Math.max(peak, level);
    const frameMs = (samples.length / sampleRate) * 1000;
    recordedMs += frameMs;
    const state = detector.feed(level, frameMs);
    if (detector.speechRange() && !speechNoted) {
      speechNoted = true;
      nextInterimMs = recordedMs + INTERIM_FIRST_DELAY_MS;
      note('speech');
      // 判定には少し遅れて気づくので、録音の中で話し始めた位置を渡す。
      onSpeechStart(detector.speechRange().startMs);
    }
    if (state === 'no-speech') fail('no-speech', 'silence');
    if (state === 'end') finishRecording();
    if (state === 'speaking' && canUpdateInterim()) updateInterim();
  };

  const connectMicrophone = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      if (capturing) fail(error.name === 'NotAllowedError' ? 'denied' : 'no-mic', error.name);
      return;
    }
    if (!capturing) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    processor = context.createScriptProcessor(FRAME_SIZE, 1, 1);
    processor.onaudioprocess = handleFrame;
    context.createMediaStreamSource(stream).connect(processor);
    // 接続しないと処理が動かない。出力は無音なので音は出ない。
    processor.connect(context.destination);
    firstFrameTimer = setTimeout(() => fail('no-mic', 'no-frames'), FIRST_FRAME_LIMIT_MS);
  };

  return {
    start() {
      // iOS で音声を処理するには、タップの処理の中で AudioContext を動かす必要がある。
      const AudioContextClass = audioContextClass();
      context = new AudioContextClass();
      context.resume().catch(() => {});
      connectMicrophone();
    },
    /** 話し終えたことを伝え、そこまでの音声で結果を出す。 */
    stop: finishRecording,
    /** 結果を受け取らずに打ち切る。 */
    abort() {
      canceled = true;
      if (capturing) releaseMicrophone();
    },
  };
}
