import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT } from './paths.js';

export const setupState = { status: 'pending', message: '준비 전', browser: null };

// Playwright가 받는 Chromium 대신 쓸 수 있는, Mac에 이미 설치된 브라우저
const SYSTEM_BROWSERS = [
  { channel: 'chrome', name: 'Google Chrome', app: 'Google Chrome.app/Contents/MacOS/Google Chrome' },
  { channel: 'msedge', name: 'Microsoft Edge', app: 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
];

let launchOptions = process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {};

// 브라우저를 띄울 때 넣을 옵션 (Chromium 경로 또는 Chrome/Edge 채널)
export const launchExtras = () => launchOptions;

// 명령을 실행하고, 실패하면 출력의 마지막 부분을 오류 메시지에 담는다.
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: process.env });
    let output = '';
    const collect = (stream, out) =>
      stream.on('data', (d) => {
        out.write(d);
        output = (output + d).slice(-4000);
      });
    collect(child.stdout, process.stdout);
    collect(child.stderr, process.stderr);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      const tail = output
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^at /.test(l) && !/^[|#=\s]*$/.test(l) && !/\d+%/.test(l))
        .slice(-3)
        .join(' / ');
      reject(new Error(tail || `exit ${code}`));
    });
  });
}

async function importPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return null;
  }
}

function findSystemBrowser() {
  if (process.platform !== 'darwin') return null;
  for (const b of SYSTEM_BROWSERS) {
    for (const dir of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      if (fs.existsSync(path.join(dir, b.app))) return b;
    }
  }
  return null;
}

function setState(status, message) {
  setupState.status = status;
  setupState.message = message;
  (status === 'error' ? console.error : console.log)(message);
}

// Playwright 패키지와 브라우저를 준비한다.
// Chromium 자동 설치가 실패하면 Mac에 설치된 Chrome/Edge를 대신 사용한다.
export async function ensurePlaywright() {
  if (setupState.status === 'installing') return;
  try {
    let pw = await importPlaywright();
    if (!pw) {
      setState('installing', 'Playwright 패키지 설치 중...');
      await run('npm', ['install', 'playwright', '--no-audit', '--no-fund']);
      pw = await importPlaywright();
      if (!pw) throw new Error('Playwright 패키지를 불러오지 못했어요.');
    }

    if (process.env.CHROMIUM_EXECUTABLE || fs.existsSync(pw.chromium.executablePath())) {
      setupState.browser = 'Chromium';
      return setState('ready', 'Playwright 준비 완료');
    }

    setState('installing', 'Chromium 브라우저 설치 중... (처음 한 번, 1~2분 걸려요)');
    const cli = path.join(path.dirname(fileURLToPath(import.meta.resolve('playwright/package.json'))), 'cli.js');
    let installError = null;
    try {
      await run(process.execPath, [cli, 'install', 'chromium']);
    } catch (err) {
      installError = err;
    }

    if (!installError && fs.existsSync(pw.chromium.executablePath())) {
      setupState.browser = 'Chromium';
      launchOptions = {};
      return setState('ready', 'Playwright 준비 완료');
    }

    const fallback = findSystemBrowser();
    if (fallback) {
      setupState.browser = fallback.name;
      launchOptions = { channel: fallback.channel };
      return setState('ready', `Playwright 준비 완료 (${fallback.name} 사용)`);
    }

    throw new Error(
      `Chromium 설치 실패 (${installError?.message || '알 수 없는 오류'}). ` +
        'Mac에 Google Chrome을 설치하면 Chrome으로 대신 동작해요. 설치 후 이 버튼을 눌러 다시 시도하세요.',
    );
  } catch (err) {
    setState('error', `브라우저 준비 실패: ${err.message}`);
  }
}

export async function playwright() {
  if (setupState.status !== 'ready') {
    throw new Error(`브라우저가 아직 준비되지 않았어요 (${setupState.message})`);
  }
  return import('playwright');
}
