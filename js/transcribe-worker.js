/**
 * 端末の中で音声を文字に変換する Web Worker。
 * モデルの読み込みと変換は重いので、画面が固まらないよう別のスレッドで動かす。
 */
import { env, pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js';

env.allowLocalModels = false;
// GitHub Pages では複数スレッドに必要な SharedArrayBuffer を使えない。
env.backends.onnx.wasm.numThreads = 1;

/** モデルが受け取る音声のサンプリングレート。 */
const SAMPLE_RATE = 16_000;
/**
 * 書き出す語の数の上限は、音声1秒あたりこの数にする。同じ語を繰り返し続けるのを防ぐための上限。
 * transformers.js の既定は「秒の整数部 x 6」で、2秒に満たない回答は6語で切れてしまう。
 */
const TOKENS_PER_SECOND = 6;
const EXTRA_TOKENS = 8;

let transcriber = null;

async function load({ model, dtype }) {
  transcriber = await pipeline('automatic-speech-recognition', model, {
    device: 'wasm',
    dtype,
    progress_callback: ({ status, file, loaded, total }) => {
      if (status === 'progress') postMessage({ type: 'progress', file, loaded, total });
    },
  });
  postMessage({ type: 'loaded' });
}

async function transcribe({ id, audio }) {
  const startedAt = performance.now();
  const { text } = await transcriber(audio, {
    max_new_tokens: Math.ceil((audio.length / SAMPLE_RATE) * TOKENS_PER_SECOND) + EXTRA_TOKENS,
    // 話し声があっても、何も書かずに終えることがある。最初の1語は必ず書かせる。
    min_new_tokens: 1,
  });
  postMessage({ type: 'result', id, text, elapsedMs: Math.round(performance.now() - startedAt) });
}

const HANDLERS = { load, transcribe };

let queue = Promise.resolve();

async function handle(data) {
  try {
    await HANDLERS[data.type](data);
  } catch (error) {
    postMessage({ type: 'error', id: data.id, message: String(error?.message ?? error) });
  }
}

// モデルは同時に1件しか動かせないので、途中経過と最終結果を順番に処理する。
self.onmessage = ({ data }) => {
  queue = queue.then(() => handle(data));
};
