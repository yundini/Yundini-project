import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { ROOT } from './paths.js';

export const setupState = { status: 'pending', message: '준비 전' };

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} 실패 (exit ${code})`)),
    );
  });
}

async function importPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return null;
  }
}

// Playwright 패키지와 Chromium 브라우저가 없으면 자동으로 설치한다.
export async function ensurePlaywright() {
  try {
    let pw = await importPlaywright();
    if (!pw) {
      setupState.status = 'installing';
      setupState.message = 'Playwright 패키지 설치 중...';
      console.log(setupState.message);
      await run('npm', ['install', 'playwright', '--no-audit', '--no-fund']);
      pw = await importPlaywright();
      if (!pw) throw new Error('Playwright 패키지를 불러오지 못했어요.');
    }

    if (!process.env.CHROMIUM_EXECUTABLE && !fs.existsSync(pw.chromium.executablePath())) {
      setupState.status = 'installing';
      setupState.message = 'Chromium 브라우저 설치 중... (처음 한 번, 1~2분 걸려요)';
      console.log(setupState.message);
      await run('npx', ['playwright', 'install', 'chromium']);
    }

    setupState.status = 'ready';
    setupState.message = 'Playwright 준비 완료';
    console.log(setupState.message);
  } catch (err) {
    setupState.status = 'error';
    setupState.message = `Playwright 설치 실패: ${err.message}`;
    console.error(setupState.message);
  }
}

export async function playwright() {
  if (setupState.status !== 'ready') {
    throw new Error(`Playwright가 아직 준비되지 않았어요 (${setupState.message})`);
  }
  return import('playwright');
}

// 특정 Chromium을 쓰고 싶을 때 CHROMIUM_EXECUTABLE 환경변수로 지정할 수 있다 (보통은 비워 둔다).
export const launchExtras = process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {};
