import { JobRunRepository } from "../repositories/JobRunRepository.js";

const jobRunRepository = new JobRunRepository();

export async function withJobRunLogging(queueName, job, runner) {
  const startedAt = Date.now();
  const attempts = (job?.attemptsMade || 0) + 1;
  const runId = jobRunRepository.create({
    queue: queueName,
    jobName: job.name,
    jobId: job.id ? String(job.id) : null,
    status: "running",
    attempts,
    startedAt,
    createdAt: startedAt,
  });

  try {
    const result = await runner();
    const finishedAt = Date.now();
    jobRunRepository.update(runId, {
      status: "completed",
      attempts,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      errorMessage: null,
      errorStack: null,
    });
    return result;
  } catch (error) {
    const finishedAt = Date.now();
    jobRunRepository.update(runId, {
      status: "failed",
      attempts,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      errorMessage: error?.message || String(error),
      errorStack: error?.stack || null,
    });
    throw error;
  }
}
