import { Router, Request, Response } from "express";
import crypto from "crypto";
import { createLogger } from "../utils/logger.js";
import { query } from "../db.js";

const logger = createLogger("SalesforceAuth");
const router = Router();

const LOGIN_URL = "https://login.salesforce.com";
const AUTHORIZE_URL = `${LOGIN_URL}/services/oauth2/authorize`;
const TOKEN_URL = `${LOGIN_URL}/services/oauth2/token`;

const pendingFlows = new Map<string, { codeVerifier: string; createdAt: number }>();

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

router.get("/authorize", (_req: Request, res: Response) => {
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const callbackUrl = process.env.SALESFORCE_CALLBACK_URL;

  if (!clientId || !callbackUrl) {
    res.status(500).json({ error: "Missing SALESFORCE_CLIENT_ID or SALESFORCE_CALLBACK_URL" });
    return;
  }

  const state = crypto.randomBytes(16).toString("hex");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  pendingFlows.set(state, { codeVerifier, createdAt: Date.now() });

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

    try {
      let workspaceResult = await query(
        `SELECT id FROM workspaces WHERE name = 'Imubit' LIMIT 1`
      );

      let workspaceId: string;
      if (workspaceResult.rows.length === 0) {
        const createResult = await query(
          `INSERT INTO workspaces (name, settings) VALUES ('Imubit', '{}') RETURNING id`
        );
        workspaceId = createResult.rows[0].id;
      } else {
        workspaceId = workspaceResult.rows[0].id;
      }

      await query(
        `INSERT INTO connections (workspace_id, connector_name, credentials, status, created_at, updated_at)
         VALUES ($1, 'salesforce', $2, 'connected', NOW(), NOW())
         ON CONFLICT (workspace_id, connector_name) DO UPDATE SET
           credentials = $2, status = 'connected', updated_at = NOW()`,
        [workspaceId, JSON.stringify({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          instanceUrl: tokenData.instance_url,
        })]
      );

      logger.info("Stored Salesforce connection", { workspaceId });
    } catch (storeErr) {
      logger.error("Failed to store connection", { error: storeErr });
    }

    res.json({
      message: "Salesforce OAuth successful",
      instance_url: tokenData.instance_url,
      token_type: tokenData.token_type,
      scope: tokenData.scope,
      id: tokenData.id,
      has_access_token: !!tokenData.access_token,
      has_refresh_token: !!tokenData.refresh_token,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
    });
  } catch (err) {
    logger.error("Token exchange error", { error: err });
    res.status(500).json({ error: "Token exchange failed", message: (err as Error).message });
  }
});

export default router;
