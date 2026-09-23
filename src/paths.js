import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const PROFILE_DIR = path.join(DATA_DIR, 'naver-profile'); // 네이버 로그인 세션(쿠키) 저장 위치
export const LOG_DIR = path.join(DATA_DIR, 'logs');

for (const dir of [DATA_DIR, UPLOAD_DIR, PROFILE_DIR, LOG_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
