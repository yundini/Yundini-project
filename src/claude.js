import { spawn } from 'node:child_process';
import { DATA_DIR } from './paths.js';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const TIMEOUT_MS = 15 * 60 * 1000;

// `claude -p`(Claude Code 헤드리스 모드)로 AI를 호출한다.
// ANTHROPIC_API_KEY가 있으면 API 과금으로 넘어가므로 지워서 구독 요금제 로그인을 사용하게 한다.
export function runClaude(prompt, { allowedTools = [], addDirs = [], model = process.env.CLAUDE_MODEL } = {}) {
  const args = ['-p', '--output-format', 'json'];
  if (model) args.push('--model', model);
  if (allowedTools.length) args.push('--allowedTools', ...allowedTools);
  if (addDirs.length) args.push('--add-dir', ...addDirs);

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { cwd: DATA_DIR, env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('AI 응답 시간이 초과됐어요.'));
    }, TIMEOUT_MS);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        err.code === 'ENOENT'
          ? new Error('claude 명령을 찾을 수 없어요. Mac에 Claude Code를 설치하고 로그인해 주세요.')
          : err,
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        return reject(new Error(`claude 실행 실패 (exit ${code}): ${(stderr || stdout).slice(0, 500)}`));
      }
      if (parsed.is_error || parsed.subtype !== 'success') {
        return reject(new Error(`AI 오류: ${String(parsed.result || parsed.subtype).slice(0, 500)}`));
      }
      resolve(parsed.result);
    });

    child.stdin.end(prompt);
  });
}

// 응답 텍스트에서 JSON만 뽑아낸다 (```json 블록 또는 가장 바깥 { } / [ ]).
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  const start = [firstObj, firstArr].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (start !== undefined) {
    const close = text[start] === '{' ? '}' : ']';
    candidates.push(text.slice(start, text.lastIndexOf(close) + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* 다음 후보 시도 */
    }
  }
  throw new Error('AI 응답에서 JSON을 읽지 못했어요.');
}

export async function askClaudeJson(prompt, opts) {
  const text = await runClaude(prompt, opts);
  return extractJson(text);
}
