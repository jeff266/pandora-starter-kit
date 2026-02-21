# CRM Sync UI Fix + Skills Registration - Implementation Status

**Prompt:** PANDORA_CRM_SYNC_UI_FIX_PROMPT.md
**Started:** February 21, 2026

---

## ISSUE 1: Skills Registration - DIAGNOSED ✅

### Diagnosis Complete

**Skills ARE being registered correctly:**
- ✅ `registerBuiltInSkills()` exists in `server/skills/index.ts`
- ✅ Called from `server/index.ts` line 314 in `registerSkills()` function
- ✅ Registers 27 skills (lines 146-172)
- ✅ API endpoint `GET /:workspaceId/skills/:skillId/results` correctly uses `registry.getAll()` (line 150 of skills.ts)

**Root Cause:** The problem is NOT server-side registration. The issue is either:
1. **Client-side:** SkillsPage.tsx is calling the wrong endpoint or parsing response incorrectly
2. **Routing:** The endpoint path may not match what the client expects

**Next Step:** Read `client/src/pages/SkillsPage.tsx` to see what endpoint it's calling and fix the mismatch.

---

## ISSUE 2: CRM Sync UI Redesign - IN PROGRESS

This is a complete rewrite requiring ~11 steps per BUILD SEQUENCE:

### Required Components

1. ✅ **Route Path Doubling Fix** - Fixed all CRM writeback routes (committed b0e4e2f)
   - Changed all `/api/workspaces/:id/crm-writeback/...` to `/:workspaceId/crm-writeback/...`
   - Updated all `req.params.id` to `req.params.workspaceId`
   - All 9 routes now follow workspaceApiRouter mounting convention
2. ⏳ **Property Discovery Test** - Need to verify CRM properties endpoint works now
3. ❌ **checkCompatibility() utility** - Type matching logic
4. ❌ **Tab Layout** - Deals/Companies/Contacts tabs
5. ❌ **Mapping List** - Visual arrow rows (Pandora → CRM)
6. ❌ **Slide-Over Panel** - Proper slide-over for Add/Edit
7. ❌ **Two-Box Visual Mapper** - Side-by-side field selectors with arrow
8. ❌ **Type Compatibility Indicator** - Show match status below mapper
9. ❌ **Append Options** - Conditional reveal for append modes
10. ❌ **Value Transform + Preview** - Transform selector with live preview
11. ❌ **Sync Issues Log** - Collapsible error log section
12. ❌ **Retry/Edit Actions** - Wire up issue resolution buttons

---

## Recommendation

**For skills:** Check the client-side code first before making any server changes.

**For CRM Sync UI:** This is a multi-hour rewrite. The current basic UI works functionally, but needs significant UX improvements:
- Replace inline form with slide-over panel
- Add visual two-box mapper with arrow
- Add type compatibility checking
- Add sync error log
- Fix CRM property dropdown loading

Should we:
1. **Fix critical bugs only** (property dropdown, skills endpoint mismatch)?
2. **Do full redesign** (will take significant time)?

