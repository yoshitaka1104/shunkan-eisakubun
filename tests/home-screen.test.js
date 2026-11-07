import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const manifest = JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
const index = readFileSync('index.html', 'utf8');

/** PNG の先頭にある幅と高さを読む。 */
function pngSize(file) {
  const bytes = readFileSync(file);
  assert.equal(bytes.toString('ascii', 1, 4), 'PNG', file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('ホーム画面のアプリ', () => {
  it('ホーム画面から開くと、ブラウザの枠なしで開く', () => {
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
  });

  it('名前が表示される', () => {
    assert.equal(manifest.name, '瞬間英作文');
    assert.ok(manifest.short_name.length <= 12);
    assert.match(index, /<meta name="apple-mobile-web-app-title" content="瞬間英作文">/);
  });

  it('アイコンの画像が、書かれた大きさで用意されている', () => {
    for (const icon of manifest.icons) {
      assert.ok(existsSync(icon.src), icon.src);
      const [width, height] = icon.sizes.split('x').map(Number);
      assert.deepEqual(pngSize(icon.src), { width, height }, icon.src);
    }
  });

  it('切り抜かれても欠けない版のアイコンがある', () => {
    assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  });

  it('iPhone 用のアイコンが 180px で用意されている', () => {
    assert.match(index, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon.png">/);
    assert.deepEqual(pngSize('icons/apple-touch-icon.png'), { width: 180, height: 180 });
  });

  it('ページから設定ファイルを読み込む', () => {
    assert.match(index, /<link rel="manifest" href="manifest.webmanifest">/);
  });

  it('ローカルサーバーがアイコンと設定ファイルを配信する', () => {
    const server = readFileSync('server.js', 'utf8');
    assert.match(server, /'\.png': 'image\/png'/);
    assert.match(server, /'\.webmanifest': 'application\/manifest\+json/);
  });
});
