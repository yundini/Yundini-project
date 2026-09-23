import crypto from 'node:crypto';

// 오래 걸리는 작업(글감 수집, AI 글쓰기, 발행)을 백그라운드로 돌리고
// 대시보드가 진행 상황을 폴링할 수 있게 한다.
const jobs = new Map();

export function startJob(kind, postId, fn) {
  const job = {
    id: crypto.randomUUID(),
    kind,
    postId,
    status: 'running',
    logs: [],
    result: null,
    error: null,
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  const log = (msg) => {
    job.logs.push({ at: new Date().toISOString(), msg });
    console.log(`[${kind}] ${msg}`);
  };
  Promise.resolve()
    .then(() => fn(log))
    .then((result) => {
      job.result = result ?? null;
      job.status = 'done';
    })
    .catch((err) => {
      job.error = err?.message || String(err);
      job.status = 'error';
      log(`오류: ${job.error}`);
    });
  return job;
}

export function getJob(id) {
  return jobs.get(id);
}

export function runningJobFor(postId) {
  for (const job of jobs.values()) {
    if (job.postId === postId && job.status === 'running') return job;
  }
  return null;
}

export function anyJobRunning() {
  for (const job of jobs.values()) if (job.status === 'running') return true;
  return false;
}
