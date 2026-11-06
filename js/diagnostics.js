/**
 * 端末の判別と、調査用の記録をまとめる。
 * 実機でしか起きない問題は、ここに残した出来事の順番から調べる。
 */

const EVENT_LOG_LIMIT = 40;

const eventLog = [];

/** iPhone と iPad を判別する。iPadOS の Safari は Mac として名乗るため、タッチ操作の有無も見る。 */
export function isIOS() {
  const { userAgent = '', platform = '', maxTouchPoints = 0 } = globalThis.navigator ?? {};
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

export function logEvent(label) {
  eventLog.push(label);
  if (eventLog.length > EVENT_LOG_LIMIT) eventLog.shift();
}

/** 端末の種類、ブラウザの版、起きた出来事の順に並べて返す。 */
export function diagnostics() {
  const version = /Version\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? '?';
  return [`${isIOS() ? 'iOS' : 'PC'} Safari/${version}`, ...eventLog].join(' ');
}
