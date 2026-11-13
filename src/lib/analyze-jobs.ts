/**
 * In-memory analyze jobs.
 * Long Gemini runs (~60s+) hold the HTTP socket open with no bytes until the
 * end; intermediaries (port-forward / idle proxies) reset that socket →
 * browser TypeError: Failed to fetch while the Node process keeps working.
 * POST accepts the job and returns immediately; GET ?jobId= polls the result.
 */

export type AnalyzeJobStatus = "pending" | "running" | "done" | "error";

export type AnalyzeJobRecord = {
  id: string;
  status: AnalyzeJobStatus;
  createdAt: number;
  updatedAt: number;
  stage?: string;
  error?: string;
  detail?: string;
  /** Final JSON payload returned to the client when status === "done" */
  result?: Record<string, unknown>;
  /** Keep the running promise reachable so GC does not cancel work */
  _promise?: Promise<void>;
};

const jobs = new Map<string, AnalyzeJobRecord>();
const MAX_AGE_MS = 30 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > MAX_AGE_MS) jobs.delete(id);
  }
}

export function createAnalyzeJob(): AnalyzeJobRecord {
  sweep();
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const job: AnalyzeJobRecord = {
    id,
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stage: "queued",
  };
  jobs.set(id, job);
  return job;
}

export function getAnalyzeJob(id: string): AnalyzeJobRecord | undefined {
  sweep();
  return jobs.get(id);
}

export function updateAnalyzeJob(
  id: string,
  patch: Partial<Omit<AnalyzeJobRecord, "id" | "createdAt" | "_promise">>,
): AnalyzeJobRecord | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  Object.assign(job, patch, { updatedAt: Date.now() });
  return job;
}

export function attachAnalyzeJobPromise(id: string, promise: Promise<void>): void {
  const job = jobs.get(id);
  if (job) job._promise = promise;
}
