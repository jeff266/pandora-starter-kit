import { Router, Request, Response } from "express";
import { query } from "../db.js";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    await query("SELECT 1");
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
    });
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
