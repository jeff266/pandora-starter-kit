import { Router, Request, Response } from "express";
import { query } from "../db.js";

const router = Router();

let apHealthChecker: (() => Promise<{ healthy: boolean; error?: string }>) | null = null;
let isReady = false;

export function setAPHealthChecker(checker: () => Promise<{ healthy: boolean; error?: string }>) {
  apHealthChecker = checker;
}

export function setServerReady() {
  isReady = true;
}

export function getServerReady(): boolean {
  return isReady;
}

router.get("/alive", (_req: Request, res: Response) => {
  res.json({ status: "alive", timestamp: new Date().toISOString() });
});

router.get("/ready", (_req: Request, res: Response) => {
  if (isReady) {
    res.json({ status: "ready", timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({ status: "initializing", timestamp: new Date().toISOString() });
  }
});

router.get("/", async (_req: Request, res: Response) => {
  try {
    await query("SELECT 1");

    const health: Record<string, any> = {
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
      ready: isReady,
      services: {
        database: "ok",
      },
    };

    if (apHealthChecker) {
      try {
        const apHealth = await apHealthChecker();
        health.services.activepieces = apHealth.healthy ? "ok" : "unreachable";
        if (apHealth.error) {
          health.services.activepieces_error = apHealth.error;
        }
      } catch {
        health.services.activepieces = "unreachable";
      }
    } else {
      health.services.activepieces = "not_configured";
    }

    res.json(health);
  } catch {
    res.status(503).json({
      status: "error",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
      message: "Database connection failed",
    });
  }
});

// ============================================================================
// GET /health/llm — Test each LLM provider and return status
// ============================================================================

interface ProviderHealth {
  status: 'ok' | 'error' | 'no_key';
  latency_ms?: number;
  model?: string;
  error?: string;
}

async function testAnthropic(): Promise<ProviderHealth> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  if (!apiKey) return { status: 'no_key' };

  const start = Date.now();
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the word "ok".' }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { status: 'error', latency_ms: Date.now() - start, model: 'claude-sonnet-4-5', error: `HTTP ${response.status}: ${errText.slice(0, 200)}` };
    }

    const data = await response.json() as any;
    return { status: 'ok', latency_ms: Date.now() - start, model: data.model || 'claude-sonnet-4-5' };
  } catch (err) {
    return { status: 'error', latency_ms: Date.now() - start, error: (err as Error).message };
  }
}

async function testFireworksDeepSeek(): Promise<ProviderHealth> {
  const apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey) return { status: 'no_key' };

  const baseURL = process.env.FIREWORKS_BASE_URL || 'https://api.fireworks.ai/inference/v1';
  const model = 'accounts/fireworks/models/deepseek-v3p1';
  const start = Date.now();

  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the word "ok".' }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { status: 'error', latency_ms: Date.now() - start, model: 'deepseek-v3p1', error: `HTTP ${response.status}: ${errText.slice(0, 200)}` };
    }

    const data = await response.json() as any;
    return { status: 'ok', latency_ms: Date.now() - start, model: data.model || 'deepseek-v3p1' };
  } catch (err) {
    return { status: 'error', latency_ms: Date.now() - start, error: (err as Error).message };
  }
}

async function testOpenAI(): Promise<ProviderHealth> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: 'no_key' };

  const start = Date.now();
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the word "ok".' }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { status: 'error', latency_ms: Date.now() - start, model: 'gpt-4o-mini', error: `HTTP ${response.status}: ${errText.slice(0, 200)}` };
    }

    const data = await response.json() as any;
    return { status: 'ok', latency_ms: Date.now() - start, model: data.model || 'gpt-4o-mini' };
  } catch (err) {
    return { status: 'error', latency_ms: Date.now() - start, error: (err as Error).message };
  }
}

router.get("/llm", async (_req: Request, res: Response) => {
  const [anthropic, fireworks, openai] = await Promise.all([
    testAnthropic(),
    testFireworksDeepSeek(),
    testOpenAI(),
  ]);

  const allOk = [anthropic, fireworks, openai].every(p => p.status === 'ok' || p.status === 'no_key');
  const anyConfigured = [anthropic, fireworks, openai].some(p => p.status !== 'no_key');

  res.status(allOk ? 200 : 503).json({
    status: allOk && anyConfigured ? 'ok' : allOk ? 'no_providers' : 'degraded',
    timestamp: new Date().toISOString(),
    providers: {
      anthropic,
      fireworks_deepseek: fireworks,
      openai,
    },
  });
});

export default router;
