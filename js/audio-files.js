/**
 * 模範解答の音声ファイルの場所を決める。
 * アプリの再生と tools/generate-audio.mjs の生成で、同じ名前を使う。
 */

const AUDIO_DIRECTORY = 'audio';

/** 再生できる状態にするための、無音のファイル。 */
export const SILENCE_FILE = `${AUDIO_DIRECTORY}/silence.mp3`;

export function audioFileFor(text) {
  const name = text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${AUDIO_DIRECTORY}/${name}.mp3`;
}
