import express from "express";
import dotenv from "dotenv";
import { verifyConnection } from "./db.js";
import healthRouter from "./routes/health.js";
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
import { getAdapterRegistry } from "./connectors/adapters/registry.js";
import { MondayTaskAdapter } from "./connectors/monday/adapter.js";
import { GoogleDriveDocumentAdapter } from "./connectors/google-drive/adapter.js";
import { salesforceAdapter } from "./connectors/salesforce/adapter.js";
import { startScheduler } from "./sync/scheduler.js";
import { startSkillScheduler, stopSkillScheduler } from "./sync/skill-scheduler.js";
import { registerBuiltInSkills } from "./skills/index.js";
import { getSkillRegistry } from "./skills/registry.js";
import { startJobQueue } from "./jobs/queue.js";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    name: "Pandora",
    version: "0.1.0",
    description: "Multi-tenant GTM Intelligence Platform",
  });
});

app.use("/health", healthRouter);
app.use("/api/workspaces", workspacesRouter);
app.use("/api/workspaces", hubspotRouter);
app.use("/api/workspaces", gongRouter);
app.use("/api/workspaces", firefliesRouter);
app.use("/api/workspaces", connectorsRouter);
app.use("/api/workspaces", actionsRouter);
app.use("/api/workspaces", contextRouter);
app.use("/api/workspaces", syncRouter);
app.use("/api/workspaces", dataRouter);
app.use("/api/workspaces", slackSettingsRouter);
app.use("/api/workspaces", skillsRouter);
app.use("/api", skillsRouter);
app.use("/api/workspaces", llmConfigRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/auth/salesforce", salesforceAuthRouter);
app.use("/api/workspaces", salesforceSyncRouter);
app.use("/api/workspaces", webhookConfigRouter);
app.use("/api/workspaces", salesRosterRouter);
app.use("/api/workspaces", linkerRouter);
app.use("/api", quotasRouter);
app.use("/api/workspaces", stageHistoryRouter);
app.use("/api/workspaces", scoresRouter);
app.use("/api/workspaces", icpRouter);
app.use("/api/workspaces", configRouter);
app.use("/api/workspaces", importRouter);
app.use(dealInsightsRouter);

function registerAdapters(): void {
  const registry = getAdapterRegistry();
  registry.register(new MondayTaskAdapter());
  registry.register(new GoogleDriveDocumentAdapter());
  registry.register(salesforceAdapter);
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

async function start(): Promise<void> {
  try {
    await verifyConnection();
    console.log("[server] Database connection verified");
  } catch (err) {
    console.error("[server] Failed to connect to database:", err);
    process.exit(1);
  }

  registerAdapters();
  registerSkills();
  startJobQueue();
  startScheduler();
  startSkillScheduler();

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
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[server] SIGINT received, shutting down gracefully');
  stopSkillScheduler();
  process.exit(0);
});

start();
