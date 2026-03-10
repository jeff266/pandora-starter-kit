/**
 * Email Normalization for Role-Based Access Control
 *
 * Ensures consistent email matching between:
 * - User login emails (from auth)
 * - CRM owner emails (from HubSpot/Salesforce sync)
 * - Workspace member emails
 */

/**
 * Normalize email to canonical form for comparison
 *
 * Rules:
 * 1. Lowercase (John.Doe@x.com → john.doe@x.com)
 * 2. Trim whitespace
 * 3. Strip plus addressing (john+crm@x.com → john@x.com)
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;

  return email
    .toLowerCase()
    .trim()
    .replace(/\+[^@]*@/, '@');  // Strip +tag before @
}

/**
 * Check if two emails are equivalent after normalization
 */
export function areEmailsEquivalent(
  email1: string | null | undefined,
  email2: string | null | undefined
): boolean {
  const norm1 = normalizeEmail(email1);
  const norm2 = normalizeEmail(email2);

  if (!norm1 || !norm2) return false;
  return norm1 === norm2;
}

/**
 * Get all email variants for a user (for scope filtering)
 *
 * Currently just returns normalized email.
 * Future: query email_aliases table if we add it.
 */
export async function getAllEmailsForUser(
  workspaceId: string,
  userEmail: string
): Promise<string[]> {
  const normalized = normalizeEmail(userEmail);
  if (!normalized) return [];

  // For now, just return the normalized form
  // If we add email_aliases table later, query it here:
  // const aliases = await query(
  //   `SELECT alias_email FROM email_aliases
  //    WHERE workspace_id = $1 AND canonical_email = $2`,
  //   [workspaceId, normalized]
  // );
  // return [normalized, ...aliases.rows.map(r => r.alias_email)];

  return [normalized];
}
