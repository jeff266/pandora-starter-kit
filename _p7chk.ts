import { resolveWorkspaceIntelligence } from './server/lib/workspace-intelligence.js';
import { getSkillBlockingQuestions } from './server/lib/calibration-questions.js';

const wi = await resolveWorkspaceIntelligence('4160191d-73bc-414b-97dd-5a1853190378');

console.log('overall_score:', wi.readiness.overall_score);
console.log('blocking_gaps count:', wi.readiness.blocking_gaps.length);
console.log('blocking_gaps (first 5):', wi.readiness.blocking_gaps.slice(0, 5), '...');
console.log('pipeline-waterfall gate:', wi.readiness.skill_gates['pipeline-waterfall']);
console.log('pipeline-coverage gate:', wi.readiness.skill_gates['pipeline-coverage']);

const pipelineBlocking = getSkillBlockingQuestions('pipeline-waterfall');
console.log('pipeline-waterfall blocking questions:', pipelineBlocking.map((q: any) => q.question_id));
