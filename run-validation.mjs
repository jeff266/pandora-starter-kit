import http from 'http';
import fs from 'fs';

const FRONTERA = "4160191d-73bc-414b-97dd-5a1853190378";
const IMUBIT = "31551fe0-b746-4384-aab2-d5cdd70b19ed";
const OUTDIR = "/tmp/agent_results";
const LOG = `${OUTDIR}/run_log.txt`;

fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(LOG, '');

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  fs.appendFileSync(LOG, line);
}

function runAgent(wsId, wsName, agentId) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ dryRun: true });
    const req = http.request({
      hostname: 'localhost', port: 5000,
      path: `/api/workspaces/${wsId}/agents/${agentId}/run`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 300000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const outfile = `${OUTDIR}/${agentId}_${wsName}.json`;
        fs.writeFileSync(outfile, body);
        log(`DONE ${agentId}/${wsName} HTTP=${res.statusCode} size=${body.length}`);
        resolve({ status: res.statusCode, size: body.length });
      });
    });
    req.on('error', e => { log(`ERROR ${agentId}/${wsName}: ${e.message}`); resolve({ error: e.message }); });
    req.on('timeout', () => { log(`TIMEOUT ${agentId}/${wsName}`); req.destroy(); resolve({ error: 'timeout' }); });
    req.write(data);
    req.end();
  });
}

async function main() {
  log("=== STARTING REMAINING AGENT RUNS ===");
  
  const runs = [
    [IMUBIT, "imubit", "forecast-call-prep"],
    [FRONTERA, "frontera", "bowtie-review"],
    [IMUBIT, "imubit", "bowtie-review"],
    [FRONTERA, "frontera", "attainment-vs-goal"],
    [IMUBIT, "imubit", "attainment-vs-goal"],
    [FRONTERA, "frontera", "strategy-insights"],
    [IMUBIT, "imubit", "strategy-insights"],
    [FRONTERA, "frontera", "friday-recap"],
    [IMUBIT, "imubit", "friday-recap"],
  ];
  
  for (const [wsId, wsName, agentId] of runs) {
    log(`START ${agentId}/${wsName}`);
    await runAgent(wsId, wsName, agentId);
  }
  
  log("=== ALL 9 RUNS COMPLETE ===");
  fs.writeFileSync(`${OUTDIR}/REMAINING_DONE`, "done");
}

main().catch(e => log(`FATAL: ${e.message}`));
