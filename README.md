# Pandora - Multi-Tenant GTM Intelligence Platform

A multi-tenant platform for GTM (Go-To-Market) intelligence, connecting to various data sources like CRMs, conversation intelligence tools, and more.

## Environment Variables

Create a `.env` file in the root directory with the following variables:

### Database
```bash
DATABASE_URL=postgresql://user:password@localhost:5432/pandora
```

### Credential Encryption
```bash
# CRITICAL: Master encryption key for OAuth tokens and credentials
# Generate once using: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CREDENTIAL_ENCRYPTION_KEY=<64-character-hex-string>
```

**⚠️ IMPORTANT: Credential Encryption Key**
- This is the master key for encrypting OAuth tokens and API keys at rest
- **Must be exactly 64 hexadecimal characters** (32 bytes)
- **If lost, all stored credentials become unreadable** - backup securely
- Generate a new key for each environment (dev, staging, prod)
- Store securely in your secrets manager (e.g., AWS Secrets Manager, Vault)
- Never commit this key to version control

### Salesforce (Optional)
```bash
SALESFORCE_CLIENT_ID=your_salesforce_client_id
SALESFORCE_CLIENT_SECRET=your_salesforce_client_secret
SALESFORCE_CALLBACK_URL=http://localhost:3000/api/auth/salesforce/callback
```

### HubSpot (Optional)
```bash
HUBSPOT_CLIENT_ID=your_hubspot_client_id
HUBSPOT_CLIENT_SECRET=your_hubspot_client_secret
HUBSPOT_CALLBACK_URL=http://localhost:3000/api/auth/hubspot/callback
```

### Session Security (Optional, defaults provided)
```bash
SESSION_SECRET=your_session_secret_for_oauth_state_signing
```

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Up Database
```bash
# Create database
createdb pandora

# Run migrations
psql -d pandora -f migrations/001_initial.sql
psql -d pandora -f migrations/002_quotas.sql
# ... run all migrations in order
```

### 3. Generate Encryption Key
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the output to `CREDENTIAL_ENCRYPTION_KEY` in your `.env` file.

### 4. Start Server
```bash
npm run dev
```

The server will start on `http://localhost:3000`.

## Security: Credential Encryption

All OAuth tokens and API keys are encrypted at rest using **AES-256-GCM envelope encryption**.

### How It Works
- All credentials stored in `connections.credentials` are encrypted before writing to the database
- Encryption/decryption is transparent to connector code
- Uses Node.js built-in `crypto` module (no external dependencies)
- Backward compatible: reads both encrypted and plaintext credentials during migration

### Migrating Existing Credentials
If you have existing plaintext credentials in the database, run the migration script:

```bash
npx tsx scripts/encrypt-existing-credentials.ts
```

This will:
1. Find all connections with plaintext credentials
2. Encrypt them using your `CREDENTIAL_ENCRYPTION_KEY`
3. Update the database
4. Report how many credentials were encrypted

### Key Rotation
To rotate the encryption key:
1. Decrypt all credentials using the old key
2. Update `CREDENTIAL_ENCRYPTION_KEY` with a new key
3. Re-encrypt all credentials
4. Update your secrets manager

(Automated key rotation script coming soon)

## Architecture

### Connectors
- **HubSpot**: CRM connector with OAuth2 authentication
- **Salesforce**: CRM connector with OAuth2 authentication
- **Fireflies**: Conversation intelligence connector with API key authentication
- **Gong**: Conversation intelligence connector with basic authentication
- **Monday**: Task management connector
- **Google Drive**: Document connector

### Skills
Pandora includes automated skills that run on schedules:
- **Pipeline Waterfall**: Stage-by-stage pipeline flow analysis
- **Rep Scorecard**: Composite performance scoring
- **Forecast Rollup**: Team forecast aggregation
- **Deal Risk Detection**: At-risk deal identification
- **Single Thread Alert**: Multi-stakeholder opportunity tracking

### Sync System
- **Initial Sync**: Full data fetch on first connection
- **Incremental Sync**: Change detection using `last_sync_at` timestamps
- **Multi-Tenant Isolation**: Workspace-scoped data with UUID primary keys
- **Computed Fields**: Real-time field calculations (velocity, risk scores, etc.)

## API Endpoints

### Workspaces
- `POST /api/workspaces` - Create workspace
- `GET /api/workspaces` - List workspaces
- `GET /api/workspaces/:id` - Get workspace details

### Connectors
- `POST /api/workspaces/:id/connectors/:connector/connect` - Connect to data source
- `POST /api/workspaces/:id/connectors/:connector/sync` - Trigger sync
- `GET /api/workspaces/:id/connectors/:connector/health` - Check connection health
- `DELETE /api/workspaces/:id/connectors/:connector/disconnect` - Disconnect

### OAuth
- `GET /api/auth/salesforce/authorize?workspaceId=:id` - Start Salesforce OAuth flow
- `GET /api/auth/salesforce/callback` - Salesforce OAuth callback

### Data
- `GET /api/workspaces/:id/deals` - List deals
- `GET /api/workspaces/:id/contacts` - List contacts
- `GET /api/workspaces/:id/accounts` - List accounts
- `GET /api/workspaces/:id/deals/:dealId/stage-history` - Get deal stage history

## Development

### Running Tests
```bash
npm test
```

### Debugging
Set `DEBUG=pandora:*` environment variable for verbose logging.

### Code Structure
```
server/
├── connectors/        # Data source integrations
│   ├── salesforce/
│   ├── hubspot/
│   ├── fireflies/
│   └── gong/
├── routes/            # API route handlers
├── skills/            # Automated intelligence skills
├── sync/              # Sync orchestration
├── analysis/          # Analytics engines
├── computed-fields/   # Real-time field calculations
└── lib/               # Shared utilities (encryption, etc.)
```

## License

Proprietary
