/**
 * 模範解答の音声ファイルを作る。問題を追加したら実行する。すでにあるファイルは作り直さない。
 *
 * アプリには含まれない道具なので、使うときだけパッケージを入れる。
 *   npm install --no-save --no-package-lock kokoro-js @breezystack/lamejs
 *   node tools/generate-audio.mjs
 *
 * 音声合成には Kokoro-82M(Apache-2.0)を使う。初回はモデルをダウンロードする。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Mp3Encoder } from '@breezystack/lamejs';
import { KokoroTTS } from 'kokoro-js';
import { audioFileFor, SILENCE_FILE } from '../js/audio-files.js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const VOICE = 'af_heart';
const SPEED = 0.95;
const BIT_RATE_KBPS = 48;
const ENCODE_BLOCK = 1152;
const SILENCE_SAMPLE_RATE = 24_000;
const SILENCE_SECONDS = 0.1;

function encodeMp3(samples, sampleRate) {
  const encoder = new Mp3Encoder(1, sampleRate, BIT_RATE_KBPS);
  const pcm = Int16Array.from(samples, (sample) => Math.max(-1, Math.min(1, sample)) * 32767);
  const parts = [];
  for (let offset = 0; offset < pcm.length; offset += ENCODE_BLOCK) {
    parts.push(encoder.encodeBuffer(pcm.subarray(offset, offset + ENCODE_BLOCK)));
  }
  parts.push(encoder.flush());
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

function save(file, samples, sampleRate) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, encodeMp3(samples, sampleRate));
}

const questions = JSON.parse(readFileSync('data/questions.json', 'utf8'));
const texts = [...new Set(questions.flatMap((question) => question.answers))];
const missing = texts.filter((text) => !existsSync(audioFileFor(text)));

if (!existsSync(SILENCE_FILE)) {
  save(SILENCE_FILE, new Float32Array(SILENCE_SAMPLE_RATE * SILENCE_SECONDS), SILENCE_SAMPLE_RATE);
}

console.log(`${texts.length}文のうち、${missing.length}文を作ります。`);
if (missing.length > 0) {
  const speaker = await KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'cpu' });
  for (const [index, text] of missing.entries()) {
    const { audio, sampling_rate: sampleRate } = await speaker.generate(text, { voice: VOICE, speed: SPEED });
    save(audioFileFor(text), audio, sampleRate);
    console.log(`${index + 1}/${missing.length} ${text}`);
  }
}
