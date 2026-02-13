import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ContactRoleResolution');

const CRM_ROLE_MAP: Record<string, string> = {
  'decision maker': 'decision_maker',
  'dm': 'decision_maker',
  'economic buyer': 'economic_buyer',
  'budget holder': 'economic_buyer',
  'champion': 'champion',
  'advocate': 'champion',
  'internal sponsor': 'champion',
  'technical evaluator': 'technical_evaluator',
  'technical buyer': 'technical_evaluator',
  'influencer': 'influencer',
  'stakeholder': 'influencer',
  'end user': 'end_user',
  'user': 'end_user',
};

const DEAL_FIELD_ROLE_MAP: Record<string, string> = {
  'champion_name': 'champion',
  'champion': 'champion',
  'economic_buyer': 'economic_buyer',
  'economic_buyer_name': 'economic_buyer',
  'decision_maker': 'decision_maker',
  'decision_maker_name': 'decision_maker',
  'technical_evaluator': 'technical_evaluator',
  'technical_evaluator_name': 'technical_evaluator',
};

const TITLE_ROLE_PATTERNS: Array<{ pattern: RegExp; role: string }> = [
  { pattern: /\b(vp|vice president|director).*financ/i, role: 'economic_buyer' },
  { pattern: /\b(cto|vp|director).*(engineer|tech)/i, role: 'technical_evaluator' },
  { pattern: /\b(ceo|coo|cro|president|gm|general manager)/i, role: 'decision_maker' },
  { pattern: /\b(manager|team lead|head of)/i, role: 'influencer' },
];

function mapCrmRole(role: string): string {
  const normalized = role.trim().toLowerCase();
  return CRM_ROLE_MAP[normalized] || role.trim();
}

function fuzzyNameMatch(fieldValue: string, firstName: string | null, lastName: string | null): boolean {
  if (!fieldValue) return false;
  const val = fieldValue.trim().toLowerCase();
  if (!val) return false;

  const full = [firstName, lastName].filter(Boolean).join(' ').toLowerCase();
  if (full && val === full) return true;

  if (lastName) {
    const ln = lastName.toLowerCase();
    if (val.includes(ln) && val.length < ln.length + 20) return true;
  }

  if (firstName && lastName) {
    const fn = firstName.toLowerCase();
    const ln = lastName.toLowerCase();
    if (val.includes(fn) && val.includes(ln)) return true;
  }

  return false;
}

export async function resolveContactRoles(
  workspaceId: string,
  dealId: string,
  source: 'hubspot' | 'salesforce' | 'file_import'
): Promise<{
  contactCount: number;
  rolesResolved: number;
  rolesSummary: Record<string, number>;
}> {
  logger.info('Starting contact role resolution', { workspaceId, dealId, source });

  const contactsResult = await query(
    `SELECT dc.id, dc.contact_id, dc.buying_role, dc.role_confidence,
            c.first_name, c.last_name, c.email, c.title, c.account_id
     FROM deal_contacts dc
     JOIN contacts c ON c.id = dc.contact_id
     WHERE dc.workspace_id = $1 AND dc.deal_id = $2`,
    [workspaceId, dealId]
  );

  const contacts = contactsResult.rows;
  const contactCount = contacts.length;
  const resolved = new Map<string, { role: string; source: string; confidence: number }>();

  await applyCrmContactRoles(workspaceId, dealId, source, contacts, resolved);
  await applyCrmDealFields(workspaceId, dealId, contacts, resolved);
  await applyCrossDealPatterns(workspaceId, dealId, contacts, resolved);
  applyTitleInference(contacts, resolved);

  let rolesResolved = 0;
  const rolesSummary: Record<string, number> = {};

  for (const [contactId, assignment] of Array.from(resolved.entries())) {
    await query(
      `INSERT INTO deal_contacts (workspace_id, deal_id, contact_id, source)
       VALUES ($1, $2, $3, 'enrichment')
       ON CONFLICT (workspace_id, deal_id, contact_id, source) DO NOTHING`,
      [workspaceId, dealId, contactId]
    );

    const updateResult = await query(
      `UPDATE deal_contacts
       SET buying_role = $1, role_source = $2, role_confidence = $3, updated_at = NOW()
       WHERE workspace_id = $4 AND deal_id = $5 AND contact_id = $6
         AND (role_confidence IS NULL OR role_confidence < $3)`,
      [assignment.role, assignment.source, assignment.confidence, workspaceId, dealId, contactId]
    );

    if (updateResult.rowCount && updateResult.rowCount > 0) {
      rolesResolved++;
      rolesSummary[assignment.role] = (rolesSummary[assignment.role] || 0) + 1;
    }
  }

  logger.info('Contact role resolution complete', { workspaceId, dealId, contactCount, rolesResolved, rolesSummary });

  return { contactCount, rolesResolved, rolesSummary };
}

async function applyCrmContactRoles(
  workspaceId: string,
  dealId: string,
  source: 'hubspot' | 'salesforce' | 'file_import',
  contacts: any[],
  resolved: Map<string, { role: string; source: string; confidence: number }>
): Promise<void> {
  const CONFIDENCE = 0.95;
  let crmContacts: any[] = [];

  if (source === 'hubspot') {
    const result = await query(
      `SELECT contact_id, role FROM deal_contacts
       WHERE workspace_id = $1 AND deal_id = $2 AND source = 'hubspot_association' AND role IS NOT NULL`,
      [workspaceId, dealId]
    );
    crmContacts = result.rows;
  } else if (source === 'salesforce') {
    const result = await query(
      `SELECT contact_id, role FROM deal_contacts
       WHERE workspace_id = $1 AND deal_id = $2 AND source = 'salesforce' AND role IS NOT NULL`,
      [workspaceId, dealId]
    );
    crmContacts = result.rows;
  }

  for (const row of crmContacts) {
    const mappedRole = mapCrmRole(row.role);
    const existing = resolved.get(row.contact_id);
    if (!existing || existing.confidence < CONFIDENCE) {
      resolved.set(row.contact_id, {
        role: mappedRole,
        source: 'crm_contact_role',
        confidence: CONFIDENCE,
      });
    }
  }
}

async function applyCrmDealFields(
  workspaceId: string,
  dealId: string,
  contacts: any[],
  resolved: Map<string, { role: string; source: string; confidence: number }>
): Promise<void> {
  const CONFIDENCE = 0.85;

  const dealResult = await query(
    `SELECT custom_fields FROM deals WHERE id = $1 AND workspace_id = $2`,
    [dealId, workspaceId]
  );

  if (dealResult.rows.length === 0) return;

  const customFields = dealResult.rows[0].custom_fields || {};

  for (const [fieldKey, buyingRole] of Object.entries(DEAL_FIELD_ROLE_MAP)) {
    const fieldValue = customFields[fieldKey];
    if (!fieldValue || typeof fieldValue !== 'string') continue;

    for (const contact of contacts) {
      const existing = resolved.get(contact.contact_id);
      if (existing && existing.confidence >= CONFIDENCE) continue;

      if (fuzzyNameMatch(fieldValue, contact.first_name, contact.last_name)) {
        resolved.set(contact.contact_id, {
          role: buyingRole,
          source: 'crm_deal_field',
          confidence: CONFIDENCE,
        });
        break;
      }
    }
  }
}

async function applyCrossDealPatterns(
  workspaceId: string,
  dealId: string,
  contacts: any[],
  resolved: Map<string, { role: string; source: string; confidence: number }>
): Promise<void> {
  const CONFIDENCE = 0.70;

  const contactIds = contacts.map(c => c.contact_id);
  if (contactIds.length === 0) return;

  const dealResult = await query(
    `SELECT account_id FROM deals WHERE id = $1 AND workspace_id = $2`,
    [dealId, workspaceId]
  );

  if (dealResult.rows.length === 0 || !dealResult.rows[0].account_id) return;

  const accountId = dealResult.rows[0].account_id;

  const placeholders = contactIds.map((_, i) => `$${i + 4}`).join(', ');
  const crossResult = await query(
    `SELECT dc.contact_id, dc.buying_role, dc.role_confidence
     FROM deal_contacts dc
     JOIN deals d ON d.id = dc.deal_id AND d.workspace_id = dc.workspace_id
     WHERE dc.workspace_id = $1
       AND dc.deal_id != $2
       AND d.account_id = $3
       AND dc.contact_id IN (${placeholders})
       AND dc.buying_role IS NOT NULL
     ORDER BY dc.role_confidence DESC NULLS LAST`,
    [workspaceId, dealId, accountId, ...contactIds]
  );

  for (const row of crossResult.rows) {
    const existing = resolved.get(row.contact_id);
    if (existing && existing.confidence >= CONFIDENCE) continue;

    resolved.set(row.contact_id, {
      role: row.buying_role,
      source: 'cross_deal_pattern',
      confidence: CONFIDENCE,
    });
  }
}

function applyTitleInference(
  contacts: any[],
  resolved: Map<string, { role: string; source: string; confidence: number }>
): void {
  const CONFIDENCE = 0.50;

  for (const contact of contacts) {
    if (!contact.title) continue;

    const existing = resolved.get(contact.contact_id);
    if (existing && existing.confidence >= CONFIDENCE) continue;

    for (const { pattern, role } of TITLE_ROLE_PATTERNS) {
      if (pattern.test(contact.title)) {
        resolved.set(contact.contact_id, {
          role,
          source: 'title_inference',
          confidence: CONFIDENCE,
        });
        break;
      }
    }
  }
}

export async function getContactsForDeal(
  workspaceId: string,
  dealId: string
): Promise<Array<{
  id: string;
  contact_id: string;
  name: string;
  email: string;
  title: string;
  buying_role: string | null;
  role_source: string | null;
  role_confidence: number;
}>> {
  const result = await query(
    `SELECT dc.id, dc.contact_id,
            COALESCE(TRIM(CONCAT(c.first_name, ' ', c.last_name)), '') AS name,
            COALESCE(c.email, '') AS email,
            COALESCE(c.title, '') AS title,
            dc.buying_role,
            dc.role_source,
            COALESCE(dc.role_confidence, 0) AS role_confidence
     FROM deal_contacts dc
     JOIN contacts c ON c.id = dc.contact_id
     WHERE dc.workspace_id = $1 AND dc.deal_id = $2
     ORDER BY dc.role_confidence DESC NULLS LAST, dc.created_at ASC`,
    [workspaceId, dealId]
  );

  return result.rows;
}
