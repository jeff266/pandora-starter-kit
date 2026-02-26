import { computeFields } from '../computed-fields/engine.js';

const workspaceId = process.argv[2];

if (!workspaceId) {
  console.error('Usage: tsx server/scripts/run-compute-fields.ts <workspaceId>');
  process.exit(1);
}

console.log(`[compute] Running compute fields for workspace ${workspaceId}...`);

computeFields(workspaceId)
  .then(result => {
    console.log(`[compute] Success!`);
    console.log(`[compute] Updated ${result.dealsUpdated} deals`);
    console.log(`[compute] Updated ${result.accountsUpdated} accounts`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[compute] Error:', err);
    process.exit(1);
  });
