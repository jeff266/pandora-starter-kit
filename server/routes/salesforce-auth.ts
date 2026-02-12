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

const STATE_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

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

function signState(payload: object): string {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json).toString("base64");
  const signature = crypto
    .createHmac("sha256", STATE_SECRET)
    .update(json)
    .digest("hex");
  return `${encoded}.${signature}`;
}

function verifyState(signedState: string): { valid: boolean; payload?: any } {
  const dotIndex = signedState.lastIndexOf(".");
  if (dotIndex === -1) return { valid: false };

  const encoded = signedState.slice(0, dotIndex);
  const signature = signedState.slice(dotIndex + 1);

  const json = Buffer.from(encoded, "base64").toString();
  const expectedSignature = crypto
    .createHmac("sha256", STATE_SECRET)
    .update(json)
    .digest("hex");

  if (signature !== expectedSignature) return { valid: false };

  try {
    const parsed = JSON.parse(json);
    if (parsed.ts && Date.now() - parsed.ts > STATE_MAX_AGE_MS) {
      return { valid: false };
    }
    return { valid: true, payload: parsed };
  } catch {
    return { valid: false };
  }
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

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const signedState = signState({ workspaceId, cv: codeVerifier, ts: Date.now() });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: "api refresh_token offline_access id",
    state: signedState,
    prompt: "login consent",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const redirectUrl = `${AUTHORIZE_URL}?${params.toString()}`;
  logger.info("Redirecting to Salesforce OAuth", { workspaceId });
  res.redirect(redirectUrl);
});

router.get("/callback", async (req: Request, res: Response) => {
  const { code, state, error: oauthError, error_description } = req.query;

  if (oauthError) {
    if (oauthError === "access_denied") {
      logger.warn("User denied Salesforce OAuth consent");
      res.redirect("/?error=salesforce_denied");
      return;
    }
    logger.error("OAuth error from Salesforce", { error: oauthError, error_description });
    res.status(400).json({ error: oauthError, error_description });
    return;
  }

  if (!code || !state || typeof code !== "string" || typeof state !== "string") {
    res.status(400).json({ error: "Missing code or state parameter" });
    return;
  }

  const { valid, payload } = verifyState(state);
  if (!valid || !payload?.workspaceId) {
    logger.error("Invalid or tampered state parameter");
    res.status(400).json({ error: "Invalid state signature" });
    return;
  }

  const { workspaceId, cv: codeVerifier } = payload;

  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
  const callbackUrl = process.env.SALESFORCE_CALLBACK_URL;

  if (!clientId || !clientSecret || !callbackUrl) {
    res.status(500).json({ error: "Missing Salesforce OAuth environment variables" });
    return;
  }

  try {
    const tokenParams: Record<string, string> = {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
    };
    if (codeVerifier) {
      tokenParams.code_verifier = codeVerifier;
    }
    const body = new URLSearchParams(tokenParams);

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      logger.error("Token exchange failed", { status: tokenResponse.status, tokenData });
      res.redirect("/?error=salesforce_token_failed");
      return;
    }

    logger.info("Salesforce OAuth successful", {
      instance_url: tokenData.instance_url,
      token_type: tokenData.token_type,
      scope: tokenData.scope,
    });

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
    res.redirect(`/workspaces/${workspaceId}/connectors`);
  } catch (err) {
    logger.error("Token exchange error", { error: err });
    res.redirect("/?error=salesforce_callback_failed");
  }
});

export default router;
