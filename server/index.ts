import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { verifyConnection } from "./db.js";
import { requireWorkspaceAccess } from "./middleware/auth.js";
import healthRouter, { setAPHealthChecker } from "./routes/health.js";
import workspacesRouter from "./routes/workspaces.js";
import connectorsRouter from "./routes/connectors.js";
import hubspotRouter from "./routes/hubspot.js";
import gongRouter from "./routes/gong.js";
import firefliesRouter from "./routes/fireflies.js";
import actionsRouter from "./routes/actions.js";
import contextRouter from "./routes/context.js";
import syncRouter from "./routes/sync.js";
import dataRouter from "./routes/data.js";
import slackSettingsRouter from "./routes/slack-settings.js";
import skillsRouter from "./routes/skills.js";
import webhooksRouter from "./routes/webhooks.js";
import llmConfigRouter from "./routes/llm-config.js";
import salesforceAuthRouter from "./routes/salesforce-auth.js";
import salesforceSyncRouter from "./routes/salesforce-sync.js";
import webhookConfigRouter from "./routes/webhook-config.js";
import salesRosterRouter from "./routes/sales-roster.js";
import linkerRouter from "./routes/linker.js";
import quotasRouter from "./routes/quotas.js";
import stageHistoryRouter from './routes/stage-history.js';
import scoresRouter from './routes/scores.js';
import icpRouter from './routes/icp.js';
import configRouter from './routes/config.js';
import importRouter, { cleanupTempFiles } from './routes/import.js';
import dealInsightsRouter from './routes/deal-insights.js';
import enrichmentRouter from './routes/enrichment.js';
import tokenUsageRouter from './routes/token-usage.js';
import workflowsRouter, { setWorkflowService } from './routes/workflows.js';
import projectUpdatesRouter from './routes/project-updates.js';
import funnelRouter from './routes/funnel.js';
import workspaceConfigRouter from './routes/workspace-config.js';
import { ActivePiecesClient } from './workflows/ap-client.js';
import { WorkflowService } from './workflows/workflow-service.js';
import { seedTemplates } from './workflows/template-seed.js';
import { setOnConnectorConnectedHook } from './connectors/adapters/credentials.js';
import { onConnectorConnected } from './workflows/ap-connection-provisioner.js';
import { startWorkflowMonitor, stopWorkflowMonitor } from './workflows/workflow-monitor.js';
import { getAdapterRegistry } from "./connectors/adapters/registry.js";
import { MondayTaskAdapter } from "./connectors/monday/adapter.js";
import { GoogleDriveDocumentAdapter } from "./connectors/google-drive/adapter.js";
import { salesforceAdapter } from "./connectors/salesforce/adapter.js";
import { gongAdapter } from "./connectors/gong/adapter.js";
import { firefliesAdapter } from "./connectors/fireflies/adapter.js";
import { startScheduler } from "./sync/scheduler.js";
import { startSkillScheduler, stopSkillScheduler } from "./sync/skill-scheduler.js";
import { registerBuiltInSkills } from "./skills/index.js";
import { getSkillRegistry } from "./skills/registry.js";
import { startJobQueue } from "./jobs/queue.js";
import { agentsGlobalRouter, agentsWorkspaceRouter } from './routes/agents.js';
import { registerBuiltInAgents, getAgentRegistry } from './agents/index.js';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

const allowedOrigins = [
  process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : '',
  process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}` : '',
  process.env.PANDORA_CUSTOM_DOMAIN || '',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', globalLimiter);

const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later' },
});
app.use('/api/auth/', authLimiter);

const heavyOpLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false, trustProxy: false, xForwardedForHeader: false },
  keyGenerator: (req) => {
    return req.params?.workspaceId || 'global';
  },
  message: { error: 'Too many requests for this operation, please try again later' },
});

app.use(express.json({ limit: '10mb' }));

app.get("/", (_req, res) => {
  res.json({
    name: "Pandora",
    version: "0.1.0",
    description: "Multi-tenant GTM Intelligence Platform",
  });
});

app.use("/health", healthRouter);
app.use("/api/workspaces", workspacesRouter);

const workspaceApiRouter = express.Router();
workspaceApiRouter.use(requireWorkspaceAccess);

workspaceApiRouter.use((req, _res, next) => {
  const path = req.path;
  if (
    path.includes('/sync') ||
    path.includes('/export') ||
    path.endsWith('/run-all')
  ) {
    return heavyOpLimiter(req, _res, next);
  }
  next();
});

workspaceApiRouter.use(hubspotRouter);
workspaceApiRouter.use(gongRouter);
workspaceApiRouter.use(firefliesRouter);
workspaceApiRouter.use(connectorsRouter);
workspaceApiRouter.use(actionsRouter);
workspaceApiRouter.use(contextRouter);
workspaceApiRouter.use(syncRouter);
workspaceApiRouter.use(dataRouter);
workspaceApiRouter.use(slackSettingsRouter);
workspaceApiRouter.use(skillsRouter);
workspaceApiRouter.use(llmConfigRouter);
workspaceApiRouter.use(salesforceSyncRouter);
workspaceApiRouter.use(webhookConfigRouter);
workspaceApiRouter.use(salesRosterRouter);
workspaceApiRouter.use(linkerRouter);
workspaceApiRouter.use(stageHistoryRouter);
workspaceApiRouter.use(scoresRouter);
workspaceApiRouter.use(icpRouter);
workspaceApiRouter.use(configRouter);
workspaceApiRouter.use(importRouter);
workspaceApiRouter.use(enrichmentRouter);
workspaceApiRouter.use(tokenUsageRouter);
workspaceApiRouter.use(workflowsRouter);
workspaceApiRouter.use(projectUpdatesRouter);
workspaceApiRouter.use(funnelRouter);
workspaceApiRouter.use(workspaceConfigRouter);
workspaceApiRouter.use(agentsWorkspaceRouter);
app.use("/api/workspaces", workspaceApiRouter);

app.use("/api", skillsRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/auth/salesforce", salesforceAuthRouter);
app.use("/api", quotasRouter);
app.use("/api/funnel", funnelRouter);
app.use("/api", agentsGlobalRouter);

app.use(dealInsightsRouter);

function registerAdapters(): void {
  const registry = getAdapterRegistry();
  const adapters = [
    { name: 'monday', create: () => new MondayTaskAdapter() },
    { name: 'google-drive', create: () => new GoogleDriveDocumentAdapter() },
    { name: 'salesforce', create: () => salesforceAdapter },
    { name: 'gong', create: () => gongAdapter },
    { name: 'fireflies', create: () => firefliesAdapter },
  ];
  for (const { name, create } of adapters) {
    try {
      registry.register(create());
    } catch (err) {
      console.warn(`[server] Failed to register ${name} adapter:`, err instanceof Error ? err.message : err);
    }
  }
  const stats = registry.getStats();
  console.log(
    `[server] Registered ${stats.total} adapters: ${stats.sourceTypes.join(', ')}`
  );
}

function registerSkills(): void {
  registerBuiltInSkills();
  const registry = getSkillRegistry();
  const stats = registry.getStats();
  console.log(
    `[server] Registered ${stats.total} skills: ${Object.entries(stats.byCategory).map(([k, v]) => `${k}(${v})`).join(', ')}`
  );
}

async function initWorkflowEngine(): Promise<ActivePiecesClient | undefined> {
  const apBaseUrl = process.env.AP_BASE_URL;
  const apApiKey = process.env.AP_API_KEY;
  let apClient: ActivePiecesClient | undefined;

  if (apBaseUrl && apApiKey) {
    apClient = new ActivePiecesClient({ baseUrl: apBaseUrl, apiKey: apApiKey });
    const health = await apClient.healthCheck();
    if (health.healthy) {
      console.log('[server] ActivePieces connected');
    } else {
      console.warn('[server] ActivePieces unreachable, running in local-only mode:', health.error);
      apClient = undefined;
    }
  } else {
    console.log('[server] ActivePieces not configured (AP_BASE_URL/AP_API_KEY missing), running in local-only mode');
  }

  const { default: pool } = await import('./db.js');
  const workflowService = new WorkflowService(pool, apClient);
  setWorkflowService(workflowService);

  try {
    await seedTemplates(pool);
    console.log('[server] Workflow templates seeded');
  } catch (err) {
    console.warn('[server] Template seeding failed (non-fatal):', err instanceof Error ? err.message : err);
  }

  if (apClient) {
    const client = apClient;
    setAPHealthChecker(() => client.healthCheck());

    setOnConnectorConnectedHook(async (workspaceId, connectorName, credentials) => {
      await onConnectorConnected(workspaceId, connectorName, credentials, client, pool);
    });
  }

  console.log('[server] Workflow engine initialized (AP mode: ' + (apClient ? 'connected' : 'local-only') + ')');
  return apClient;
}

async function start(): Promise<void> {
  try {
    await verifyConnection();
    console.log("[server] Database connection verified");
  } catch (err) {
    console.error("[server] Failed to connect to database:", err);
    process.exit(1);
  }

  // Run funnel migration (bowtie_discovery → funnel definitions)
  try {
    const { migrateAllBowtiesToFunnel } = await import('./funnel/migration.js');
    await migrateAllBowtiesToFunnel();
  } catch (err) {
    console.warn("[server] Funnel migration failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  registerAdapters();
  registerSkills();
  registerBuiltInAgents();
  startJobQueue();
  startScheduler();
  startSkillScheduler();

  const apClient = await initWorkflowEngine();
  startWorkflowMonitor(apClient);

  cleanupTempFiles();
  setInterval(cleanupTempFiles, 60 * 60 * 1000);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[server] Pandora v0.1.0 listening on port ${PORT}`);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received, shutting down gracefully');
  stopSkillScheduler();
  stopWorkflowMonitor();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[server] SIGINT received, shutting down gracefully');
  stopSkillScheduler();
  stopWorkflowMonitor();
  process.exit(0);
});

start();
