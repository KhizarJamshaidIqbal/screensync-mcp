// ScreenSync Job Runner — tracks autonomous flow executions with live progress,
// SSE broadcast, cancellation, and task-card rendering (Rev 4 Item D1 / A2).

const jobs = new Map(); // id -> JobState

function notifyListeners(job) {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'job_update', job }).catch(() => {});
    }
  } catch {}
}

export function createJob(goal, steps = []) {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const job = {
    id,
    goal: String(goal || 'Autonomous Goal'),
    steps: Array.isArray(steps) ? steps.map((s, i) => ({
      index: i + 1,
      tool: s.tool || 'step',
      args: s.args || {},
      status: 'pending', // pending | running | completed | failed | skipped
      result: null,
      error: null,
    })) : [],
    state: 'idle', // idle | running | paused | completed | cancelled | failed
    progress: { current: 0, total: Array.isArray(steps) ? steps.length : 0 },
    startedAt: null,
    completedAt: null,
    error: null,
  };
  jobs.set(id, job);
  notifyListeners(job);
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function listJobs() {
  return Array.from(jobs.values()).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return { ok: false, error: 'Job not found: ' + id };
  if (job.state === 'completed' || job.state === 'cancelled') {
    return { ok: true, job };
  }
  job.state = 'cancelled';
  job.completedAt = Date.now();
  notifyListeners(job);
  return { ok: true, job };
}

export function updateJobProgress(id, { stepIndex, status, result, error }) {
  const job = jobs.get(id);
  if (!job) return null;
  if (stepIndex != null && job.steps[stepIndex - 1]) {
    const step = job.steps[stepIndex - 1];
    if (status) step.status = status;
    if (result !== undefined) step.result = result;
    if (error !== undefined) step.error = error;
  }
  job.progress.current = job.steps.filter((s) => s.status === 'completed').length;
  if (job.progress.current === job.progress.total && job.progress.total > 0) {
    job.state = 'completed';
    job.completedAt = Date.now();
  }
  notifyListeners(job);
  return job;
}
