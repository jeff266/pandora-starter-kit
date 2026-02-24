# LinkedIn Stakeholder Checker - Build Summary

## What Was Built

✅ **Complete LinkedIn stakeholder checking system** for monitoring contact changes on open deals.

---

## Files Created

### 1. LinkedIn API Client
**File:** `/server/connectors/linkedin/client.ts` (173 lines)

- Wraps RapidAPI Fresh LinkedIn Profile Data API
- Fetches current LinkedIn profile by URL or public_id
- Handles errors, rate limits, invalid keys
- Singleton pattern for reuse

**Key Methods:**
- `getProfileByUrl(linkedinUrl)` - Fetch profile by full URL
- `getProfileByPublicId(publicId)` - Fetch by username
- `isConfigured()` - Check if API key is set

---

### 2. Stakeholder Checker
**File:** `/server/connectors/linkedin/stakeholder-checker.ts` (407 lines)

- Compares stored contact data with current LinkedIn profiles
- Detects departures, role changes, promotions/demotions
- Assesses risk levels (critical/high/medium/low)
- Generates actionable recommendations

**Key Methods:**
- `checkDeal(workspaceId, dealId)` - Check all contacts on a deal
- `checkContact(contact)` - Check single contact status

**Risk Scoring:**
- **Critical:** Champion/Economic Buyer departed
- **High:** Decision Maker departed, loss of seniority
- **Medium:** Other departures, lateral role changes
- **Low:** Promotions, no changes

---

### 3. Chat Tool Integration
**File:** `/server/chat/analysis-tools.ts` (added 80 lines)

- Exports `checkStakeholderStatus(workspaceId, params)` function
- Validates deal is open before checking
- Returns full status report with recommendations

**File:** `/server/chat/pandora-agent.ts` (updated)

- Registered `check_stakeholder_status` tool in agent
- Added system prompt guidance (rule #21)
- Tool description and parameter schema

**File:** `/server/chat/data-tools.ts` (updated)

- Added dispatch case for `check_stakeholder_status`
- Imports function from analysis-tools

---

### 4. Test Script
**File:** `/test-linkedin-client.ts` (62 lines)

- Tests LinkedIn API integration
- Verifies API key is configured
- Fetches sample profile and displays results

---

### 5. Documentation
**File:** `/LINKEDIN_STAKEHOLDER_SETUP.md` (320 lines)

Complete setup guide covering:
- API setup and configuration
- How the system works
- Usage examples (chat and programmatic)
- Rate limiting guidance
- Cost estimation
- Troubleshooting

---

## How to Use

### 1. Setup (One-Time)

```bash
# 1. Get RapidAPI key
# Go to: https://rapidapi.com/freshdata-freshdata-default/api/fresh-linkedin-profile-data
# Subscribe and copy your X-RapidAPI-Key

# 2. Add to Replit Secrets
# Tools → Secrets → Add Secret
# Key: RAPIDAPI_KEY
# Value: your-key-here

# 3. Test the integration
tsx test-linkedin-client.ts
```

### 2. Using in Chat

```
User: "Check the stakeholders on deal abc-123"

Pandora: [Uses check_stakeholder_status tool]

Result:
✅ John Smith (Champion) - Active at Acme Corp
🚨 Jane Doe (Economic Buyer) - DEPARTED → Now at TechCo
⚠️ Bob Johnson (Technical Evaluator) - Changed role: VP → Director

Overall Risk: CRITICAL

Recommendations:
- 🚨 URGENT: Jane Doe (economic_buyer) departed. Identify new champion immediately.
- Verify buying power with Bob Johnson who changed roles.
```

### 3. Programmatic Usage

```typescript
import { getStakeholderChecker } from './server/connectors/linkedin/stakeholder-checker.js';

const checker = getStakeholderChecker();
const result = await checker.checkDeal(workspaceId, dealId);

console.log(result.overall_risk); // 'critical' | 'high' | 'medium' | 'low'
console.log(result.recommendations); // Array of action items
```

---

## Key Features

✅ **Departure Detection**
- Compares stored company with current LinkedIn company
- Fuzzy matching handles variations (e.g., "Acme Inc" vs "Acme")

✅ **Role Change Detection**
- Detects title changes with fuzzy matching
- Identifies promotions vs demotions
- Tracks seniority changes (VP → Director, etc.)

✅ **Risk Assessment**
- Critical risk for champion/economic buyer departures
- High risk for decision maker departures or seniority loss
- Context-aware recommendations

✅ **Rate Limiting**
- 500ms delay between API calls
- Prevents hitting RapidAPI quotas
- Graceful error handling

✅ **Open Deals Only**
- Automatically filters to open deals
- Skips closed_won/closed_lost deals
- Returns helpful message if deal is closed

✅ **Graceful Degradation**
- Works even if some contacts lack LinkedIn URLs
- Returns "no_linkedin_url" status instead of failing
- Continues checking other contacts if one fails

---

## Data Requirements

For stakeholder checking to work:

1. **Contacts must have LinkedIn URLs**
   - Field: `contacts.linkedin_url`
   - Format: `https://www.linkedin.com/in/username/`
   - Source: Apollo enrichment or manual entry

2. **Contacts must be linked to deals**
   - Via `deal_contacts` junction table

3. **Contacts should have role classification**
   - Field: `contacts.role`
   - Values: `champion`, `economic_buyer`, `decision_maker`, `influencer`, etc.
   - Used for risk scoring

---

## Cost & Limits

**RapidAPI Pricing:**
- Free: ~100 requests/month
- Basic: $9.99/month for 500 requests
- Pro: $29.99/month for 5,000 requests

**Usage Estimation:**
- Average deal: 3-5 contacts
- Cost per deal: $0.03 - $0.15 (Basic plan)
- 100 deals/month: ~$3-15

**Built-in Rate Limiting:**
- 500ms delay between calls
- Prevents exceeding quota limits

---

## Testing Checklist

Before production use:

- [ ] Add `RAPIDAPI_KEY` to Replit Secrets
- [ ] Run test script: `tsx test-linkedin-client.ts`
- [ ] Verify contacts have LinkedIn URLs
- [ ] Test with sample deal: Ask "Check stakeholders on deal XYZ"
- [ ] Verify risk levels are accurate
- [ ] Confirm closed deals are excluded
- [ ] Check error handling (missing URLs, API errors)

---

## Integration Points

The tool integrates with:

1. **Ask Pandora Chat**
   - Tool name: `check_stakeholder_status`
   - Invoked automatically when user asks about stakeholders

2. **Contacts Table**
   - Reads: `linkedin_url`, `title`, `company`, `role`, `full_name`

3. **Deals Table**
   - Reads: `name`, `stage_normalized`
   - Filters: Only open deals

4. **Deal Contacts**
   - Junction table linking contacts to deals

---

## What's NOT Included (Yet)

Future enhancements:
- ❌ Automated scheduled checking (manual/on-demand only)
- ❌ Historical change tracking (no timeline snapshots)
- ❌ Slack alerts for departures (returns data only)
- ❌ Batch checking multiple deals (one deal at a time)
- ❌ Caching of LinkedIn results (fetches fresh every time)

These can be added later if needed.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Ask Pandora Chat                               │
│  User: "Check stakeholders on deal abc-123"     │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  pandora-agent.ts                               │
│  Routes to check_stakeholder_status tool        │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  analysis-tools.ts                              │
│  checkStakeholderStatus(workspaceId, params)    │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  stakeholder-checker.ts                         │
│  - Fetch contacts for deal                      │
│  - For each contact with LinkedIn URL:          │
│    • Call LinkedIn API                          │
│    • Compare stored vs current data             │
│    • Assess risk level                          │
│  - Generate recommendations                     │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  linkedin/client.ts                             │
│  - Call RapidAPI                                │
│  - Return current LinkedIn profile              │
└─────────────────────────────────────────────────┘
```

---

## Next Steps

1. **Add `RAPIDAPI_KEY` to Replit Secrets**
2. **Run test script** to verify setup
3. **Ensure contacts have LinkedIn URLs** (via Apollo or manual entry)
4. **Test with a real deal** via chat

Once tested, the tool is production-ready! 🚀

---

## Support

If you need help:
1. Check `/LINKEDIN_STAKEHOLDER_SETUP.md` for detailed troubleshooting
2. Run `tsx test-linkedin-client.ts` to verify API key
3. Review server logs for errors
4. Verify LinkedIn URLs are valid format

---

**Status:** ✅ Complete and ready for testing
