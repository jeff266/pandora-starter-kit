# Claude Code Prompt: Strict Verification Pass — Tools & Skills

## Context

The previous audit counted file definitions as implementations. We need ground truth.
Read `ROADMAP_AUDIT_REPORT.md` first for context, then VERIFY with strict criteria.

**Strict criteria for "working":**
- TOOL works = function exists AND has real logic (not a stub/passthrough) AND is callable from at least one skill or chat tool registration AND returns structured data
- SKILL works = all phases implemented (compute returns data, classify runs LLM, synthesize produces output) AND registered in scheduler AND has a delivery path (Slack/markdown/doc)
- RENDERER works = can be called with skill output and produces a downloadable file

Write results to `VERIFICATION_REPORT.md` in project root.

---

## Part 1: Trace Every Tool (33 from MECE spec)

For each of the 33 tools, do this EXACT verification:

### Verification steps per tool:
1. **Find the function**: Search for the function name. Note file path and line numbers.
2. **Read the implementation**: Is there real logic (SQL queries, math, API calls) or just a type signature / empty function / TODO?
3. **Trace a caller**: Find at least one skill or chat handler that actually CALLS this function. If nothing calls it, mark as "orphaned."
4. **Check data dependencies**: Does the function query tables that exist and have data? (e.g., if it queries `deal_stage_history`, does that table exist in migrations?)

Rate each tool:
- 🟢 **LIVE** = Real implementation + called by skill/chat + data tables exist
- 🟡 **IMPLEMENTED BUT UNUSED** = Real implementation + NOT called by anything active
- 🟠 **PARTIAL** = Implementation exists but missing pieces (e.g., queries table that has no data, or logic is incomplete)
- 🔴 **STUB/MISSING** = No real implementation, or function doesn't exist

```
### [tool_name]
Rating: 🟢/🟡/🟠/🔴
File: [path]:[line_range]
Implementation: [2-3 sentences on what the code actually does]
Called by: [list every skill/handler that invokes this function]
Data dependency: [tables queried — do they exist? have rows?]
Gap: [what's missing, if anything]
```

DO THIS FOR ALL 33:
query_deals, query_accounts, query_conversations, query_contacts,
query_activity_timeline, get_skill_evidence, compute_metric,
compute_stage_benchmarks, query_stage_history, query_field_history,
compute_metric_segmented, search_transcripts, score_icp_fit,
score_multithreading, score_conversation_sentiment, compute_activity_trend,
infer_contact_role, compute_close_probability, compute_forecast_accuracy,
compute_pipeline_creation, compute_inqtr_close_rate, compute_shrink_rate,
compute_rep_conversions, detect_buyer_signals, check_stakeholder_status,
enrich_market_signals, compute_competitive_rates, query_product_usage,
compute_wallet_share, compute_attention_score, score_activity_quality,
detect_process_blockers, compute_source_conversion

---

## Part 2: Trace Every Skill (27 files found)

For each of the 27 skill files in `/server/skills/library/`:

### Verification steps per skill:
1. **Open the file**. Read the ENTIRE skill definition.
2. **Count phases**: How many steps? Are they labeled COMPUTE, DEEPSEEK/CLASSIFY, CLAUDE/SYNTHESIZE?
3. **Check compute steps**: Do they call real tool functions that return data? Or do they have placeholder/mock logic?
4. **Check classify step**: Does it actually call DeepSeek/a classification LLM? Or is it skipped/stubbed?
5. **Check synthesize step**: Does it actually call Claude with structured input? Does it have a real prompt template?
6. **Check output**: What does the skill return? Is there a delivery handler (Slack formatter, doc renderer)?
7. **Check schedule**: Is there a cron expression? Is it registered in the scheduler?
8. **Check evidence of execution**: Search for this skill's ID in any log, skill_runs query, or test file. Has it ever run?

Rate each skill:
- 🟢 **PRODUCTION** = All phases real + scheduled + evidence of execution with real data
- 🟡 **COMPLETE BUT UNVERIFIED** = All phases implemented + registered but no evidence of production runs
- 🟠 **PARTIAL** = Some phases implemented, others stubbed or incomplete
- 🔴 **SHELL** = File exists but mostly stubs, TODOs, or placeholder logic

```
### [skill_name] ([file_name])
Rating: 🟢/🟡/🟠/🔴
File: [path]
Phases found: [list each step with type: COMPUTE/CLASSIFY/SYNTHESIZE]
Compute calls: [which tool functions are actually invoked]
Classify: [LLM called? model? or stubbed?]
Synthesize: [LLM called? has prompt template? or stubbed?]
Output format: [slack/markdown/xlsx/pdf — what's wired?]
Cron: [expression if found, or "none"]
Evidence of production run: [yes — cite evidence / no]
Blocking issues: [what prevents this from running correctly]
```

List all 27 skill files by name, then rate each one.

---

## Part 3: Renderer Verification

For each document renderer found:

1. **XLSX renderer**: Find file. Does it accept skill output and produce a real .xlsx? What library (ExcelJS, SheetJS)? Has it been called?
2. **DOCX renderer**: Find file. Does it produce a real .docx? What library? Has it been called?
3. **PDF renderer**: Find file. Real implementation or stub? What library?
4. **PPTX renderer**: Find file. Real implementation or stub? What library?

For each, trace: Can a skill run → renderer → downloadable file? Or is there a broken link in the chain?

---

## Part 4: Agent Verification

For each of the 6 seed agent definitions:

1. Read the agent definition. Does it have: name, role, goal, skills list, schedule, synthesis config?
2. Trace the execution path: If this agent's schedule fires, what actually happens?
   - Does the runtime pick it up?
   - Does it execute the listed skills in sequence?
   - Does it synthesize across skill outputs?
   - Does it deliver somewhere?
3. Has this agent ever executed? Search for evidence.

```
### [agent_name]
Definition complete: yes/no
Execution path verified: yes/no — [describe what happens]
Skills it runs: [list — and note which of those skills are 🟢 vs not]
Evidence of execution: [cite or "none"]
What breaks if you trigger it now: [honest assessment]
```

---

## Part 5: Data Layer Verification

For each critical table, run the equivalent of a count query by reading migration files and any seed/sync code:

```
| Table | Migration exists | Has production data evidence | Approx rows | Notes |
|-------|-----------------|---------------------------|-------------|-------|
| deals | | | | |
| contacts | | | | |
| accounts | | | | |
| conversations | | | | |
| activities | | | | |
| deal_contacts | | | | |
| deal_stage_history | | | | CRITICAL: many tools depend on this |
| field_change_log | | | | needed for close date tracking |
| skill_runs | | | | |
| findings | | | | |
| actions | | | | Actions Engine depends on this |
| context_layer | | | | workspace config storage |
| forecast_snapshots | | | | forecast accuracy depends on this |
| icp_profiles | | | | ICP Discovery depends on this |
| lead_scores | | | | Lead Scoring depends on this |
| connector_configs | | | | |
| sync_log | | | | |
```

---

## Part 6: The Real Scorecard

Based on STRICT verification only (not file counts), produce:

```markdown
## Ground Truth Scorecard

### Tools
| Rating | Count | Names |
|--------|-------|-------|
| 🟢 LIVE | ? | [list] |
| 🟡 IMPLEMENTED UNUSED | ? | [list] |
| 🟠 PARTIAL | ? | [list] |
| 🔴 STUB/MISSING | ? | [list] |

### Skills  
| Rating | Count | Names |
|--------|-------|-------|
| 🟢 PRODUCTION | ? | [list] |
| 🟡 COMPLETE UNVERIFIED | ? | [list] |
| 🟠 PARTIAL | ? | [list] |
| 🔴 SHELL | ? | [list] |

### Renderers
| Format | Status | Library | End-to-end verified |
|--------|--------|---------|-------------------|
| XLSX | | | |
| DOCX | | | |
| PDF | | | |
| PPTX | | | |

### Agents
| Agent | Definition | Execution path | All skills 🟢 | Ever run |
|-------|-----------|---------------|---------------|---------|
| | | | | |

### Data Tables
| Table | Exists | Has data | Blocks if empty |
|-------|--------|----------|----------------|
| | | | |
```

---

## Part 7: Revised Build Priority

Now that you have STRICT verification, revise the build order.

**Priority framework:**
1. **🟡 → 🟢 conversions**: What implemented-but-unused tools/skills need the LEAST work to become production? These are the fastest wins.
2. **🟠 → 🟡 conversions**: What partial implementations are closest to complete?
3. **Table gaps**: Which missing/empty tables block the most tools?
4. **Playbook composition**: With the REAL set of 🟢 skills, which playbooks can be composed NOW?

Produce a ranked list:

```
| Priority | Item | Current | Target | Effort (hrs) | Unblocks |
|----------|------|---------|--------|-------------|----------|
| 1 | | | | | |
| 2 | | | | | |
...through 20
```

---

Write everything to `VERIFICATION_REPORT.md` in project root. 
Be ruthlessly honest. If you can't verify something works, say so.
