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
app.use("/api/connectors", connectorsRouter);
app.use("/api/workspaces", hubspotRouter);
app.use("/api/workspaces", gongRouter);
app.use("/api/workspaces", firefliesRouter);
app.use("/api/workspaces", actionsRouter);
app.use("/api/workspaces", contextRouter);

async function start(): Promise<void> {
  try {
    await verifyConnection();
    console.log("[server] Database connection verified");
  } catch (err) {
    console.error("[server] Failed to connect to database:", err);
    process.exit(1);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[server] Pandora v0.1.0 listening on port ${PORT}`);
  });
}

start();
