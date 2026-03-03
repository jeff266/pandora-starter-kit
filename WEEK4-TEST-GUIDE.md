# Week 4: Investigation History - Testing Guide

## Quick Start (Replit)

### 1. Set Environment Variables

In Replit Secrets (or terminal):
```bash
export WORKSPACE_ID="your-workspace-id-here"
export API_URL="http://localhost:3000/api"  # Optional, defaults to localhost
```

### 2. Run Test Script

```bash
node test-week4-replit.js
```

## What the Test Script Covers

### ✅ Backend API Tests

1. **Investigation History List** (`GET /investigation/history`)
   - Basic pagination (limit, offset)
   - Filter by skill_id
   - Filter by status
   - Filter by date range

2. **Timeline/Trend Analysis** (`GET /investigation/timeline`)
   - 30-day trend data
   - 7-day trend data
   - Trend direction calculation (improving/worsening/stable)
   - Delta calculations (new at-risk, improved)

3. **Deal Timeline** (`GET /investigation/deal-timeline/:dealName`)
   - Track when deal first flagged
   - Severity changes over time
   - Recurring issue detection

4. **Export Functionality** (`POST /investigation/export`)
   - CSV export generation
   - XLSX export generation
   - Download URL generation
   - File cleanup (1-hour expiration)

5. **Error Handling**
   - Invalid parameters
   - Missing data
   - Boundary conditions

## Frontend Testing Checklist

### Page Navigation
- [ ] Click "View History" button in ProactiveBriefing
- [ ] Verify navigation to `/investigation/history`
- [ ] Page title shows "Investigation History"

### Filters
- [ ] Skill filter dropdown shows: All Skills, Deal Risk Review, Data Quality Audit, Forecast Rollup
- [ ] Status filter shows: All Statuses, Completed, Failed
- [ ] Date filters: From Date and To Date pickers
- [ ] Clear Filters button appears when filters are active
- [ ] Clear Filters resets all filters

### Timeline Chart
- [ ] Chart appears when skill is selected
- [ ] Shows "Trend Analysis - {skill}" header
- [ ] Displays trend indicator: 📉 Improving, 📈 Worsening, or ➡️ Stable
- [ ] Chart shows 4 lines: At Risk (red), Critical (dark red), Warning (yellow), Healthy (green dashed)
- [ ] Hover over data points shows tooltip with values
- [ ] X-axis shows formatted dates
- [ ] Y-axis shows count values
- [ ] Shows run count summary below chart: "X runs over last 30 days"

### History Table
- [ ] Table displays with sticky headers
- [ ] Columns: Run Date, Skill, Status, Duration, Total, At Risk, Actions

**Sorting**
- [ ] Click "Run Date" header to sort (default desc)
- [ ] Click again to reverse sort order
- [ ] Arrow indicator shows current sort direction (↑/↓)
- [ ] Works for: Run Date, Skill, Duration, Total, At Risk

**Row Display**
- [ ] Run Date: formatted as "Mon DD, YYYY HH:MM AM/PM"
- [ ] Skill: displays skill ID
- [ ] Status: badge with color (green=completed, red=failed, yellow=running)
- [ ] Duration: formatted as "Xm Ys" or "X.Xs"
- [ ] Total: count of records
- [ ] At Risk: badge with color based on percentage (red ≥50%, yellow ≥20%, green <20%)

**Actions**
- [ ] CSV button exports as CSV
- [ ] XLSX button exports as Excel file
- [ ] Buttons trigger download

**Row Interaction**
- [ ] Hover over row changes background color
- [ ] Click row opens InvestigationResults modal
- [ ] Modal shows full investigation details
- [ ] Close modal returns to history page

### Pagination
- [ ] Shows "Showing X-Y of Z" count
- [ ] Previous button disabled when on first page
- [ ] Next button disabled when on last page
- [ ] Clicking Previous/Next updates table
- [ ] Pagination persists through filtering

### Export Downloads
- [ ] Clicking CSV button downloads .csv file
- [ ] CSV opens in Excel/Numbers correctly
- [ ] CSV contains headers: Deal Name, Severity, Stage, Amount, Owner, Close Date, Risk Score, Finding Message
- [ ] XLSX downloads as .xlsx file
- [ ] XLSX has 2 tabs: Summary and Records
- [ ] Summary tab shows run metadata and counts
- [ ] Records tab has color-coded severity cells
- [ ] Records tab has frozen headers and auto-filter

### Loading States
- [ ] Table shows "Loading investigation history..." while fetching
- [ ] Timeline shows "Loading timeline..." while fetching
- [ ] Empty state: "No investigation runs found" with helper text

### Error States
- [ ] Error banner appears on API failure
- [ ] Error message displays in red with border
- [ ] Error is dismissible or auto-clears on retry

## Sample Test Data Setup

If you need to create test data:

```bash
# Trigger an investigation run
curl -X POST "http://localhost:3000/api/${WORKSPACE_ID}/investigation/trigger-skill" \
  -H "Content-Type: application/json" \
  -d '{"skill_id": "deal-risk-review"}'

# Wait for completion, then check results
curl "http://localhost:3000/api/${WORKSPACE_ID}/investigation/history?limit=1"
```

## Expected Behavior

### Trend Calculation
- **Improving**: Slope < -0.1 (at-risk count decreasing)
- **Worsening**: Slope > 0.1 (at-risk count increasing)
- **Stable**: Slope between -0.1 and 0.1

### Color Coding
- **Critical**: Red (#EF4444)
- **Warning**: Yellow (#EAB308)
- **Healthy**: Green (#10B981)
- **Status - Completed**: Green
- **Status - Failed**: Red
- **Status - Running**: Yellow

### File Naming
- CSV: `investigation-YYYY-MM-DD.csv`
- XLSX: `investigation-YYYY-MM-DD.xlsx`

### Performance Limits
- History query: max 200 records per page
- Timeline: max 90 days
- Deal timeline: max 50 appearances
- Downloads: expire after 1 hour

## Troubleshooting

### "No investigation runs found"
- Check if any investigations have been run
- Trigger a test investigation: `POST /investigation/trigger-skill`
- Wait for completion (check job queue)

### Timeline chart not showing
- Ensure a skill is selected in filter dropdown
- Check that skill has run history (completed status)
- Verify runs exist in last 30 days

### Export download fails
- Check browser console for errors
- Verify runId exists in database
- Check server logs for export errors
- Ensure sufficient disk space for temp files

### Pagination stuck
- Check total count vs displayed records
- Verify offset calculation (offset + limit < total)
- Clear filters and retry

## API Reference

### GET /investigation/history
**Query Params:**
- `limit` (default: 50, max: 200)
- `offset` (default: 0)
- `skill_id` (optional)
- `status` (optional: completed, failed)
- `from_date` (ISO timestamp)
- `to_date` (ISO timestamp)

### GET /investigation/timeline
**Query Params:**
- `skill_id` (required)
- `days` (default: 30, max: 90)

### GET /investigation/deal-timeline/:dealName
**URL Params:**
- `dealName` (URL-encoded)

### POST /investigation/export
**Body:**
```json
{
  "runId": "string",
  "format": "csv" | "xlsx"
}
```

## Success Criteria

✅ All backend endpoints return 200 OK with valid data
✅ Frontend loads without console errors
✅ All filters work correctly
✅ Timeline chart displays with correct trend
✅ Table sorting works on all sortable columns
✅ Pagination navigates through all pages
✅ Row click opens modal with investigation details
✅ Export buttons download valid CSV/XLSX files
✅ "View History" button navigates from ProactiveBriefing
✅ No TypeScript compilation errors
✅ Mobile responsive layout works

---

**Last Updated:** Week 4 Complete
**Files Added:** 7 (4 components, 1 hook, 1 page, 1 utility)
**Lines of Code:** ~938 frontend + ~691 backend = 1,629 total
