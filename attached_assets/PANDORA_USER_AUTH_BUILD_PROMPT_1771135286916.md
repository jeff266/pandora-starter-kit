# Pandora User Authentication — Build Prompt
## Magic Link Login + Workspace Roles + Invite System

---

## Context

Replace the workspace ID + API key login with a proper user auth 
system. Users log in with their email via magic link (passwordless). 
Once authenticated, they see all workspaces they have access to and 
can switch between them via the sidebar.

The existing workspace API key system stays intact for Slack, 
webhooks, and programmatic access. This is an additional auth 
layer for the frontend, not a replacement.

---

## Read First

Before building, read these files to understand the current state:

1. The auth middleware — find `requireWorkspaceAccess` and `requireAuth`. 
   Understand how workspace API keys work (Bearer token → lookup 
   workspace by api_key column).
2. The workspaces table schema
3. The frontend WorkspaceContext and login page
4. The sidebar component — find the workspace selector (initial + name + chevron)
5. The existing API client pattern (how the frontend calls the backend)

---

## Step 1: Install Dependencies

```bash
npm install resend
```

That's the only new dependency. crypto is built into Node.js.

Resend is a transactional email service. Free tier: 100 emails/day, 
3,000/month. More than enough for auth.

You'll need a RESEND_API_KEY secret. Get one at https://resend.com 
(sign up → API Keys → Create). For now, emails will send from 
onboarding@resend.dev (Resend's shared domain). Later, add a custom 
domain for branded emails.

---

## Step 2: Database Schema

Create a migration:

```sql
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',  -- platform-level: 'admin', 'member'
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);

-- Magic link tokens (short-lived, single-use)
CREATE TABLE IF NOT EXISTS magic_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,          -- null until used, prevents replay
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_magic_links_token ON magic_links(token);

-- Which users can access which workspaces, and what role they have
CREATE TABLE IF NOT EXISTS user_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',  -- 'admin', 'member', 'viewer'
  invited_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, workspace_id)
);

CREATE INDEX idx_user_workspaces_user ON user_workspaces(user_id);
CREATE INDEX idx_user_workspaces_workspace ON user_workspaces(workspace_id);

-- User sessions (long-lived, server-validated)
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_user_sessions_token ON user_sessions(token);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);
```

---

## Step 3: Magic Link Email Service

Create server/services/email.ts:

```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// The FROM address. Use Resend's shared domain for now.
// Later, verify a custom domain (e.g., hello@pandora-revops.com)
const FROM = 'Pandora <onboarding@resend.dev>';

export async function sendMagicLink(
  email: string,
  token: string,
  isNewUser: boolean
): Promise<void> {
  // Build the magic link URL
  // APP_URL should be set in env (e.g., https://pandora-starter-kit.replit.app)
  const baseUrl = process.env.APP_URL || 'http://localhost:5000';
  const magicUrl = `${baseUrl}/auth/verify?token=${token}`;

  const subject = isNewUser 
    ? 'Welcome to Pandora — Verify your email'
    : 'Sign in to Pandora';

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 460px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #e8ecf4; font-size: 20px; margin-bottom: 8px;">
        ${isNewUser ? 'Welcome to Pandora' : 'Sign in to Pandora'}
      </h2>
      <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">
        ${isNewUser 
          ? 'Click the button below to verify your email and get started.' 
          : 'Click the button below to sign in. This link expires in 15 minutes.'}
      </p>
      <a href="${magicUrl}" 
         style="display: inline-block; background: #3b82f6; color: #fff; 
                padding: 12px 28px; border-radius: 6px; font-size: 14px; 
                font-weight: 600; text-decoration: none; margin: 24px 0;">
        ${isNewUser ? 'Verify Email' : 'Sign In'}
      </a>
      <p style="color: #5a6578; font-size: 12px; margin-top: 32px;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `;

  // Dev mode: log to console if no email service configured
  if (!process.env.RESEND_API_KEY) {
    console.log(`\n[Auth] Magic link for ${email}:\n${magicUrl}\n`);
    return;
  }

  await resend.emails.send({ from: FROM, to: email, subject, html });
}
```

---

## Step 4: Auth Endpoints

Create server/routes/user-auth.ts:

### POST /api/auth/login

Request a magic link. Works for both existing and new users.

```
Body: { email: string, name?: string }

- name is required only for new users (first time logging in)
- email is case-insensitive (lowercase before storing/looking up)

Flow:
  1. Lowercase the email
  2. Look up user by email
  3. If user doesn't exist AND name is provided:
     - Create user record (email, name, role='member')
     - Set isNewUser = true
  4. If user doesn't exist AND name is NOT provided:
     - Return { status: 'new_user', message: 'Please provide your name to create an account' }
     - The frontend will show a name input and resubmit
  5. Generate magic link token:
     - token = crypto.randomBytes(32).toString('hex')
     - expires_at = now + 15 minutes
     - Insert into magic_links table
  6. Send magic link email (or log to console if no RESEND_API_KEY)
  7. Return { status: 'sent', message: 'Check your email for a sign-in link' }

Response: 200
```

### GET /api/auth/verify?token=xxx

Verify the magic link and create a session. This is the URL in the email.

```
Flow:
  1. Look up token in magic_links table
  2. Validate:
     - Token exists
     - expires_at > now()
     - used_at IS NULL (not already used)
  3. If invalid: return 401 { error: 'Invalid or expired link' }
  4. Mark token as used: UPDATE magic_links SET used_at = now()
  5. Look up user by magic_links.email
  6. Update user.last_login_at
  7. Create session:
     - session_token = crypto.randomBytes(32).toString('hex')
     - expires_at = now + 30 days
     - Insert into user_sessions
  8. Redirect to frontend with session token:
     - Redirect to: /auth/callback?session=<session_token>
     - The frontend catches this route, stores the token, navigates to /

Do NOT return JSON — the user clicks this link in their email 
browser, so it must be a redirect that lands them in the app.
```

### POST /api/auth/logout

```
Headers: Authorization: Bearer <session_token>

Flow:
  1. Delete session from user_sessions
  2. Return { success: true }
```

### GET /api/auth/me

Returns the current user and their workspaces.

```
Headers: Authorization: Bearer <session_token>

Flow:
  1. Validate session (lookup in user_sessions, check expires_at)
  2. Fetch user
  3. Fetch workspaces with metadata:

SELECT 
  w.id, w.name, w.slug,
  uw.role,
  (SELECT count(*) FROM connector_configs cc 
   WHERE cc.workspace_id = w.id AND cc.status = 'connected') as connector_count,
  (SELECT count(*) FROM deals d 
   WHERE d.workspace_id = w.id AND d.is_open = true) as deal_count,
  (SELECT max(cc.last_sync_at) FROM connector_configs cc 
   WHERE cc.workspace_id = w.id) as last_sync
FROM user_workspaces uw
JOIN workspaces w ON w.id = uw.workspace_id
WHERE uw.user_id = $1
ORDER BY w.name;

  4. Return:
     {
       user: { id, email, name, role },
       workspaces: [
         { id, name, slug, role, connector_count, deal_count, last_sync }
       ]
     }
```

### POST /api/auth/workspaces/join

Associate the current user with a workspace using the workspace's 
API key as proof of access. One-time action per workspace.

```
Headers: Authorization: Bearer <session_token>
Body: { api_key: string }

Flow:
  1. Validate session
  2. Look up workspace by api_key
  3. If not found: return 404
  4. Check if user already has access → 409 if yes
  5. Check if this workspace has ANY existing user_workspaces rows:
     - If no (first user): role = 'admin'
     - If yes: role = 'member'
  6. Insert into user_workspaces
  7. Return workspace details with role
```

---

## Step 5: Workspace Member Management

### POST /api/workspaces/:workspaceId/members/invite

Admin-only. Invite a user to a workspace.

```
Headers: Authorization: Bearer <session_token>
Body: { email: string, role: 'admin' | 'member' | 'viewer', name?: string }

Flow:
  1. Validate session
  2. Verify requesting user has 'admin' role on this workspace
  3. Lowercase the email
  4. Find or create the user:
     - If user exists: use their id
     - If not: create user (email, name or email-prefix as name)
  5. Check if already has access → 409
  6. Insert into user_workspaces (user_id, workspace_id, role, invited_by)
  7. Send invite magic link email
  8. Return { user_id, email, role }
```

### GET /api/workspaces/:workspaceId/members

Any workspace member can see the member list.

```
SELECT u.id, u.email, u.name, uw.role, uw.created_at
FROM user_workspaces uw
JOIN users u ON u.id = uw.user_id
WHERE uw.workspace_id = $1
ORDER BY 
  CASE uw.role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, 
  u.name;
```

### PATCH /api/workspaces/:workspaceId/members/:userId

Admin-only. Change a member's role.

```
Body: { role: 'admin' | 'member' | 'viewer' }

Validation: prevent demoting the last admin.
```

### DELETE /api/workspaces/:workspaceId/members/:userId

Admin-only. Remove a member.

```
Validation: prevent removing yourself if you're the last admin.
```

---

## Step 6: Role-Based Middleware

Create server/middleware/require-role.ts:

```typescript
const ROLE_LEVEL = { viewer: 0, member: 1, admin: 2 };

function requireRole(minimumRole: 'viewer' | 'member' | 'admin') {
  return (req, res, next) => {
    // API key auth = full admin access
    if (req.authMethod === 'api_key') return next();
    
    const userRole = req.userWorkspaceRole;
    if (!userRole || ROLE_LEVEL[userRole] < ROLE_LEVEL[minimumRole]) {
      return res.status(403).json({ 
        error: `Requires ${minimumRole} role` 
      });
    }
    next();
  };
}
```

Apply to endpoints:

```
requireRole('admin'):
  - PATCH /workspace-config/* (voice, thresholds)
  - POST /connectors/*/connect, /disconnect
  - PATCH /skills/*/schedule
  - POST /members/invite
  - PATCH /members/:userId
  - DELETE /members/:userId

requireRole('member'):
  - POST /skills/:skillId/run
  - POST /analyze

requireRole('viewer'):
  - All GET endpoints (default — if you have workspace access, you can read)
```

---

## Step 7: Update Auth Middleware

Modify the existing `requireWorkspaceAccess` to support BOTH 
workspace API keys and user session tokens:

```typescript
async function requireWorkspaceAccess(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const token = authHeader.slice(7);
  const workspaceId = req.params.workspaceId;
  
  // Path 1: Workspace API key (existing — keeps Slack/webhooks working)
  const wsResult = await db.query(
    'SELECT id FROM workspaces WHERE id = $1 AND api_key = $2',
    [workspaceId, token]
  );
  
  if (wsResult.rows.length > 0) {
    req.workspace = { id: workspaceId };
    req.authMethod = 'api_key';
    req.userWorkspaceRole = 'admin';
    return next();
  }
  
  // Path 2: User session token (new — for frontend)
  const session = await db.query(`
    SELECT us.user_id, u.email, u.name, u.role as platform_role
    FROM user_sessions us
    JOIN users u ON u.id = us.user_id
    WHERE us.token = $1 AND us.expires_at > now()
  `, [token]);
  
  if (session.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  const user = session.rows[0];
  
  const access = await db.query(
    'SELECT role FROM user_workspaces WHERE user_id = $1 AND workspace_id = $2',
    [user.user_id, workspaceId]
  );
  
  if (access.rows.length === 0) {
    return res.status(403).json({ error: 'No access to this workspace' });
  }
  
  req.workspace = { id: workspaceId };
  req.user = user;
  req.authMethod = 'session';
  req.userWorkspaceRole = access.rows[0].role;
  next();
}
```

Backward compatible. Slack, webhooks, curl — nothing breaks.

---

## Step 8: Frontend Changes

### 8a: Auth Context

Replace the existing WorkspaceContext:

```typescript
interface AuthState {
  user: { id: string; email: string; name: string } | null;
  token: string | null;
  workspaces: WorkspaceInfo[];
  currentWorkspace: WorkspaceInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  role: 'admin' | 'member' | 'viewer';
  connector_count: number;
  deal_count: number;
  last_sync: string | null;
}
```

On app load:
1. Check localStorage for session token
2. If found: GET /api/auth/me
3. If valid: populate state, auto-select workspace 
   (single → auto, multiple → check localStorage for last used)
4. If 0 workspaces: show join screen
5. If invalid/missing: show login

### 8b: Login Flow

5 screens, all using the existing dark theme:

**Screen 1: Email Input**
- "Sign in to Pandora" heading
- Email input field
- "Continue" button → POST /api/auth/login { email }
- If response.status === 'new_user' → show name input (Screen 1b)
- If response.status === 'sent' → show check-email (Screen 2)

**Screen 1b: New User Name**
- "Welcome! What's your name?" heading
- Name input field
- "Create Account" button → POST /api/auth/login { email, name }
- → Screen 2

**Screen 2: Check Your Email**
- Envelope icon
- "We sent a sign-in link to {email}"
- "Expires in 15 minutes"
- "Resend" link (calls POST /api/auth/login again)

**Screen 3: Auth Callback (route: /auth/callback?session=xxx)**
- "Signing you in..." loading state
- Extract token from URL, store in localStorage
- Call GET /api/auth/me, populate context
- Navigate to / (or workspace picker if multiple)

**Screen 4: Workspace Picker (if 2+ workspaces)**
- Grid of workspace cards showing name, role badge, stats
- Click to select → navigate to Command Center
- "+ Join Another Workspace" at bottom

**Screen 5: Join Workspace (if 0 workspaces or explicitly chosen)**
- "Enter a workspace API key"
- API key input
- "Join" button → POST /api/auth/workspaces/join { api_key }

### 8c: Sidebar Workspace Switcher

Make the existing workspace selector functional:
- Shows current workspace initial + name + role
- Click → dropdown of all workspaces
- Current workspace has checkmark
- Click another → switch (update context, navigate to /, refetch data)
- "+ Join Workspace" at bottom of dropdown

### 8d: User Menu (sidebar footer)

- Shows user initials circle + name + workspace role
- Click → dropdown: "Members", "Sign Out"
- Sign Out: POST /api/auth/logout → clear localStorage → login page

### 8e: Members Page (route: /members)

Table of workspace members. Admins see role change + remove buttons.

"Invite Member" button (admin only) → modal with:
- Email input
- Role selector (Admin / Member / Viewer) with descriptions
- "Send Invite" button

### 8f: API Client

Replace workspace API key with session token:
```
headers: { 'Authorization': `Bearer ${sessionToken}` }
```
URL still uses currentWorkspace.id for the workspace path segment.

### 8g: Role-Aware UI

Hide actions users can't perform:
- Viewers: no "Run Now" on skills, no "Ask Pandora" input
- Members: no settings links, no member management
- Admins: see everything

This is cosmetic only — backend enforces real permissions.

---

## Step 9: Seed Script

```typescript
// scripts/seed-user.ts
async function seedUser() {
  const user = await db.query(`
    INSERT INTO users (email, name, role)
    VALUES ('jeff@pandora-revops.com', 'Jeff Chen', 'admin')
    ON CONFLICT (email) DO UPDATE SET name = 'Jeff Chen'
    RETURNING id
  `);
  
  const userId = user.rows[0].id;
  
  const workspaces = await db.query('SELECT id, name FROM workspaces');
  for (const ws of workspaces.rows) {
    await db.query(`
      INSERT INTO user_workspaces (user_id, workspace_id, role)
      VALUES ($1, $2, 'admin')
      ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = 'admin'
    `, [userId, ws.id]);
    console.log(`Linked: ${ws.name} (admin)`);
  }
  
  console.log(`\nDone. Log in at the app with jeff@pandora-revops.com`);
}
```

---

## Step 10: Session Cleanup

Add to existing cron scheduler (run daily):

```sql
DELETE FROM user_sessions WHERE expires_at < now();
DELETE FROM magic_links WHERE expires_at < now();
```

---

## Step 11: Route Mounting

```typescript
import userAuthRouter from './routes/user-auth';

// Auth routes — mounted BEFORE workspace auth middleware
app.use('/api/auth', userAuthRouter);

// Member management — inside workspace-scoped router
workspaceApiRouter.use('/:workspaceId/members', membersRouter);
```

---

## Environment Variables

```
RESEND_API_KEY=re_xxxxxxxxxxxx     # From resend.com (free tier)
APP_URL=https://pandora-starter-kit.replit.app  # Your deploy URL
```

If RESEND_API_KEY is not set, magic links print to server console.

---

## What NOT to Build

- Password auth (magic links = no passwords to breach)
- Google OAuth / SSO (requires console config, add later)
- Two-factor auth (future enterprise feature)
- Rate limiting on login (add if abuse occurs)
- Rep-level row scoping (complex, future)
- Workspace creation UI (API-only for now)
- Custom Resend domain (later for branding)
- Email change flow (edge case, handle manually for now)

---

## Verification Checklist

1. Run seed script → Jeff exists, linked to all workspaces as admin
2. Open app → email login page appears
3. Enter email → "Check your email" screen
4. If no RESEND_API_KEY: magic link URL in server console
5. Click magic link → redirected to app, signed in
6. 1 workspace → Command Center loads directly
7. 2+ workspaces → picker shown, select one
8. Command Center loads with real data
9. Sidebar workspace selector → dropdown with all workspaces
10. Switch workspace → data refreshes
11. Sign Out → returns to login, localStorage cleared
12. Refresh page → stays logged in
13. /members → shows workspace members with roles
14. Invite new email → magic link email sent (or logged)
15. curl with workspace API key → still works
16. Slack → still works (uses API key, not session)
17. Viewer cannot run skills (button hidden + 403 on POST)
18. Admin can change member roles
