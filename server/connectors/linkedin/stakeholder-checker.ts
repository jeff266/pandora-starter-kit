/**
 * LinkedIn Stakeholder Status Checker
 *
 * Monitors key contacts on open deals for:
 * - Company departures
 * - Role changes
 * - Title changes
 * - Risk assessment based on contact role (champion, economic buyer, etc.)
 */

import { query } from '../../db.js';
import { getLinkedInClient } from './client.js';

interface Contact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  company: string | null;
  linkedin_url: string | null;
  role: string | null; // champion, economic_buyer, technical_evaluator, etc.
  last_activity_date: Date | null;
}

interface StakeholderStatus {
  contact_id: string;
  contact_name: string;
  stored_title: string | null;
  stored_company: string | null;
  role: string | null;
  linkedin_status: 'active' | 'departed' | 'changed_role' | 'changed_company' | 'unknown' | 'no_linkedin_url';
  current_company: string | null;
  current_title: string | null;
  current_duration: string | null;
  risk_level: 'critical' | 'high' | 'medium' | 'low';
  risk_reason: string | null;
  checked_at: Date;
  linkedin_url: string | null;
}

interface StakeholderCheckResult {
  deal_id: string;
  deal_name: string | null;
  deal_amount: number;
  contacts_checked: number;
  role_filter_applied: 'critical_only' | 'business_roles' | 'all';
  roles_checked_description: string;
  contacts: StakeholderStatus[];
  risk_summary: {
    critical_risks: number;
    high_risks: number;
    medium_risks: number;
    departed_count: number;
    role_changes: number;
  };
  overall_risk: 'critical' | 'high' | 'medium' | 'low';
  recommendations: string[];
}

export interface StakeholderCheckOptions {
  /**
   * Role filter mode
   * - 'critical_only': Only check champion, economic_buyer, decision_maker, executive_sponsor (default)
   * - 'business_roles': Include procurement and influencer for deals > $50k
   * - 'all': Check all contacts regardless of role
   */
  roleFilter?: 'critical_only' | 'business_roles' | 'all';

  /**
   * Deal value threshold for including secondary roles (procurement, influencer)
   * Only used when roleFilter = 'business_roles'
   * Default: $50,000
   */
  dealValueThreshold?: number;
}

export class StakeholderChecker {
  // Critical roles that always get checked (highest impact on deal outcome)
  private readonly CRITICAL_ROLES = [
    'champion',
    'economic_buyer',
    'decision_maker',
    'executive_sponsor',
    'exec_sponsor',
  ];

  // Secondary roles that get checked for high-value deals
  private readonly SECONDARY_ROLES = [
    'procurement',
    'influencer',
  ];

  /**
   * Check stakeholder status for contacts on a deal
   * By default, only checks critical business decision makers
   */
  async checkDeal(
    workspaceId: string,
    dealId: string,
    options?: StakeholderCheckOptions
  ): Promise<StakeholderCheckResult> {
    const roleFilter = options?.roleFilter || 'critical_only';
    const dealValueThreshold = options?.dealValueThreshold || 50000;

    console.log(`[StakeholderChecker] Checking stakeholders for deal: ${dealId} (filter: ${roleFilter})`);

    // Get deal info including amount for threshold check
    const dealResult = await query<{ name: string; stage_normalized: string; amount: number | null }>(
      `SELECT name, stage_normalized, amount FROM deals WHERE id = $1 AND workspace_id = $2`,
      [dealId, workspaceId]
    );

    if (dealResult.rows.length === 0) {
      throw new Error('Deal not found');
    }

    const deal = dealResult.rows[0];
    const dealAmount = deal.amount || 0;

    // Build role filter WHERE clause
    let roleWhereClause = '';
    let queryParams: any[] = [dealId, workspaceId];

    if (roleFilter === 'critical_only') {
      // Only check critical roles
      roleWhereClause = `AND c.role = ANY($3::text[])`;
      queryParams.push(this.CRITICAL_ROLES);
    } else if (roleFilter === 'business_roles') {
      // Check critical + secondary roles if deal value meets threshold
      const rolesToCheck = dealAmount >= dealValueThreshold
        ? [...this.CRITICAL_ROLES, ...this.SECONDARY_ROLES]
        : this.CRITICAL_ROLES;

      roleWhereClause = `AND c.role = ANY($3::text[])`;
      queryParams.push(rolesToCheck);
    }
    // If 'all', no role filter - check everyone

    // Get contacts for this deal with LinkedIn URLs
    const contactsResult = await query<Contact>(
      `SELECT
        c.id,
        c.first_name,
        c.last_name,
        c.full_name,
        c.title,
        c.company,
        c.linkedin_url,
        c.role,
        c.last_activity_date
      FROM contacts c
      INNER JOIN deal_contacts dc ON dc.contact_id = c.id
      WHERE dc.deal_id = $1
        AND c.workspace_id = $2
        ${roleWhereClause}
      ORDER BY
        CASE c.role
          WHEN 'champion' THEN 1
          WHEN 'economic_buyer' THEN 2
          WHEN 'decision_maker' THEN 3
          WHEN 'executive_sponsor' THEN 4
          WHEN 'procurement' THEN 5
          WHEN 'influencer' THEN 6
          ELSE 7
        END,
        c.last_activity_date DESC NULLS LAST`,
      queryParams
    );

    const contacts = contactsResult.rows;
    console.log(`[StakeholderChecker] Found ${contacts.length} contacts (roleFilter: ${roleFilter})`);

    // Check each contact's LinkedIn status
    const statuses: StakeholderStatus[] = [];
    const linkedInClient = getLinkedInClient();

    for (const contact of contacts) {
      const status = await this.checkContact(contact, linkedInClient);
      statuses.push(status);

      // Rate limit protection - wait 500ms between API calls
      await this.sleep(500);
    }

    // Calculate risk summary
    const riskSummary = this.calculateRiskSummary(statuses);
    const overallRisk = this.assessOverallRisk(riskSummary);
    const recommendations = this.generateRecommendations(statuses, deal.stage_normalized);

    // Build role filter description for reporting
    let rolesCheckedDescription: string;
    if (roleFilter === 'critical_only') {
      rolesCheckedDescription = 'Critical roles only (champion, economic_buyer, decision_maker, executive_sponsor)';
    } else if (roleFilter === 'business_roles') {
      if (dealAmount >= dealValueThreshold) {
        rolesCheckedDescription = `Business decision makers (critical + procurement/influencer for deals ≥ $${dealValueThreshold.toLocaleString()})`;
      } else {
        rolesCheckedDescription = `Critical roles only (deal amount $${dealAmount.toLocaleString()} < $${dealValueThreshold.toLocaleString()} threshold)`;
      }
    } else {
      rolesCheckedDescription = 'All contacts';
    }

    return {
      deal_id: dealId,
      deal_name: deal.name,
      deal_amount: dealAmount,
      contacts_checked: contacts.length,
      role_filter_applied: roleFilter,
      roles_checked_description: rolesCheckedDescription,
      contacts: statuses,
      risk_summary: riskSummary,
      overall_risk: overallRisk,
      recommendations,
    };
  }

  /**
   * Check a single contact's LinkedIn status
   */
  private async checkContact(
    contact: Contact,
    linkedInClient: any
  ): Promise<StakeholderStatus> {
    // No LinkedIn URL - can't check
    if (!contact.linkedin_url) {
      return {
        contact_id: contact.id,
        contact_name: contact.full_name || `${contact.first_name} ${contact.last_name}`,
        stored_title: contact.title,
        stored_company: contact.company,
        role: contact.role,
        linkedin_status: 'no_linkedin_url',
        current_company: null,
        current_title: null,
        current_duration: null,
        risk_level: 'low',
        risk_reason: 'No LinkedIn URL available',
        checked_at: new Date(),
        linkedin_url: null,
      };
    }

    try {
      // Fetch current LinkedIn profile
      const profile = await linkedInClient.getProfileByUrl(contact.linkedin_url);

      if (!profile) {
        return {
          contact_id: contact.id,
          contact_name: contact.full_name || `${contact.first_name} ${contact.last_name}`,
          stored_title: contact.title,
          stored_company: contact.company,
          role: contact.role,
          linkedin_status: 'unknown',
          current_company: null,
          current_title: null,
          current_duration: null,
          risk_level: 'low',
          risk_reason: 'Could not fetch LinkedIn profile',
          checked_at: new Date(),
          linkedin_url: contact.linkedin_url,
        };
      }

      // Compare stored data with current LinkedIn data
      const status = this.compareContactData(contact, profile);
      return status;
    } catch (error: any) {
      console.error(`[StakeholderChecker] Error checking contact ${contact.id}:`, error.message);

      return {
        contact_id: contact.id,
        contact_name: contact.full_name || `${contact.first_name} ${contact.last_name}`,
        stored_title: contact.title,
        stored_company: contact.company,
        role: contact.role,
        linkedin_status: 'unknown',
        current_company: null,
        current_title: null,
        current_duration: null,
        risk_level: 'low',
        risk_reason: `Error checking LinkedIn: ${error.message}`,
        checked_at: new Date(),
        linkedin_url: contact.linkedin_url,
      };
    }
  }

  /**
   * Compare stored contact data with current LinkedIn profile
   */
  private compareContactData(contact: Contact, profile: any): StakeholderStatus {
    const currentCompany = profile.company;
    const currentTitle = profile.job_title;
    const storedCompany = contact.company;
    const storedTitle = contact.title;

    let linkedinStatus: StakeholderStatus['linkedin_status'] = 'active';
    let riskLevel: StakeholderStatus['risk_level'] = 'low';
    let riskReason: string | null = null;

    // Check for company change (most critical)
    const companyChanged = this.companiesAreDifferent(storedCompany, currentCompany);
    const titleChanged = this.titlesAreDifferent(storedTitle, currentTitle);

    if (companyChanged) {
      linkedinStatus = 'departed';
      riskReason = `Left ${storedCompany || 'previous company'} → Now at ${currentCompany}`;

      // Critical if champion or economic buyer departed
      if (contact.role === 'champion' || contact.role === 'economic_buyer') {
        riskLevel = 'critical';
      } else if (contact.role === 'decision_maker' || contact.role === 'influencer') {
        riskLevel = 'high';
      } else {
        riskLevel = 'medium';
      }
    } else if (titleChanged) {
      linkedinStatus = 'changed_role';
      riskReason = `Role changed: ${storedTitle || 'previous role'} → ${currentTitle}`;

      // Assess if title change affects buying power
      const lostSeniority = this.lostSeniority(storedTitle, currentTitle);
      const gainedSeniority = this.gainedSeniority(storedTitle, currentTitle);

      if (lostSeniority && (contact.role === 'economic_buyer' || contact.role === 'decision_maker')) {
        riskLevel = 'high';
        riskReason += ' (lost seniority, may have less buying power)';
      } else if (gainedSeniority) {
        riskLevel = 'low';
        riskReason += ' (promotion, potentially positive)';
      } else {
        riskLevel = 'medium';
      }
    } else {
      linkedinStatus = 'active';
      riskLevel = 'low';
      riskReason = 'No changes detected';
    }

    return {
      contact_id: contact.id,
      contact_name: contact.full_name || `${contact.first_name} ${contact.last_name}`,
      stored_title: storedTitle,
      stored_company: storedCompany,
      role: contact.role,
      linkedin_status: linkedinStatus,
      current_company: currentCompany,
      current_title: currentTitle,
      current_duration: profile.current_job_duration,
      risk_level: riskLevel,
      risk_reason: riskReason,
      checked_at: new Date(),
      linkedin_url: contact.linkedin_url,
    };
  }

  /**
   * Check if two company names are different (with fuzzy matching)
   */
  private companiesAreDifferent(stored: string | null, current: string | null): boolean {
    if (!stored || !current) return false;

    // Normalize company names for comparison
    const normalize = (name: string) =>
      name.toLowerCase().replace(/[.,\s]+/g, '').replace(/inc|llc|ltd|corp|corporation/gi, '');

    return normalize(stored) !== normalize(current);
  }

  /**
   * Check if two titles are significantly different
   */
  private titlesAreDifferent(stored: string | null, current: string | null): boolean {
    if (!stored || !current) return false;

    // Normalize titles
    const normalize = (title: string) => title.toLowerCase().replace(/[.,\s]+/g, '');

    const storedNorm = normalize(stored);
    const currentNorm = normalize(current);

    // Exact match
    if (storedNorm === currentNorm) return false;

    // Check if one contains the other (minor variations)
    if (storedNorm.includes(currentNorm) || currentNorm.includes(storedNorm)) {
      return false;
    }

    return true;
  }

  /**
   * Check if contact lost seniority (demotion or lateral move to less influential role)
   */
  private lostSeniority(oldTitle: string | null, newTitle: string | null): boolean {
    if (!oldTitle || !newTitle) return false;

    const seniorityLevels = ['ceo', 'cfo', 'coo', 'cto', 'vp', 'svp', 'evp', 'director', 'manager', 'lead'];

    const oldLevel = seniorityLevels.findIndex((level) => oldTitle.toLowerCase().includes(level));
    const newLevel = seniorityLevels.findIndex((level) => newTitle.toLowerCase().includes(level));

    // If found in list and moved down
    return oldLevel >= 0 && newLevel >= 0 && newLevel > oldLevel;
  }

  /**
   * Check if contact gained seniority (promotion)
   */
  private gainedSeniority(oldTitle: string | null, newTitle: string | null): boolean {
    if (!oldTitle || !newTitle) return false;

    const seniorityLevels = ['ceo', 'cfo', 'coo', 'cto', 'vp', 'svp', 'evp', 'director', 'manager', 'lead'];

    const oldLevel = seniorityLevels.findIndex((level) => oldTitle.toLowerCase().includes(level));
    const newLevel = seniorityLevels.findIndex((level) => newTitle.toLowerCase().includes(level));

    // If found in list and moved up
    return oldLevel >= 0 && newLevel >= 0 && newLevel < oldLevel;
  }

  /**
   * Calculate risk summary across all contacts
   */
  private calculateRiskSummary(statuses: StakeholderStatus[]) {
    return {
      critical_risks: statuses.filter((s) => s.risk_level === 'critical').length,
      high_risks: statuses.filter((s) => s.risk_level === 'high').length,
      medium_risks: statuses.filter((s) => s.risk_level === 'medium').length,
      departed_count: statuses.filter((s) => s.linkedin_status === 'departed').length,
      role_changes: statuses.filter((s) => s.linkedin_status === 'changed_role').length,
    };
  }

  /**
   * Assess overall deal risk based on contact statuses
   */
  private assessOverallRisk(summary: ReturnType<typeof this.calculateRiskSummary>): 'critical' | 'high' | 'medium' | 'low' {
    if (summary.critical_risks > 0) return 'critical';
    if (summary.high_risks > 0) return 'high';
    if (summary.medium_risks > 0) return 'medium';
    return 'low';
  }

  /**
   * Generate actionable recommendations
   */
  private generateRecommendations(statuses: StakeholderStatus[], dealStage: string): string[] {
    const recommendations: string[] = [];

    const departed = statuses.filter((s) => s.linkedin_status === 'departed');
    const roleChanges = statuses.filter((s) => s.linkedin_status === 'changed_role');

    // Departed contacts
    if (departed.length > 0) {
      const criticalDepartures = departed.filter((s) => s.risk_level === 'critical');
      if (criticalDepartures.length > 0) {
        const names = criticalDepartures.map((s) => s.contact_name).join(', ');
        recommendations.push(`🚨 URGENT: ${names} (${criticalDepartures[0].role}) departed. Identify new champion immediately.`);
      }

      const otherDepartures = departed.filter((s) => s.risk_level !== 'critical');
      if (otherDepartures.length > 0) {
        recommendations.push(`Update contact records for ${otherDepartures.length} departed stakeholder(s).`);
      }
    }

    // Role changes
    if (roleChanges.length > 0) {
      const highRiskChanges = roleChanges.filter((s) => s.risk_level === 'high');
      if (highRiskChanges.length > 0) {
        recommendations.push(`Verify buying power with ${highRiskChanges.length} contact(s) who changed roles.`);
      }
    }

    // Stage-specific recommendations
    if (dealStage === 'negotiation' || dealStage === 'proposal') {
      if (departed.length > 0 || roleChanges.filter((s) => s.risk_level === 'high').length > 0) {
        recommendations.push('Consider pausing deal progression until stakeholder changes are resolved.');
      }
    }

    // No issues
    if (recommendations.length === 0) {
      recommendations.push('All stakeholders verified active. No action needed.');
    }

    return recommendations;
  }

  /**
   * Sleep helper for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
let stakeholderChecker: StakeholderChecker | null = null;

export function getStakeholderChecker(): StakeholderChecker {
  if (!stakeholderChecker) {
    stakeholderChecker = new StakeholderChecker();
  }
  return stakeholderChecker;
}
