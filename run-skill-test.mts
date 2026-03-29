import { getSkillRuntime } from './server/skills/runtime.js';
import { engagementDropoffAnalysisSkill } from './server/skills/library/engagement-dropoff-analysis.js';

const runtime = getSkillRuntime();
const result = await runtime.executeSkill(
  engagementDropoffAnalysisSkill,
  '4160191d-73bc-414b-97dd-5a1853190378',
  {}
);

console.log('Status:', result.status);
console.log('Gate:', JSON.stringify(result.gate));

if ((result as any).status === 'blocked') {
  console.log('Blocked reason:', (result as any).reason);
  process.exit(0);
}

const compute = (result.stepResults as any)?.['analyze-engagement-dropoff'];
if (compute) {
  console.log('\n=== THRESHOLD TABLE ===');
  console.log(JSON.stringify(compute.threshold_analysis?.stages, null, 2));
  console.log('\nTotal closed deals analyzed:', compute.threshold_analysis?.total_closed_deals_analyzed);
  console.log('Data sources:', JSON.stringify(compute.threshold_analysis?.data_sources));
} else {
  console.log('No compute step. stepResults keys:', Object.keys(result.stepResults || {}));
  console.log('Full result snippet:', JSON.stringify(result, null, 2).slice(0, 3000));
}

const risk = (result.stepResults as any)?.['compute-open-deal-risk'];
if (risk) {
  console.log('\n=== OPEN DEAL RISK ===');
  console.log('Critical:', risk.open_deal_risk?.summary?.critical_count, 'deals');
  console.log('Critical value: $', risk.open_deal_risk?.summary?.critical_value);
  console.log('Warning:', risk.open_deal_risk?.summary?.warning_count, 'deals');
  console.log('\nCritical deals (first 3):');
  (risk.open_deal_risk?.critical ?? []).slice(0, 3).forEach((d: any) => {
    console.log(' -', d.name, '$'+d.amount, d.stage, d.days_since_two_way+'d');
  });
} else {
  console.log('No risk step result.');
}
