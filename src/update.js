import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, DATA_DIR } from './paths.js';

// GitHub 공개 저장소에서 새 버전을 받아 코드만 덮어쓴다.
// data/(글, 로그인 세션, 접속 코드)와 node_modules/는 건드리지 않는다.
const REPO = process.env.UPDATE_REPO || 'yundini/Yundini-project';
const VERSION_FILE = path.join(DATA_DIR, 'version.json');
const KEEP = new Set(['data', 'node_modules', '.git', '.runtime']);
export const RESTART_CODE = 42; // start.command가 이 종료 코드를 보면 앱을 다시 켠다

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  } catch {
    return { sha: null };
  }
}

async function github(pathname) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${pathname}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'blog-autopilot' },
  });
  if (res.status === 404) throw new Error('저장소를 찾을 수 없어요. GitHub 저장소가 공개(Public)인지 확인해 주세요.');
  if (!res.ok) throw new Error(`GitHub 응답 오류 (${res.status})`);
  return res.json();
}

async function latestCommit() {
  const repo = await github('');
  const branch = process.env.UPDATE_BRANCH || repo.default_branch;
  const commit = await github(`/commits/${encodeURIComponent(branch)}`);
  return { branch, sha: commit.sha, message: commit.commit.message.split('\n')[0], date: commit.commit.committer.date };
}

export async function checkUpdate() {
  const current = readVersion();
  const latest = await latestCommit();
  return { current: current.sha, latest, available: current.sha !== latest.sha };
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 실패 (exit ${code})`))));
  });
}

const fileHash = (file) => {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
};

// 파일마다 임시 파일에 쓴 뒤 이름을 바꿔서 교체한다.
// 실행 중인 start.command도 기존 파일을 계속 읽을 수 있어 안전하다.
function replaceTree(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) replaceTree(path.join(from, name), path.join(to, name));
    return;
  }
  const tmp = `${to}.updating`;
  fs.copyFileSync(from, tmp);
  fs.chmodSync(tmp, stat.mode);
  fs.renameSync(tmp, to);
}

export async function applyUpdate(log = console.log) {
  const latest = await latestCommit();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-update-'));
  try {
    log(`새 버전 받는 중... (${latest.message})`);
    const res = await fetch(`https://codeload.github.com/${REPO}/tar.gz/${latest.sha}`);
    if (!res.ok) throw new Error(`다운로드 실패 (${res.status}). 저장소가 공개(Public)인지 확인해 주세요.`);
    const archive = path.join(tmp, 'update.tar.gz');
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));

    const src = path.join(tmp, 'src');
    fs.mkdirSync(src);
    await run('tar', ['-xzf', archive, '-C', src, '--strip-components=1'], tmp);

    const depsBefore = fileHash(path.join(ROOT, 'package-lock.json'));
    for (const name of fs.readdirSync(src)) {
      if (KEEP.has(name)) continue;
      replaceTree(path.join(src, name), path.join(ROOT, name));
    }
    log('새 코드로 바꿨어요.');

    if (fileHash(path.join(ROOT, 'package-lock.json')) !== depsBefore) {
      log('필요한 패키지를 설치하는 중...');
      await run('npm', ['install', '--no-audit', '--no-fund'], ROOT);
    }

    fs.writeFileSync(VERSION_FILE, JSON.stringify({ sha: latest.sha, message: latest.message, updatedAt: new Date().toISOString() }, null, 2));
    return latest;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
