/**
 * 学習記録を端末内(localStorage)に保存する。
 * 保存できない環境でも学習は続けられるよう、失敗は握りつぶす。
 *
 * iPhone の Safari は、Safari を使った日数で7日間サイトを操作しないと、保存したデータを消す。
 * ホーム画面に追加したアプリは対象外とされているため、その開き方かどうかと、保存の保護の状態を返す。
 * https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
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

/** ホーム画面に追加したアプリとして開いているか。 */
export function isStandalone() {
  return globalThis.navigator?.standalone === true
    || globalThis.matchMedia?.('(display-mode: standalone)').matches === true;
}

/**
 * データを消されにくくするよう、ブラウザに申請する。
 * 許可はブラウザが判断し、Safari はホーム画面のアプリで認めやすいとしている。
 * @returns {Promise<boolean|null>} 認められたら true。対応していなければ null。
 */
export async function requestPersistentStorage() {
  if (!globalThis.navigator?.storage?.persist) return null;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** @returns {Promise<boolean|null>} 保護されていれば true。対応していなければ null。 */
export async function isStoragePersisted() {
  if (!globalThis.navigator?.storage?.persisted) return null;
  try {
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}
