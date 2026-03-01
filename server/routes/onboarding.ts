import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import {
  startOnboarding,
  getOnboardingState,
  answerQuestion,
  skipQuestion,
  resumeOnboarding,
  getCompletionSummary,
} from '../onboarding/flow-engine.js';
import { extractText } from '../onboarding/document-extractor.js';
import { parseUploadedDocument } from '../onboarding/response-parser.js';
import { getQuestion } from '../onboarding/questions/index.js';

const router = Router();

const upload = multer({
  dest: path.join(os.tmpdir(), 'pandora-onboarding-uploads'),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'image/png', 'image/jpeg', 'image/webp',
      'text/plain', 'text/markdown',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.pdf', '.docx', '.xlsx', '.csv', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.md'];
    if (allowed.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

router.post('/:workspaceId/onboarding/start', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  const { role = 'admin', force } = req.body as { role?: string; force?: boolean | string };
  try {
    const result = await startOnboarding(
      workspaceId,
      role as 'admin' | 'cro' | 'manager' | 'consultant',
      force === true || force === 'true',
    );
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[onboarding] POST /start failed:', msg);
    res.status(500).json({ error: msg });
  }
});

router.get('/:workspaceId/onboarding/state', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  try {
    const result = await getOnboardingState(workspaceId);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[onboarding] GET /state failed:', msg);
    res.status(500).json({ error: msg });
  }
});

router.post('/:workspaceId/onboarding/answer', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  const { question_id, response } = req.body as { question_id: string; response: string };
  if (!question_id || !response) {
    res.status(400).json({ error: 'question_id and response are required' });
    return;
  }
  try {
    const result = await answerQuestion(workspaceId, question_id, response);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[onboarding] POST /answer failed:', msg);
    res.status(500).json({ error: msg });
  }
});

router.post('/:workspaceId/onboarding/upload', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  const { question_id } = req.body as { question_id: string };

  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  if (!question_id) {
    res.status(400).json({ error: 'question_id is required' });
    return;
  }

  const filePath = req.file.path;
  const mimeType = req.file.mimetype;

  try {
    const extracted = await extractText(filePath, mimeType);

    if (!extracted.text || extracted.confidence === 0) {
      res.json({ extraction_hypothesis: null, error: 'Could not extract text from this file' });
      return;
    }

    const question = getQuestion(question_id);
    if (!question) {
      res.status(400).json({ error: `Unknown question: ${question_id}` });
      return;
    }

    const hypothesis = await parseUploadedDocument(question, extracted.text, mimeType);
    res.json({ extraction_hypothesis: hypothesis, pages: extracted.pages, confidence: extracted.confidence });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[onboarding] POST /upload failed:', msg);
    res.status(500).json({ error: msg });
  } finally {
    fs.unlink(filePath).catch(() => null);
  }
});

router.post('/:workspaceId/onboarding/skip', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  const { question_id } = req.body as { question_id: string };
  if (!question_id) {
    res.status(400).json({ error: 'question_id is required' });
    return;
  }
  try {
    const result = await skipQuestion(workspaceId, question_id);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[onboarding] POST /skip failed:', msg);
    res.status(500).json({ error: msg });
  }
});

router.post('/:workspaceId/onboarding/resume', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  try {
    const result = await resumeOnboarding(workspaceId);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: msg });
  }
});

router.get('/:workspaceId/onboarding/complete', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  try {
    const result = await getCompletionSummary(workspaceId);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
