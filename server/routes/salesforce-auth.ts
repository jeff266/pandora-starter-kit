import { Router, Request, Response } from "express";
import crypto from "crypto";
import { createLogger } from "../utils/logger.js";
import { query } from "../db.js";
import { encryptCredentials } from "../lib/encryption.js";

const logger = createLogger("SalesforceAuth");
const router = Router();

const LOGIN_URL = "https://login.salesforce.com";
const AUTHORIZE_URL = `${LOGIN_URL}/services/oauth2/authorize`;
const TOKEN_URL = `${LOGIN_URL}/services/oauth2/token`;

const pendingFlows = new Map<string, { codeVerifier: string; workspaceId: string; createdAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingFlows) {
    if (now - val.createdAt > 10 * 60 * 1000) {
      pendingFlows.delete(key);
    }
  }
}, 60_000);

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(96));
}

function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64url(hash);
}

router.get("/authorize", (req: Request, res: Response) => {
  const workspaceId = req.query.workspaceId as string;

  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId query parameter is required" });
    return;
  }

  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const callbackUrl = process.env.SALESFORCE_CALLBACK_URL;

  if (!clientId || !callbackUrl) {
    res.status(500).json({ error: "Missing SALESFORCE_CLIENT_ID or SALESFORCE_CALLBACK_URL" });
    return;
  }

  const state = crypto.randomBytes(16).toString("hex");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  pendingFlows.set(state, { codeVerifier, workspaceId, createdAt: Date.now() });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: "api refresh_token offline_access id",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const redirectUrl = `${AUTHORIZE_URL}?${params.toString()}`;
  logger.info("Redirecting to Salesforce OAuth", { state });
  res.redirect(redirectUrl);
});

router.get("/callback", async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    logger.error("OAuth error from Salesforce", { error, error_description });
    res.status(400).json({ error, error_description });
    return;
  }

  if (!code || !state || typeof code !== "string" || typeof state !== "string") {
    res.status(400).json({ error: "Missing code or state parameter" });
    return;
  }

  const flow = pendingFlows.get(state);
  if (!flow) {
    res.status(400).json({ error: "Invalid or expired state parameter" });
    return;
  }

  pendingFlows.delete(state);

  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
  const callbackUrl = process.env.SALESFORCE_CALLBACK_URL;

  if (!clientId || !clientSecret || !callbackUrl) {
    res.status(500).json({ error: "Missing Salesforce OAuth environment variables" });
    return;
  }

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      code_verifier: flow.codeVerifier,
    });

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      logger.error("Token exchange failed", { status: tokenResponse.status, tokenData });
      res.status(tokenResponse.status).json({ error: "Token exchange failed", details: tokenData });
      return;
    }

    logger.info("Salesforce OAuth successful", {
      instance_url: tokenData.instance_url,
      token_type: tokenData.token_type,
      scope: tokenData.scope,
    });

    const workspaceId = flow.workspaceId;

    try {
      // Verify workspace exists
      const workspaceResult = await query(
        `SELECT id FROM workspaces WHERE id = $1`,
        [workspaceId]
      );

      if (workspaceResult.rows.length === 0) {
        logger.error("Workspace not found", { workspaceId });
        res.status(404).json({ error: "Workspace not found" });
        return;
      }

      // Encrypt credentials before storing
      const encrypted = encryptCredentials({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        instanceUrl: tokenData.instance_url,
      });

      await query(
        `INSERT INTO connections (workspace_id, connector_name, credentials, status, created_at, updated_at)
         VALUES ($1, 'salesforce', $2, 'connected', NOW(), NOW())
         ON CONFLICT (workspace_id, connector_name) DO UPDATE SET
           credentials = $2, status = 'connected', updated_at = NOW()`,
        [workspaceId, JSON.stringify(encrypted)]
      );

      logger.info("Stored Salesforce connection", { workspaceId });

      // Redirect to workspace connectors page
      res.redirect(`/workspaces/${workspaceId}/connectors`);
      return;
    } catch (storeErr: any) {
      logger.error("Failed to store connection", {
        message: storeErr?.message,
        code: storeErr?.code,
        detail: storeErr?.detail,
        stack: storeErr?.stack?.split('\n').slice(0, 3).join(' | '),
      });
      res.status(500).json({ error: "Failed to store connection" });
      return;
    }
  } catch (err) {
    logger.error("Token exchange error", { error: err });
    res.status(500).json({ error: "Token exchange failed", message: (err as Error).message });
  }
});

export default router;
