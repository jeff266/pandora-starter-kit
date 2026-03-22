import express from "express";
import path from "path";
import dotenv from "dotenv";
import cors from "cors";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { verifyConnection, query } from "./db.js";
import { requireWorkspaceAccess, requireUserSession, requireAdmin } from "./middleware/auth.js";
import { attachWorkspaceContext } from "./middleware/workspace-context.js";
import healthRouter, { setAPHealthChecker, setServerReady } from "./routes/health.js";
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
import customSkillsRouter from "./routes/custom-skills.js";
import customObjectsRouter from "./routes/custom-objects.js";
import webhooksRouter from "./routes/webhooks.js";
import llmConfigRouter from "./routes/llm-config.js";
import billingAdminRouter from "./routes/billing-admin.js";
import adminRouter from "./routes/admin.js";
import salesforceAuthRouter from "./routes/salesforce-auth.js";
import salesforceSyncRouter from "./routes/salesforce-sync.js";
import hubspotAuthRouter from "./routes/hubspot-auth.js";
import googleAuthRouter from "./routes/google-auth.js";
import webhookConfigRouter from "./routes/webhook-config.js";
import webhookEndpointsRouter from './routes/webhook-endpoints.js';
import salesRosterRouter from "./routes/sales-roster.js";
import linkerRouter from "./routes/linker.js";
import quotasRouter from "./routes/quotas.js";
import stageHistoryRouter from './routes/stage-history.js';
import scoresRouter from './routes/scores.js';
import icpRouter from './routes/icp.js';
import configRouter from './routes/config.js';
import namedFiltersRouter from './routes/named-filters.js';
import { lensMiddleware } from './middleware/lens.js';
import importRouter, { cleanupTempFiles } from './routes/import.js';
import dealInsightsRouter from './routes/deal-insights.js';
import enrichmentRouter from './routes/enrichment.js';
import webhookEnrichmentRouter from './routes/webhook-enrichment.js';
import csvEnrichmentRouter from './routes/csv-enrichment.js';
import publicWebhooksRouter from './routes/public-webhooks.js';
import tokenUsageRouter from './routes/token-usage.js';
import workflowsRouter, { setWorkflowService } from './routes/workflows.js';
import projectUpdatesRouter from './routes/project-updates.js';
import funnelRouter from './routes/funnel.js';
import workspaceConfigRouter from './routes/workspace-config.js';
import configCorrectionsRouter from './routes/config-corrections.js';
import findingsRouter from './routes/findings.js';
import actionItemsRouter from './routes/action-items.js';
import actionsInlineRouter from './routes/actions-inline.js';
import playbooksRouter from './routes/playbooks.js';
import dossiersRouter from './routes/dossiers.js';
import routerApiRouter from './routes/router.js';
import deliverablesRouter from './routes/deliverables.js';
import downloadsRouter from './routes/downloads.js';
import workspaceDownloadsRouter from './routes/workspace-downloads.js';
import conversationsRouter from './routes/conversations.js';
import stageBenchmarksRouter from './routes/stage-benchmarks.js';
import setupStatusRouter from './routes/setup-status.js';
import competitiveIntelligenceRouter from './routes/competitive-intelligence.js';
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
import { startReportScheduler, stopReportScheduler } from "./sync/report-scheduler.js";
import { registerBuiltInSkills, loadCustomSkills } from "./skills/index.js";
import { getSkillRegistry } from "./skills/registry.js";
import { startJobQueue } from "./jobs/queue.js";
import { agentsGlobalRouter, agentsWorkspaceRouter } from './routes/agents.js';
import { registerBuiltInAgents, getAgentRegistry } from './agents/index.js';
import slackEventsRouter from './routes/slack-events.js';
import slackInteractionsRouter from './routes/slack-interactions.js';
import slackCommandsRouter from './routes/slack-commands.js';
import slackSlashRouter from './routes/slack-slash.js';
import analysisRouter from './routes/analysis.js';
import userAuthRouter from './routes/user-auth.js';
import consultantRouter from './routes/consultant.js';
import membersRouter from './routes/members.js';
import rolesRouter from './routes/roles.js';
import flagsRouter from './routes/flags.js';
import agentLifecycleRouter from './routes/agent-lifecycle.js';
import dealIntelligenceRouter from './routes/deal-intelligence.js';
import toolsRouter from './routes/tools.js';
import chatRouter from './routes/chat.js';
import feedbackRouter from './routes/feedback.js';
import pushRouter from './routes/push.js';
import agentBuilderRouter from './routes/agent-builder.js';
import accountScoringRouter from './routes/account-scoring.js';
import prospectScoresRouter from './routes/prospect-scores.js';
import scoringStateRouter from './routes/scoring-state.js';
import adminScopesRouter from './routes/admin-scopes.js';
import targetsRouter from './routes/targets.js';
import { workspaceNotificationsRouter, userNotificationsRouter } from './routes/notifications.js';
import notificationPreferencesRouter from './routes/notification-preferences.js';
import skillRunRequestsRouter from './routes/skill-run-requests.js';
import reportsRouter, { cleanupReportFiles } from './routes/reports.js';
import chartDataRouter from './routes/chart-data.js';
import skillTrendsRouter from './routes/skill-trends.js';
import sessionsRouter from './routes/sessions.js';
import documentsRouter from './routes/documents.js';
import fineTuningRouter from './routes/fine-tuning.js';
import documentEditsRouter from './routes/document-edits.js';
import calibrationRouter from './routes/calibration.js';
import trainingRouter from './routes/training.js';
import dashboardPreferencesRouter from './routes/dashboard-preferences.js';
import sqlWorkspaceRouter from './routes/sql-workspace.js';
import toolManifestRouter from './routes/tool-manifest.js';
import { startPushTriggers, stopPushTriggers} from './push/trigger-manager.js';
import { initRenderers } from './renderers/index.js';
import { cleanupExpiredAnnotations } from './feedback/cleanup.js';
import crmWritebackRouter from './routes/crm-writeback.js';
import agenticActionsRouter from './routes/agentic-actions.js';
import editableFieldsRouter from './routes/editable-fields.js';
import workflowRulesRouter from './routes/workflow-rules.js';
import methodologyConfigsRouter from './routes/methodology-configs.js';
import agentFeedbackRouter from './routes/agent-feedback.js';
import governanceRouter from './routes/governance.js';
import waitlistRouter from './routes/waitlist.js';
import forecastAnnotationsRouter from './routes/forecast-annotations.js';
import forecastSnapshotsRouter from './routes/forecast-snapshots.js';
import forecastStageWeightedRouter from './routes/forecast-stage-weighted.js';
import forecastCategoryWeightedRouter from './routes/forecast-category-weighted.js';
import forecastTTERouter from './routes/forecast-tte.js';
import briefingRouter from './routes/briefing.js';
import briefingMathRouter from './routes/briefing-math.js';
import commandCenterRouter from './routes/command-center.js';
import investigationRouter from './routes/investigation.js';
import jobsRouter from './routes/jobs.js';
import briefsRouter from './routes/briefs.js';
import onboardingRouter from './routes/onboarding.js';
import viewPreferenceRouter from './routes/view-preference.js';
import conversationStreamRouter from './routes/conversation-stream.js';
import motionsRouter from './routes/motions.js';
import goalsRouter from './routes/goals.js';
import voiceCalibrationRouter from './routes/voice-calibration.js';
import dataDictionaryRouter from './routes/data-dictionary.js';
import workspaceVoiceRouter from './routes/workspace-voice.js';
import goalSnapshotsRouter from './routes/goal-snapshots.js';

dotenv.config();

const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || "3000", 10);

const allowedOrigins = new Set(
  [
    process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : '',
    ...(process.env.REPLIT_DOMAINS ? process.env.REPLIT_DOMAINS.split(',').map(d => `https://${d.trim()}`) : []),
    process.env.PANDORA_CUSTOM_DOMAIN || '',
  ].filter(Boolean)
);

if (allowedOrigins.size === 0) {
  console.warn('[cors] No allowed origins configured — API-only mode (no browser CORS requests will be accepted)');
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      console.warn(`[cors] Blocked request from origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key', 'X-Pandora-Lens', 'X-Workspace-Id'],
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
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false, trustProxy: false, xForwardedForHeader: false },
  keyGenerator: (req: any): string => {
    return req.params?.workspaceId
      ?? req.path.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1]
      ?? 'global';
  },
  message: { error: 'Too many requests for this operation, please try again later' },
});

const chatLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false, trustProxy: false, xForwardedForHeader: false },
  keyGenerator: (req: any): string => {
    return req.params?.workspaceId
      ?? req.path.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1]
      ?? 'global';
  },
  message: { error: 'Chat rate limit exceeded — max 20 messages per minute per workspace' },
});

app.use(express.json({
  limit: '10mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString();
  },
}));
app.use(express.urlencoded({ extended: true, verify: (req: any, _res, buf) => { req.rawBody = buf.toString(); } }));
app.use(cookieParser());

if (process.env.NODE_ENV !== 'production') {
  app.get("/", (_req, res) => {
    res.json({
      name: "Pandora",
      version: "0.1.0",
      description: "Multi-tenant GTM Intelligence Platform",
    });
  });
}

app.use("/health", healthRouter);

const clientDistPath = path.resolve(process.cwd(), 'dist', 'client');

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDistPath, {
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache');
    },
  }));
}

app.use("/api/slack/events", slackEventsRouter);
app.use("/api/webhooks/slack/events", slackEventsRouter);
app.use("/api/slack/interactions", slackInteractionsRouter);
app.use("/api/slack/commands", slackCommandsRouter);
app.use("/api/webhooks/slack/slash", slackSlashRouter);

// Public webhook endpoints - token-based auth in URL path
app.use("/api", publicWebhooksRouter);
app.use("/api/waitlist", waitlistRouter);

// OAuth routes - PUBLIC (no auth required for browser redirects)
app.use("/api/auth/hubspot", hubspotAuthRouter);
app.use("/api/auth/salesforce", salesforceAuthRouter);
app.use("/api/auth/google", googleAuthRouter);

app.use("/api/auth", userAuthRouter);
app.use("/api/users/me/notifications", requireUserSession, userNotificationsRouter);

app.use("/api/consultant", consultantRouter);

app.post('/api/admin/migrate-credentials', requireAdmin, async (_req, res) => {
  try {
    const { migrateCredentials } = await import('./lib/migrate-credentials.js');
    const result = await migrateCredentials();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.use("/api/workspaces", workspacesRouter);

const workspaceApiRouter = express.Router();
workspaceApiRouter.use((req, _res, next) => {
  if (req.method === 'POST') {
    console.log('[workspaceApiRouter] POST hit, path:', req.path);
  }
  next();
});
workspaceApiRouter.use(requireWorkspaceAccess);
workspaceApiRouter.use(attachWorkspaceContext);
workspaceApiRouter.use(lensMiddleware);

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
workspaceApiRouter.use(conversationsRouter); // Mount before dataRouter to match specific routes first
workspaceApiRouter.use(stageBenchmarksRouter);
workspaceApiRouter.use(setupStatusRouter);
workspaceApiRouter.use(competitiveIntelligenceRouter);
workspaceApiRouter.use(dataRouter);
workspaceApiRouter.use(slackSettingsRouter);
workspaceApiRouter.use(skillsRouter);
workspaceApiRouter.use(customSkillsRouter);
workspaceApiRouter.use(customObjectsRouter);
workspaceApiRouter.use(llmConfigRouter);
workspaceApiRouter.use(salesforceSyncRouter);
workspaceApiRouter.use(webhookConfigRouter);
workspaceApiRouter.use(salesRosterRouter);
workspaceApiRouter.use(linkerRouter);
workspaceApiRouter.use(stageHistoryRouter);
workspaceApiRouter.use(scoresRouter);
workspaceApiRouter.use(icpRouter);
workspaceApiRouter.use(configRouter);
workspaceApiRouter.use(namedFiltersRouter);
workspaceApiRouter.use(importRouter);
workspaceApiRouter.use(enrichmentRouter);
workspaceApiRouter.use(webhookEnrichmentRouter);
workspaceApiRouter.use(csvEnrichmentRouter);
workspaceApiRouter.use(tokenUsageRouter);
workspaceApiRouter.use(workflowsRouter);
workspaceApiRouter.use(projectUpdatesRouter);
workspaceApiRouter.use(funnelRouter);
workspaceApiRouter.use(workspaceConfigRouter);
workspaceApiRouter.use(configCorrectionsRouter);
workspaceApiRouter.use(adminScopesRouter);
workspaceApiRouter.use(dashboardPreferencesRouter);
workspaceApiRouter.use(agentsWorkspaceRouter);
workspaceApiRouter.use(findingsRouter);
workspaceApiRouter.use(actionItemsRouter);
workspaceApiRouter.use(actionsInlineRouter);
workspaceApiRouter.use(playbooksRouter);
workspaceApiRouter.use(dossiersRouter);
workspaceApiRouter.use(analysisRouter);
workspaceApiRouter.use(forecastAnnotationsRouter);
workspaceApiRouter.use(forecastSnapshotsRouter);
workspaceApiRouter.use(forecastStageWeightedRouter);
workspaceApiRouter.use(forecastCategoryWeightedRouter);
workspaceApiRouter.use(forecastTTERouter);
workspaceApiRouter.use(routerApiRouter);
workspaceApiRouter.use(crmWritebackRouter);
workspaceApiRouter.use(agenticActionsRouter);
workspaceApiRouter.use(editableFieldsRouter);
workspaceApiRouter.use(workflowRulesRouter);
workspaceApiRouter.use(methodologyConfigsRouter);
workspaceApiRouter.use(agentFeedbackRouter);
workspaceApiRouter.use(deliverablesRouter);
workspaceApiRouter.use(downloadsRouter);
workspaceApiRouter.use('/workspace-downloads', workspaceDownloadsRouter);
workspaceApiRouter.use('/:workspaceId/members', membersRouter);
workspaceApiRouter.use('/:workspaceId/roles', rolesRouter);
workspaceApiRouter.use('/:workspaceId/flags', flagsRouter);
workspaceApiRouter.use('/:workspaceId/agents', agentLifecycleRouter);
workspaceApiRouter.use('/:workspaceId/skill-run-requests', skillRunRequestsRouter);
workspaceApiRouter.use(workspaceNotificationsRouter);
workspaceApiRouter.use(notificationPreferencesRouter);
workspaceApiRouter.use(dealIntelligenceRouter);
workspaceApiRouter.use(toolsRouter);
workspaceApiRouter.use('/:workspaceId/chat', chatLimiter);
workspaceApiRouter.use(chatRouter);
workspaceApiRouter.use('/admin/fine-tuning', fineTuningRouter);
workspaceApiRouter.use(documentsRouter);
workspaceApiRouter.use(documentEditsRouter);
workspaceApiRouter.use('/calibration', calibrationRouter);
workspaceApiRouter.use('/training-pairs', trainingRouter);
workspaceApiRouter.use(feedbackRouter);
workspaceApiRouter.use(pushRouter);
workspaceApiRouter.use(accountScoringRouter);
workspaceApiRouter.use(prospectScoresRouter);
workspaceApiRouter.use(webhookEndpointsRouter);
workspaceApiRouter.use(scoringStateRouter);
workspaceApiRouter.use(agentBuilderRouter);
workspaceApiRouter.use(adminScopesRouter);
workspaceApiRouter.use(billingAdminRouter);
workspaceApiRouter.use(adminRouter);
workspaceApiRouter.use(targetsRouter);
workspaceApiRouter.use(reportsRouter);
workspaceApiRouter.use(chartDataRouter);
workspaceApiRouter.use('/:workspaceId/skills', skillTrendsRouter);
workspaceApiRouter.use(sqlWorkspaceRouter);
workspaceApiRouter.use(toolManifestRouter);
workspaceApiRouter.use(briefingRouter);
workspaceApiRouter.use(briefingMathRouter);
workspaceApiRouter.use(commandCenterRouter);
workspaceApiRouter.use(investigationRouter);
workspaceApiRouter.use(jobsRouter);
workspaceApiRouter.use(briefsRouter);
workspaceApiRouter.use(onboardingRouter);
workspaceApiRouter.use(sessionsRouter);
workspaceApiRouter.use(viewPreferenceRouter);
workspaceApiRouter.use(conversationStreamRouter);
workspaceApiRouter.use(motionsRouter);
workspaceApiRouter.use(goalsRouter);
workspaceApiRouter.use(goalSnapshotsRouter);
workspaceApiRouter.use(dataDictionaryRouter);
workspaceApiRouter.use(voiceCalibrationRouter);
workspaceApiRouter.use(workspaceVoiceRouter);
workspaceApiRouter.use(governanceRouter);
app.use("/api/workspaces", workspaceApiRouter);

// Webhooks router - intentionally public with token validation in handlers
app.use("/api/webhooks", webhooksRouter);

// Quotas router - has requireWorkspaceAccess middleware internally
app.use("/api", quotasRouter);

// Agents global router - read-only global agent registry
app.use("/api", agentsGlobalRouter);

app.use(dealInsightsRouter);

if (process.env.NODE_ENV === 'production') {
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

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

async function registerAllSkillsWithCustom(): Promise<void> {
  registerSkills();
  try {
    await loadCustomSkills();
  } catch (err: any) {
    console.error('[server] Failed to load custom skills at startup:', err.message);
  }
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

  try {
    const { seedAgentTemplates } = await import('./agents/agent-templates.js');
    await seedAgentTemplates();
    console.log('[server] Agent briefing templates seeded');
  } catch (err) {
    console.warn('[server] Agent template seeding failed (non-fatal):', err instanceof Error ? err.message : err);
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
  const t0 = performance.now();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[server] Pandora v0.1.0 listening on port ${PORT} (accepting /health/alive)`);
  });

  let tDb: number = 0;
  let dbConnected = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await verifyConnection();
      tDb = performance.now();
      console.log("[server] Database connection verified");
      dbConnected = true;
      break;
    } catch (err) {
      console.error(`[server] DB connection attempt ${attempt}/3 failed:`, err instanceof Error ? err.message : err);
      if (attempt < 3) {
        console.log(`[server] Retrying in 3s...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }
  if (!dbConnected) {
    console.error("[server] Failed to connect to database after 3 attempts. Exiting.");
    process.exit(1);
  }

  const dbMs = Math.round(tDb! - t0);
  console.log(`[server] Core startup complete in ${dbMs}ms — deferring initialization`);

  setTimeout(() => {
    initializeAfterStart(t0, tDb!).catch(err => {
      console.error('[server] Post-start initialization error:', err);
    });
  }, 100);
}

async function initializeAfterStart(t0: number, tDb: number): Promise<void> {
  try {
    const { seedProductionData } = await import('./seed-production.js');
    await seedProductionData();
  } catch (err) {
    console.warn("[server] Production seed failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  try {
    const { seedDemoWorkspace, refreshDemoDates } = await import('./seed-demo-workspace.js');
    await seedDemoWorkspace();
    await refreshDemoDates();
  } catch (err) {
    console.warn("[server] Demo workspace seed failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  try {
    const { backfillWorkspaceMembers } = await import('./lib/backfill-workspace-members.js');
    await backfillWorkspaceMembers();
  } catch (err) {
    console.warn("[server] Workspace members backfill failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  try {
    const { migrateAllBowtiesToFunnel } = await import('./funnel/migration.js');
    await migrateAllBowtiesToFunnel();
  } catch (err) {
    console.warn("[server] Funnel migration failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  const tMigration = performance.now();

  try {
    const { seedDictionary } = await import('./dictionary/dictionary-seeder.js');
    const unseeded = await query<{ id: string }>(
      `SELECT w.id FROM workspaces w WHERE NOT EXISTS (SELECT 1 FROM data_dictionary d WHERE d.workspace_id = w.id)`
    );
    for (const row of unseeded.rows) {
      await seedDictionary(row.id).catch(err => console.warn('[Dictionary] Seed failed for workspace', row.id, err));
    }
    if (unseeded.rows.length > 0) console.log(`[Dictionary] Seeded ${unseeded.rows.length} workspace(s)`);
  } catch (err) {
    console.warn('[Dictionary] Startup seed failed (non-fatal):', err instanceof Error ? err.message : err);
  }

  try {
    const { runMigrationIfEnabled } = await import('./lib/migrate-credentials.js');
    await runMigrationIfEnabled();
  } catch (err) {
    console.warn('[server] Credential migration check failed (non-fatal):', err instanceof Error ? err.message : err);
  }

  await Promise.all([
    Promise.resolve(registerAdapters()),
    registerAllSkillsWithCustom(),
    Promise.resolve(registerBuiltInAgents()),
    initWorkflowEngine().then(apClient => {
      startWorkflowMonitor(apClient);
    }),
    initRenderers(),
  ]);

  const tRegistration = performance.now();
  startJobQueue();
  startScheduler();
  startSkillScheduler();
  startReportScheduler();
  startPushTriggers().catch(err => {
    console.warn('[server] Push trigger system failed to start (non-fatal):', err instanceof Error ? err.message : err);
  });

  const tSchedulers = performance.now();

  cleanupTempFiles();
  setInterval(cleanupTempFiles, 60 * 60 * 1000);

  cleanupReportFiles();
  setInterval(cleanupReportFiles, 60 * 60 * 1000);

  const fs = await import('fs');
  setInterval(() => {
    const dir = '/tmp/pandora-docs';
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const f of files) {
      try {
        const filePath = path.join(dir, f);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          console.log(`[cleanup] Removed expired document: ${f}`);
        }
      } catch (err) {
        console.error(`[cleanup] Failed to clean document ${f}:`, err);
      }
    }
  }, 30 * 60 * 1000);

  const { startActionExpiryScheduler } = await import('./actions/scheduler.js');
  const dbPool = (await import('./db.js')).default;
  startActionExpiryScheduler(dbPool);

  const { startCrmRetryScheduler } = await import('./jobs/crm-retry-scheduler.js');
  startCrmRetryScheduler(dbPool);

  const { checkScheduledReports, initializeScheduledReports } = await import('./reports/scheduler.js');
  await initializeScheduledReports();
  setInterval(checkScheduledReports, 60 * 1000);

  const { flushDigests } = await import('./notifications/digest.js');
  setInterval(flushDigests, 15 * 60 * 1000);
  console.log('[NotificationDigest] Digest flush scheduler started (every 15 min)');

  const runAnnotationCleanup = () => {
    const now = new Date();
    if (now.getUTCHours() === 3 && now.getUTCMinutes() === 0) {
      cleanupExpiredAnnotations().catch(err => {
        console.error('[Annotation Cleanup] Failed:', err);
      });
    }
  };
  setInterval(runAnnotationCleanup, 60000);

  // Governance auto-rollback monitor — runs every 6 hours
  const runGovernanceMonitor = async () => {
    try {
      const { checkForAutoRollback } = await import('./governance/rollback-engine.js');
      const wsResult = await query<{ id: string }>(`SELECT id FROM workspaces WHERE status = 'active' OR status IS NULL LIMIT 100`);
      for (const ws of wsResult.rows) {
        await checkForAutoRollback(ws.id).catch(() => null);
      }
    } catch (err) {
      console.warn('[Governance] Monitor run failed (non-fatal):', err instanceof Error ? err.message : err);
    }
  };
  setInterval(runGovernanceMonitor, 6 * 60 * 60 * 1000);
  console.log('[Governance] Auto-rollback monitor scheduled (every 6 hours)');

  setServerReady();

  const tTotal = performance.now();
  const migrationMs = Math.round(tMigration - tDb);
  const registrationMs = Math.round(tRegistration - tMigration);
  const schedulerMs = Math.round(tSchedulers - tRegistration);
  const totalMs = Math.round(tTotal - t0);
  const dbMs = Math.round(tDb - t0);
  console.log(
    `[server] Pandora v0.1.0 ready in ${totalMs}ms (db: ${dbMs}ms, migration: ${migrationMs}ms, registration: ${registrationMs}ms, schedulers: ${schedulerMs}ms)`
  );
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received, shutting down gracefully');
  stopSkillScheduler();
  stopReportScheduler();
  stopPushTriggers();
  stopWorkflowMonitor();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[server] SIGINT received, shutting down gracefully');
  stopSkillScheduler();
  stopReportScheduler();
  stopPushTriggers();
  stopWorkflowMonitor();
  process.exit(0);
});

start();
