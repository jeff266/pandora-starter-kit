import { Router } from 'express';
import { 
  CALIBRATION_QUESTIONS, 
  shouldTriggerCalibration, 
  saveCalibrationAnswer, 
  completeCalibration,
  buildCalibrationOpeningMessage
} from '../documents/calibration.js';
import { configLoader } from '../config/workspace-config-loader.js';

const router = Router({ mergeParams: true });

// GET /api/workspaces/:id/calibration/status
router.get('/status', async (req: any, res) => {
  try {
    const workspaceId = req.params.id;
    const status = await shouldTriggerCalibration(workspaceId);
    const profile = await configLoader.getDocumentProfile(workspaceId);
    
    res.json({
      ...status,
      completedAt: profile.calibration.completedAt,
      nextScheduledAt: profile.calibration.nextScheduledAt,
      completedSessions: profile.calibration.completedSessions,
      questions: CALIBRATION_QUESTIONS,
      openingMessage: await buildCalibrationOpeningMessage(workspaceId)
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/workspaces/:id/calibration/answer
router.post('/answer', async (req: any, res) => {
  try {
    const workspaceId = req.params.id;
    const { questionId, answer } = req.body;
    
    if (!questionId) {
      return res.status(400).json({ error: 'questionId is required' });
    }

    await saveCalibrationAnswer(workspaceId, questionId, answer);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/workspaces/:id/calibration/complete
router.post('/complete', async (req: any, res) => {
  try {
    const workspaceId = req.params.id;
    const { answers } = req.body;
    
    await completeCalibration(workspaceId, answers || {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
