import { Router, Request, Response } from "express";
import crypto from "crypto";
import { createLogger } from "../utils/logger.js";
import { query } from "../db.js";
import { encryptCredentials } from "../lib/encryption.js";

const logger = createLogger("HubSpotAuth");
const router = Router();

const AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize";
const TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";

const STATE_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

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

/**
 * GET /api/auth/hubspot/authorize?workspaceId=xxx
 * Initiates HubSpot OAuth flow - redirects browser to HubSpot
 */
function handleAuthorize(req: Request, res: Response): void {
  const workspaceId = req.query.workspaceId as string;

  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId query parameter is required" });
    return;
  }

  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const callbackUrl = process.env.HUBSPOT_CALLBACK_URL;

  if (!clientId || !callbackUrl) {
    res.status(500).json({ error: "Missing HUBSPOT_CLIENT_ID or HUBSPOT_CALLBACK_URL environment variables" });
    return;
  }

  // Sign state with workspace ID and timestamp
  const signedState = signState({ workspaceId, ts: Date.now() });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: "crm.objects.contacts.read crm.objects.contacts.write crm.objects.companies.read crm.objects.companies.write crm.objects.deals.read crm.objects.deals.write crm.schemas.contacts.read crm.schemas.companies.read crm.schemas.deals.read",
    state: signedState,
  });

  const redirectUrl = `${AUTHORIZE_URL}?${params.toString()}`;
  logger.info("Redirecting to HubSpot OAuth", { workspaceId });
  res.redirect(redirectUrl);
}

// Root route - same as /authorize
router.get("/", handleAuthorize);

router.get("/authorize", handleAuthorize);

/**
 * GET /api/auth/hubspot/callback?code=xxx&state=xxx
 * HubSpot redirects here after user authorizes
 */
router.get("/callback", async (req: Request, res: Response) => {
  const { code, state, error: oauthError } = req.query;

  // Handle OAuth errors
  if (oauthError) {
    if (oauthError === "access_denied") {
      logger.warn("User denied HubSpot OAuth consent");
      res.redirect("/?error=hubspot_denied");
      return;
    }
    logger.error(`OAuth error from HubSpot: ${oauthError}`);
    res.status(400).json({ error: oauthError });
    return;
  }

  // Validate parameters
  if (!code || !state || typeof code !== "string" || typeof state !== "string") {
    res.status(400).json({ error: "Missing code or state parameter" });
    return;
  }

  // Verify state signature and extract workspace ID
  const { valid, payload } = verifyState(state);
  if (!valid || !payload?.workspaceId) {
    logger.error("Invalid or tampered state parameter");
    res.status(400).json({ error: "Invalid state signature" });
    return;
  }

  const { workspaceId } = payload;

  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  const callbackUrl = process.env.HUBSPOT_CALLBACK_URL;

  if (!clientId || !clientSecret || !callbackUrl) {
    res.status(500).json({ error: "Missing HubSpot OAuth environment variables" });
    return;
  }

  try {
    // Exchange authorization code for access token
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      code,
    });

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });

    const tokenData: any = await tokenResponse.json();

    if (!tokenResponse.ok) {
      logger.error(`Token exchange failed: ${tokenResponse.status}`);
      res.redirect("/?error=hubspot_token_failed");
      return;
    }

    logger.info("HubSpot OAuth successful");

    // Verify workspace exists
    const workspaceResult = await query(
      `SELECT id FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      logger.error(`Workspace not found: ${workspaceId}`);
      res.status(404).json({ error: "Workspace not found" });
      return;
    }

    // Encrypt credentials before storing
    const encrypted = encryptCredentials({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
    });

    // Store connection in database
    await query(
      `INSERT INTO connections (workspace_id, connector_name, auth_method, credentials, status, created_at, updated_at)
       VALUES ($1, 'hubspot', 'oauth', $2, 'connected', NOW(), NOW())
       ON CONFLICT (workspace_id, connector_name) DO UPDATE SET
         credentials = $2, status = 'connected', updated_at = NOW()`,
      [workspaceId, JSON.stringify(encrypted)]
    );

    logger.info("Stored HubSpot connection", { workspaceId });

    // Redirect back to connectors page
    res.redirect(`/workspaces/${workspaceId}/connectors`);
  } catch (err) {
    logger.error(`Token exchange error: ${err instanceof Error ? err.message : String(err)}`);
    res.redirect("/?error=hubspot_callback_failed");
  }
});

export default router;
