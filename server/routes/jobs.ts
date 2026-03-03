import { Router, Request, Response } from 'express';
import { getJobQueue } from '../jobs/queue.js';

const router = Router();
const jobQueue = getJobQueue();

// Get job status by ID
router.get('/:jobId', async (req: Request, res: Response): Promise<void> => {
  try {
    const jobId = req.params.jobId as string;
    const job = await jobQueue.getJob(jobId);

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json({
      id: job.id,
      status: job.status,
      result: job.result,
      error: job.error,
      progress: job.progress,
      attempts: job.attempts,
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[jobs] get job error:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
