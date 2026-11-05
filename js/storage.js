/**
 * 学習記録を端末内(localStorage)に保存する。
 * 保存できない環境でも学習は続けられるよう、失敗は握りつぶす。
 */
import { emptyProgress } from './progress.js';

const STORAGE_KEY = 'shunkan-eisakubun.progress.v1';

export function loadProgress() {
  const defaults = emptyProgress();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored) return defaults;
    return { ...defaults, ...stored, settings: { ...defaults.settings, ...stored.settings } };
  } catch {
    return defaults;
  }
}

export function saveProgress(progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // 保存できなくても、その回の学習は続ける。
  }
}
