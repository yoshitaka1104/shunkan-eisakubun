/**
 * 端末の中で音声を文字に変換する Web Worker。
 * モデルの読み込みと変換は重いので、画面が固まらないよう別のスレッドで動かす。
 */
import { env, pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js';

env.allowLocalModels = false;
// GitHub Pages では複数スレッドに必要な SharedArrayBuffer を使えない。
env.backends.onnx.wasm.numThreads = 1;

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
  const { text } = await transcriber(audio);
  postMessage({ type: 'result', id, text, elapsedMs: Math.round(performance.now() - startedAt) });
}

const HANDLERS = { load, transcribe };

self.onmessage = async ({ data }) => {
  try {
    await HANDLERS[data.type](data);
  } catch (error) {
    postMessage({ type: 'error', id: data.id, message: String(error?.message ?? error) });
  }
};
