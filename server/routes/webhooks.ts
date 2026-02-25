import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  handleSkillTrigger,
  handleEvent,
  handleGetSkillRun,
  handleListSkillRuns,
} from '../skills/webhook.js';

const router = Router();

// Require authentication for all webhook endpoints
// Note: These are for n8n/automation tool integration, not public CRM webhooks
router.use(requireAuth);

router.post('/skills/:skillId/trigger', handleSkillTrigger);

router.get('/skills/:skillId/runs/:runId', handleGetSkillRun);

router.get('/skills/:skillId/runs', handleListSkillRuns);

router.post('/events', handleEvent);

export default router;
