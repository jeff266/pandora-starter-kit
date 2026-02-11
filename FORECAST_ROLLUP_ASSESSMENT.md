==========================================
FORECAST ROLL-UP SKILL ASSESSMENT
==========================================

## Step 1: Get Workspace ID

Workspace ID: 4160191d-73bc-414b-97dd-5a1853190378

==========================================
## 1. CATEGORY DISTRIBUTION
==========================================

 forecast_category | forecast_category_source | deal_count | total_value | avg_probability | min_probability | max_probability 
-------------------+--------------------------+------------+-------------+-----------------+-----------------+-----------------
 best_case         | derived                  |          1 |    27000.00 |           0.800 |           0.800 |           0.800
 pipeline          | derived                  |         74 |  2224486.00 |           0.322 |           0.100 |           0.500
                   |                          |         60 |  2464020.00 |           0.577 |           0.000 |           1.000
(3 rows)


==========================================
## 2. QUOTA STATUS
==========================================

Quota Periods:
 period_count 
--------------
            1
(1 row)


Rep Quotas:
 rep_quota_count 
-----------------
               3
(1 row)


==========================================
## 3. FORECAST ROLL-UP SKILL INFO
==========================================

                  id                  |    skill_id     |  status   |          created_at           |        completed_at        | duration_seconds 
--------------------------------------+-----------------+-----------+-------------------------------+----------------------------+------------------
 fb728ea7-1e27-4c62-8e1f-e3de9d9cccd8 | forecast-rollup | completed | 2026-02-11 23:01:20.538186+00 | 2026-02-11 23:01:43.676+00 |        23.137814
 ad9a228b-90b2-4eec-9758-3ad8aa72790f | forecast-rollup | completed | 2026-02-11 23:00:33.649001+00 | 2026-02-11 23:00:53.854+00 |        20.204999
 8164de86-f307-4643-af8d-d8df8e447a2a | forecast-rollup | completed | 2026-02-11 22:58:00.161146+00 | 2026-02-11 22:58:20.797+00 |        20.635854
 cb150f1c-f5a0-4543-96b8-07c1b792213b | forecast-rollup | completed | 2026-02-11 22:57:31.428494+00 | 2026-02-11 22:57:54.175+00 |        22.746506
 f3c1222e-5182-4857-8ca2-6d9cf14a10ee | forecast-rollup | completed | 2026-02-11 22:55:42.587232+00 | 2026-02-11 22:56:02.663+00 |        20.075768
(5 rows)


==========================================
## 4. LATEST SKILL RUN RESULT
==========================================

Latest Run ID: fb728ea7-1e27-4c62-8e1f-e3de9d9cccd8

Result JSON:
 {"narrative": "# Weekly Forecast Roll-Up\n\n## Forecast Status\n\n**Verdict: Unable to assess quota attainment — no quota configured. Based on absolute dollars, we've closed $429.8K with minimal committed upside.**\n\n- **Bear Case:** $429,815 (closed deals only)\n- **Base Case:** $456,815 (closed + $27K best case)\n- **Bull Case:** $2.68M (if entire pipeline converts)\n- **Weighted Forecast:** $1.08M\n\nThe $2.25M spread between bear and bull scenarios represents a 524% variance — this is extreme volatility signaling low forecast confidence. Our team is essentially operating without committed deals beyond what's already closed.\n\n## Category Analysis\n\n**Critical gap: Zero committed pipeline.** Every dollar beyond our $429.8K closed revenue sits in either Best Case ($27K) or Pipeline ($2.22M). This means:\n\n- 99.4% of our forecast relies on closed deals or speculative pipeline\n- Only one deal ($27K from Nate Phillips) has moved to Best Case\n- $2.22M remains in early-stage pipeline across 74 deals\n- Average pipeline deal size: $30,060 — suggests mix of SMB and mid-market\n\nThe massive bear-to-bull spread indicates reps haven't committed to February closes. We're either sandbagging or genuinely lack deal velocity.\n\n## Rep Spotlight\n\n**Nate Phillips is carrying the team:** $295.5K closed (69% of total revenue), plus the only Best Case deal ($27K), and $1.7M pipeline (76% of team pipeline) across 57 deals. He's effectively running a one-person revenue operation.\n\n**Sara Bollman** has closed $132.5K (31% of revenue) but shows warning signs: 78 deals with $525K pipeline yet zero committed. High deal count with low average deal size ($6,733) suggests she's chasing small opportunities without advancing larger deals.\n\n**Carter McKay and Jack McArdle** are non-factors this period with minimal activity.\n\n## Week-over-Week Movement\n\n**Zero movement since February 11th across all categories.** This is highly unusual — no deals closed, no stage progression, no pipeline changes. Either:\n1. Data hasn't been updated\n2. Team activity has stalled mid-month\n3. This represents a snapshot freeze\n\nThis lack of movement is the biggest red flag in the forecast.\n\n## Top 3 Actions This Week\n\n1. **Nate Phillips: Commit review on $1.7M pipeline (TODAY)** — He holds 76% of pipeline but nothing committed. Identify top 5 deals likely to close this month and move them to Commit. Target: $200K+ committed by Friday.\n\n2. **Sara Bollman: Deal qualification audit (by Wednesday)** — 78 deals averaging $6.7K suggests spray-and-pray approach. Cut bottom 50% of pipeline, focus on 10 deals >$15K. Goal: Move 2-3 qualified deals to Best Case.\n\n3. **Sales leadership: Investigate forecast freeze (URGENT)** — Zero WoW change across 137 deals is statistically improbable. Verify CRM hygiene, confirm reps are updating stages, and establish daily forecast updates through month-end.", "wow_delta": {"changes": {"commit": {"to": 0, "from": 0, "delta": 0, "direction": "flat", "deltaPercent": 0}, "baseCase": {"to": 456815, "from": 456815, "delta": 0, "direction": "flat", "deltaPercent": 0}, "bearCase": {"to": 429815, "from": 429815, "delta": 0, "direction": "flat", "deltaPercent": 0}, "bestCase": {"to": 27000, "from": 27000, "delta": 0, "direction": "flat", "deltaPercent": 0}, "bullCase": {"to": 2681301, "from": 2681301, "delta": 0, "direction": "flat", "deltaPercent": 0}, "pipeline": {"to": 2224486, "from": 2224486, "delta": 0, "direction": "flat", "deltaPercent": 0}, "closedWon": {"to": 429815, "from": 429815, "delta": 0, "direction": "flat", "deltaPercent": 0}}, "available": true, "previousRunDate": "2026-02-11T23:00:53.854Z"}, "quota_config": {"source": "none", "hasQuotas": false, "repQuotas": null, "teamQuota": null, "hasRepQuotas": false, "coverageTarget": 3}, "forecast_data": {"team": {"commit": 0, "baseCase": 456815, "bearCase": 429815, "bestCase": 27000, "bullCase": 2681301, "pipeline": 2224486, "closedWon": 429815, "teamQuota": null, "attainment": null, "notForecasted": 0, "weightedForecast": 1082328.9}, "byRep": [{"name": "Nate Phillips", "quota": null, "commit": 0, "status": null, "bearCase": 295535, "bestCase": 27000, "pipeline": 1699300, "closedWon": 295535, "dealCount": 57, "attainment": null, "notForecasted": 0}, {"name": "Sara Bollman", "quota": null, "commit": 0, "status": null, "bearCase": 132480, "bestCase": 0, "pipeline": 525185, "closedWon": 132480, "dealCount": 78, "attainment": null, "notForecasted": 0}, {"name": "Carter McKay", "quota": null, "commit": 0, "status": null, "bearCase": 1800, "bestCase": 0, "pipeline": 0, "closedWon": 1800, "dealCount": 1, "attainment": null, "notForecasted": 0}, {"name": "Jack McArdle", "quota": null, "commit": 0, "status": null, "bearCase": 0, "bestCase": 0, "pipeline": 1, "closedWon": 0, "dealCount": 1, "attainment": null, "notForecasted": 0}], "dealCount": {"total": 137, "closed": 62, "commit": 0, "bestCase": 1, "pipeline": 74, "notForecasted": 0}}, "forecast_summary": {"repTable": "Nate Phillips: CW=$295,535 Commit=$0 BC=$27,000 Pipe=$1,699,300 (57 deals)\nSara Bollman: CW=$132,480 Commit=$0 BC=$0 Pipe=$525,185 (78 deals)\nCarter McKay: CW=$1,800 Commit=$0 BC=$0 Pipe=$0 (1 deals)\nJack McArdle: CW=$0 Commit=$0 BC=$0 Pipe=$1 (1 deals)", "quotaNote": "NOTE: No quota data configured. All analysis uses absolute amounts only. Attainment percentages and rep status are unavailable.", "dealCounts": "Deals — Closed: 62 | Commit: 0 | Best Case: 1 | Pipeline: 74 | Not Forecasted: 0 | Total: 137", "wowSummary": "Previous run: 2/11/2026\nClosed Won: $429,815 → $429,815 (+$0, 0%)\nCommit: $0 → $0 (+$0, 0%)\nBest Case: $27,000 → $27,000 (+$0, 0%)\nPipeline: $2,224,486 → $2,224,486 (+$0, 0%)\nBear Case: $429,815 → $429,815 (+$0, 0%)\nBase Case: $456,815 → $456,815 (+$0, 0%)", "teamSummary": "Closed Won: $429,815 | Commit: $0 | Best Case: $27,000 | Pipeline: $2,224,486\nBear Case: $429,815 | Base Case: $456,815 | Bull Case: $2,681,301\nWeighted Forecast: $1,082,328.9\nSpread (Bull - Bear): $2,251,486"}}


Output Text:
 # Weekly Forecast Roll-Up                                                                                                                                                                                                                                    +
                                                                                                                                                                                                                                                              +
 ## Forecast Status                                                                                                                                                                                                                                           +
                                                                                                                                                                                                                                                              +
 **Verdict: Unable to assess quota attainment — no quota configured. Based on absolute dollars, we've closed $429.8K with minimal committed upside.**                                                                                                         +
                                                                                                                                                                                                                                                              +
 - **Bear Case:** $429,815 (closed deals only)                                                                                                                                                                                                                +
 - **Base Case:** $456,815 (closed + $27K best case)                                                                                                                                                                                                          +
 - **Bull Case:** $2.68M (if entire pipeline converts)                                                                                                                                                                                                        +
 - **Weighted Forecast:** $1.08M                                                                                                                                                                                                                              +
                                                                                                                                                                                                                                                              +
 The $2.25M spread between bear and bull scenarios represents a 524% variance — this is extreme volatility signaling low forecast confidence. Our team is essentially operating without committed deals beyond what's already closed.                         +
                                                                                                                                                                                                                                                              +
 ## Category Analysis                                                                                                                                                                                                                                         +
                                                                                                                                                                                                                                                              +
 **Critical gap: Zero committed pipeline.** Every dollar beyond our $429.8K closed revenue sits in either Best Case ($27K) or Pipeline ($2.22M). This means:                                                                                                  +
                                                                                                                                                                                                                                                              +
 - 99.4% of our forecast relies on closed deals or speculative pipeline                                                                                                                                                                                       +
 - Only one deal ($27K from Nate Phillips) has moved to Best Case                                                                                                                                                                                             +
 - $2.22M remains in early-stage pipeline across 74 deals                                                                                                                                                                                                     +
 - Average pipeline deal size: $30,060 — suggests mix of SMB and mid-market                                                                                                                                                                                   +
                                                                                                                                                                                                                                                              +
 The massive bear-to-bull spread indicates reps haven't committed to February closes. We're either sandbagging or genuinely lack deal velocity.                                                                                                               +
                                                                                                                                                                                                                                                              +
 ## Rep Spotlight                                                                                                                                                                                                                                             +
                                                                                                                                                                                                                                                              +
 **Nate Phillips is carrying the team:** $295.5K closed (69% of total revenue), plus the only Best Case deal ($27K), and $1.7M pipeline (76% of team pipeline) across 57 deals. He's effectively running a one-person revenue operation.                      +
                                                                                                                                                                                                                                                              +
 **Sara Bollman** has closed $132.5K (31% of revenue) but shows warning signs: 78 deals with $525K pipeline yet zero committed. High deal count with low average deal size ($6,733) suggests she's chasing small opportunities without advancing larger deals.+
                                                                                                                                                                                                                                                              +
 **Carter McKay and Jack McArdle** are non-factors this period with minimal activity.                                                                                                                                                                         +
                                                                                                                                                                                                                                                              +
 ## Week-over-Week Movement                                                                                                                                                                                                                                   +
                                                                                                                                                                                                                                                              +
 **Zero movement since February 11th across all categories.** This is highly unusual — no deals closed, no stage progression, no pipeline changes. Either:                                                                                                    +
 1. Data hasn't been updated                                                                                                                                                                                                                                  +
 2. Team activity has stalled mid-month                                                                                                                                                                                                                       +
 3. This represents a snapshot freeze                                                                                                                                                                                                                         +
                                                                                                                                                                                                                                                              +
 This lack of movement is the biggest red flag in the forecast.                                                                                                                                                                                               +
                                                                                                                                                                                                                                                              +
 ## Top 3 Actions This Week                                                                                                                                                                                                                                   +
                                                                                                                                                                                                                                                              +
 1. **Nate Phillips: Commit review on $1.7M pipeline (TODAY)** — He holds 76% of pipeline but nothing committed. Identify top 5 deals likely to close this month and move them to Commit. Target: $200K+ committed by Friday.                                 +
                                                                                                                                                                                                                                                              +
 2. **Sara Bollman: Deal qualification audit (by Wednesday)** — 78 deals averaging $6.7K suggests spray-and-pray approach. Cut bottom 50% of pipeline, focus on 10 deals >$15K. Goal: Move 2-3 qualified deals to Best Case.                                  +
                                                                                                                                                                                                                                                              +
 3. **Sales leadership: Investigate forecast freeze (URGENT)** — Zero WoW change across 137 deals is statistically improbable. Verify CRM hygiene, confirm reps are updating stages, and establish daily forecast updates through month-end.


==========================================
ASSESSMENT COMPLETE
==========================================
