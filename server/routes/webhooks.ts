import { Router } from 'express';
import {
  handleSkillTrigger,
  handleEvent,
  handleGetSkillRun,
  handleListSkillRuns,
} from '../skills/webhook.js';

const router = Router();

router.post('/skills/:skillId/trigger', handleSkillTrigger);

router.get('/skills/:skillId/runs/:runId', handleGetSkillRun);

router.get('/skills/:skillId/runs', handleListSkillRuns);

router.post('/events', handleEvent);

export default router;
