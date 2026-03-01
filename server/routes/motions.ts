import { Router, type Request, type Response } from 'express';
import { motionService } from '../goals/motion-service.js';
import { inferMotions } from '../goals/motion-inference.js';

const router = Router({ mergeParams: true });

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params as { workspaceId: string };
    const motions = await motionService.list(workspaceId);
    res.json(motions);
  } catch (err) {
    console.error('[Motions] List error:', err);
    res.status(500).json({ error: 'Failed to list motions' });
  }
});

router.post('/infer', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params as { workspaceId: string };
    const inferred = await inferMotions(workspaceId);
    res.json(inferred);
  } catch (err) {
    console.error('[Motions] Infer error:', err);
    res.status(500).json({ error: 'Failed to infer motions' });
  }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params as { workspaceId: string };
    const { type, label } = req.body;
    if (!type || !label) {
      res.status(400).json({ error: 'type and label are required' });
      return;
    }
    const motion = await motionService.create(workspaceId, req.body);
    res.status(201).json(motion);
  } catch (err) {
    console.error('[Motions] Create error:', err);
    res.status(500).json({ error: 'Failed to create motion' });
  }
});

router.put('/:motionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { motionId } = req.params as { motionId: string };
    const motion = await motionService.update(motionId, req.body);
    res.json(motion);
  } catch (err) {
    console.error('[Motions] Update error:', err);
    res.status(500).json({ error: 'Failed to update motion' });
  }
});

router.delete('/:motionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { motionId } = req.params as { motionId: string };
    await motionService.softDelete(motionId);
    res.status(204).end();
  } catch (err) {
    console.error('[Motions] Delete error:', err);
    res.status(500).json({ error: 'Failed to delete motion' });
  }
});

export default router;
