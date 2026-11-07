/**
 * 開発と個人利用のためのローカルサーバー。
 * マイクの利用には HTTPS か localhost が必要なため、外部パッケージなしで localhost に公開する。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 5173;
const URL_FOR_USER = `http://localhost:${PORT}`;
const SHOULD_OPEN = process.argv.includes('--open');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

/** 音声入力の対象は Chrome なので、入っていれば既定のブラウザより優先して開く。 */
function openBrowser() {
  const chrome = ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']
    .map((name) => process.env[name])
    .filter(Boolean)
    .map((directory) => join(directory, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    .find(existsSync);
  const [command, args] = chrome
    ? [chrome, [URL_FOR_USER]]
    : ['cmd', ['/c', 'start', '', URL_FOR_USER]];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

function resolveRequest(url) {
  const { pathname } = new URL(url, 'http://localhost');
  const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = resolve(ROOT, `.${relative}`);
  return file.startsWith(`${ROOT}${sep}`) ? file : null;
}

const server = createServer(async (request, response) => {
  try {
    const file = resolveRequest(request.url);
    const contentType = file && CONTENT_TYPES[extname(file)];
    if (!contentType) throw new Error('not served');
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  }
});

server.on('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.log(`ポート ${PORT} は使用中です。起動済みの場合は ${URL_FOR_USER} を開いてください。`);
  if (SHOULD_OPEN) openBrowser();
});

server.listen(PORT, HOST, () => {
  console.log(`瞬間英作文: ${URL_FOR_USER}`);
  console.log('使っている間は、この画面を開いたままにしてください。閉じるとアプリも止まります。');
  if (SHOULD_OPEN) openBrowser();
});
