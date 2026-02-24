# LinkedIn Stakeholder Status Checker

**Status:** ✅ Implemented
**API:** RapidAPI Fresh LinkedIn Profile Data
**Scope:** Open deals only

---

## Overview

The LinkedIn stakeholder checker monitors key contacts on open deals to detect:
- **Company departures** (contact left the company)
- **Role changes** (promotions, demotions, lateral moves)
- **Title changes** (change in responsibilities)
- **Risk assessment** based on contact role importance

This tool is critical for deal risk management when champions, economic buyers, or decision makers change status during an active sales cycle.

---

## Setup

### 1. Get RapidAPI Key

1. Go to https://rapidapi.com/freshdata-freshdata-default/api/fresh-linkedin-profile-data
2. Subscribe to a plan (starts at free tier with limited calls)
3. Copy your `X-RapidAPI-Key` from the endpoint testing page

### 2. Add to Replit Secrets

In Replit:
1. Click **Tools** → **Secrets**
2. Add new secret:
   - Key: `RAPIDAPI_KEY`
   - Value: `your-rapidapi-key-here`

### 3. Test the Integration

Run the test script to verify the API key works:

```bash
tsx test-linkedin-client.ts
```

Expected output:
```
=== LinkedIn Client Test ===

✅ API key configured

Testing with profile: https://www.linkedin.com/in/cjfollini/

✅ Profile fetched successfully!

Profile Data:
─────────────
Name: Charles Follini
Current Title: Publisher – Your Wealth Blueprint
Current Company: Noyack Wealth Club
Duration at Company: 4 yrs 2 mos
...
```

---

## How It Works

### 1. Contact Requirements

For the checker to work, contacts must have:
- ✅ LinkedIn URL stored in `contacts.linkedin_url` field
- ✅ Associated with an open deal (via `deal_contacts` table)
- ⚠️ LinkedIn URLs are typically enriched from Apollo or manually entered

### 2. Enrichment Flow (Apollo → Pandora)

If you're using Apollo enrichment:
1. Apollo provides LinkedIn URLs during contact enrichment
2. Store in `contacts.linkedin_url` field
3. Stakeholder checker uses this URL to fetch current profile

If not using Apollo:
- LinkedIn URLs can be manually entered
- Or sourced from other enrichment providers

### 3. Detection Logic

The checker compares stored CRM data against current LinkedIn profile:

| Scenario | Detection | Risk Level |
|----------|-----------|------------|
| Company changed | `departed` | Critical (if champion/economic buyer), High (if decision maker), Medium (others) |
| Title changed (demotion) | `changed_role` | High (if lost buying power) |
| Title changed (promotion) | `changed_role` | Low (potentially positive) |
| Title changed (lateral) | `changed_role` | Medium |
| No changes detected | `active` | Low |

### 4. Risk Scoring

**Critical Risk:**
- Champion departed
- Economic buyer departed

**High Risk:**
- Decision maker departed
- Influencer departed
- Contact lost seniority (VP → Director)

**Medium Risk:**
- Other contact departed
- Lateral title change

**Low Risk:**
- Promotion (gained seniority)
- No changes detected

---

## Usage

### Chat Tool: `check_stakeholder_status`

**Description:** Check if key contacts on an open deal are still at the company via LinkedIn.

**Parameters:**
- `deal_id` (required): Deal ID to check (must be open deal)

**Example Usage in Chat:**

```
User: "Check the stakeholders on deal abc-123"

Pandora: [Calls check_stakeholder_status with deal_id: "abc-123"]

Result:
- John Smith (Champion) - ✅ Active at Acme Corp
- Jane Doe (Economic Buyer) - 🚨 DEPARTED - Now at TechCo
- Bob Johnson (Technical Evaluator) - ⚠️ Changed Role: VP Engineering → Director Engineering

Overall Risk: CRITICAL
Recommendations:
- 🚨 URGENT: Jane Doe (economic_buyer) departed. Identify new champion immediately.
- Verify buying power with Bob Johnson who changed roles.
```

### Programmatic Usage

```typescript
import { getStakeholderChecker } from './server/connectors/linkedin/stakeholder-checker.js';

const checker = getStakeholderChecker();
const result = await checker.checkDeal(workspaceId, dealId);

console.log(`Overall Risk: ${result.overall_risk}`);
console.log(`Departed: ${result.risk_summary.departed_count}`);
console.log(`Role Changes: ${result.risk_summary.role_changes}`);

result.contacts.forEach((contact) => {
  console.log(`${contact.contact_name}: ${contact.linkedin_status} (${contact.risk_level} risk)`);
});
```

---

## Rate Limiting

The checker includes built-in rate limiting:
- **500ms delay between API calls** to avoid hitting rate limits
- RapidAPI free tier typically allows 100-500 requests/month
- Plan accordingly for large deal volumes

**Recommendations:**
- Run checks manually or on-demand, not automatically for all deals
- Prioritize high-value deals in late stages (Negotiation, Proposal)
- Cache results for 24-48 hours to avoid duplicate checks

---

## Data Flow

```
1. User asks: "Has anyone left on the Acme deal?"
   ↓
2. Pandora routes to check_stakeholder_status tool
   ↓
3. Tool fetches deal contacts from database
   ↓
4. For each contact with linkedin_url:
   - Call RapidAPI to get current LinkedIn profile
   - Compare current company/title with stored values
   - Assess risk based on role and changes
   ↓
5. Return results with recommendations
```

---

## Error Handling

The tool gracefully handles:
- **No LinkedIn URL:** Returns `no_linkedin_url` status, low risk
- **API errors:** Returns `unknown` status, low risk, logs error
- **Profile not found:** Returns `unknown` status
- **Closed deals:** Returns message "Stakeholder checking only runs on open deals"
- **No API key:** Returns error with setup instructions

---

## Database Schema

### Required Tables

**contacts:**
- `id` (UUID)
- `linkedin_url` (TEXT) - Full LinkedIn profile URL
- `full_name`, `first_name`, `last_name` (TEXT)
- `title` (TEXT) - Stored job title
- `company` (TEXT) - Stored company name
- `role` (TEXT) - champion, economic_buyer, decision_maker, etc.
- `workspace_id` (UUID)

**deal_contacts:**
- `deal_id` (UUID)
- `contact_id` (UUID)

**deals:**
- `id` (UUID)
- `name` (TEXT)
- `stage_normalized` (TEXT) - Used to filter open deals
- `workspace_id` (UUID)

---

## Cost Estimation

**RapidAPI Pricing (Fresh LinkedIn Profile Data):**
- Free tier: ~100 requests/month
- Basic: $9.99/month for 500 requests
- Pro: $29.99/month for 5,000 requests

**Usage Patterns:**
- Average deal: 3-5 contacts
- Cost per deal check: $0.03 - $0.15 (on Basic plan)
- 100 deals/month: ~$3-15 depending on contact count

---

## Limitations

1. **LinkedIn URLs required** - Contacts without LinkedIn URLs cannot be checked
2. **Open deals only** - Closed deals are excluded from checking
3. **Rate limits** - RapidAPI enforces request quotas per plan
4. **LinkedIn profile accuracy** - Depends on how quickly contacts update their profiles
5. **No historical tracking** - Only compares current state, doesn't track changes over time

---

## Future Enhancements

Potential improvements:
1. **Automated monitoring** - Schedule checks for high-value deals in late stages
2. **Change alerts** - Slack notifications when critical contacts depart
3. **Historical tracking** - Store snapshots to show timeline of changes
4. **Batch checking** - Optimize for checking multiple deals efficiently
5. **Alternative APIs** - Integrate LinkedIn Official API or web scraping fallback

---

## Troubleshooting

### "RAPIDAPI_KEY not configured"
- Add `RAPIDAPI_KEY` to Replit Secrets
- Restart the server to pick up new environment variable

### "LinkedIn API error: 401"
- Invalid API key - check Replit Secrets
- Key may have expired - regenerate on RapidAPI

### "LinkedIn API error: 429"
- Rate limit exceeded
- Wait for quota reset (typically monthly)
- Upgrade RapidAPI plan for higher limits

### "No LinkedIn URL available"
- Contact has no `linkedin_url` in database
- Enrich contact via Apollo or manual entry
- Tool returns `no_linkedin_url` status

### "Profile not found"
- LinkedIn URL is invalid or profile deleted
- Person may have changed LinkedIn username
- Tool returns `unknown` status

---

## Testing Checklist

Before production use:

- [ ] RapidAPI key added to Replit Secrets
- [ ] Test script passes: `tsx test-linkedin-client.ts`
- [ ] Contacts have LinkedIn URLs populated
- [ ] Test with sample deal that has multiple contacts
- [ ] Verify risk levels match expectations
- [ ] Check rate limiting (500ms delay working)
- [ ] Confirm error handling for missing URLs
- [ ] Verify closed deals are excluded

---

## Support

If you encounter issues:
1. Check RAPIDAPI_KEY is set in Replit Secrets
2. Verify LinkedIn URLs are valid format: `https://www.linkedin.com/in/username/`
3. Check RapidAPI dashboard for quota/usage
4. Review server logs for error messages
5. Test with known working profile: `https://www.linkedin.com/in/cjfollini/`

---

**Status:** Ready for production use with RAPIDAPI_KEY configured.
