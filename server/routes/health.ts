import { Router, Request, Response } from "express";
import { query } from "../db.js";

const router = Router();

let apHealthChecker: (() => Promise<{ healthy: boolean; error?: string }>) | null = null;

export function setAPHealthChecker(checker: () => Promise<{ healthy: boolean; error?: string }>) {
  apHealthChecker = checker;
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    await query("SELECT 1");

    const health: Record<string, any> = {
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
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

export default router;
