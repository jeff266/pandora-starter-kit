import { verifyConnection } from './server/db.js';
import { registerBuiltInSkills, loadCustomSkills } from './server/skills/index.js';
import { triggerAgentRunNow } from './server/sync/report-scheduler.js';

const WORKSPACE_ID = '4160191d-73bc-414b-97dd-5a1853190378';
const AGENT_ID = '4f8309a9-f959-44c8-ba90-9fd03939bce8';

await verifyConnection();
registerBuiltInSkills();
await loadCustomSkills(WORKSPACE_ID);

console.log('Triggering delivery-only run...');
const result = await triggerAgentRunNow(AGENT_ID, WORKSPACE_ID, 'delivery');
console.log('Done:', JSON.stringify(result, null, 2));

process.exit(0);
