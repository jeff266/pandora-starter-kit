import { query } from '../db.js';
import { DatasetAssemblyOptions, FireworksFineTuneRecord } from './dataset-assembler.js';

const FIREWORKS_API_KEY = process.env.FIREWORKS_API_KEY;
const FIREWORKS_BASE_URL = process.env.FIREWORKS_BASE_URL || 'https://api.fireworks.ai/inference/v1';

export const FIREWORKS_BASE_MODELS = {
  document_synthesis: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
  classification: 'accounts/fireworks/models/llama-v3p1-8b-instruct'
};

export interface FineTuningJob {
  id: string;
  model_purpose: 'document_synthesis' | 'classification';
  pair_type: string;
  base_model: string;
  fireworks_job_id?: string;
  fireworks_model_id?: string;
  status: string;
  deployment_endpoint?: string;
  val_loss?: number;
  confidence_gate_threshold?: number;
  created_at: Date;
}

/**
 * Submits a fine-tuning job to Fireworks.
 */
export async function submitFineTuningJob(
  purpose: 'document_synthesis' | 'classification',
  dataset: { train: FireworksFineTuneRecord[]; val: FireworksFineTuneRecord[] }
): Promise<string> {
  if (!FIREWORKS_API_KEY) {
    throw new Error('FIREWORKS_API_KEY is not set');
  }

  try {
    // 1. Upload dataset
    const datasetUri = await uploadDatasetToFireworks(dataset);

    // 2. Create DB record
    const jobId = await createJobRecord(purpose, dataset, datasetUri);

    // 3. Submit to Fireworks
    const fireworksJobId = await submitToFireworks({
      model: FIREWORKS_BASE_MODELS[purpose],
      datasetUri,
      jobId
    });

    // 4. Update DB with fireworks job ID
    await query(
      'UPDATE fine_tuning_jobs SET fireworks_job_id = $1, status = $2, submitted_at = NOW() WHERE id = $3',
      [fireworksJobId, 'submitted', jobId]
    );

    // 5. Start polling
    schedulePollJob(jobId, fireworksJobId);

    return jobId;
  } catch (error: any) {
    console.error('[FireworksTrainer] Failed to submit fine-tuning job:', error);
    throw error;
  }
}

/**
 * Uploads training/validation data to Fireworks as JSONL.
 */
async function uploadDatasetToFireworks(dataset: {
  train: FireworksFineTuneRecord[];
  val: FireworksFineTuneRecord[];
}): Promise<string> {
  // Fireworks expects a dataset to be uploaded first or pointed to.
  // Using their Dataset API: POST /v1/accounts/{account}/datasets
  // However, for simplicity and common patterns, we often upload to S3 or a public URL.
  // The spec says "POST to Fireworks datasets API with JSONL content".
  
  const accountId = FIREWORKS_BASE_MODELS.document_synthesis.split('/')[1];
  
  // We'll upload training data. Fireworks might require separate uploads for train/val.
  // Spec says "returns dataset URI".
  
  const jsonl = dataset.train.map(r => JSON.stringify(r)).join('\n');
  
  const response = await fetch(`${FIREWORKS_BASE_URL}/accounts/${accountId}/datasets`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIREWORKS_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      dataset_type: 'fine-tuning',
      // In a real scenario, we might need to send a multipart form or a specific JSON structure
      // Fireworks API usually takes a file upload or a URL.
      // Based on typical Fireworks API:
      content: jsonl 
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Fireworks Dataset Upload failed: ${err}`);
  }

  const data = (await response.json()) as any;
  return data.uri || data.name; // Fireworks returns a URI
}

async function createJobRecord(
  purpose: 'document_synthesis' | 'classification',
  dataset: { train: FireworksFineTuneRecord[]; val: FireworksFineTuneRecord[] },
  datasetUri: string
): Promise<string> {
  const res = await query(
    `INSERT INTO fine_tuning_jobs 
     (model_purpose, pair_type, base_model, train_record_count, val_record_count, dataset_s3_uri, status)
     VALUES ($1, $1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [purpose, FIREWORKS_BASE_MODELS[purpose], dataset.train.length, dataset.val.length, datasetUri, 'pending']
  );
  return res.rows[0].id;
}

async function submitToFireworks(params: { model: string; datasetUri: string; jobId: string }): Promise<string> {
  const accountId = params.model.split('/')[1];
  
  const response = await fetch(`${FIREWORKS_BASE_URL}/accounts/${accountId}/fine-tuning-jobs`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIREWORKS_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      base_model: params.model,
      dataset_uri: params.datasetUri,
      // hyper-parameters from spec
      epochs: 3,
      learning_rate: 0.0001,
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Fireworks Job Submission failed: ${err}`);
  }

  const data = (await response.json()) as any;
  return data.id; // fireworks_job_id
}

function schedulePollJob(jobId: string, fireworksJobId: string) {
  const interval = setInterval(async () => {
    try {
      const finished = await pollFineTuningJob(jobId, fireworksJobId);
      if (finished) {
        clearInterval(interval);
      }
    } catch (error) {
      console.error(`[FireworksTrainer] Error polling job ${jobId}:`, error);
      // We don't clear interval here to allow for transient errors
    }
  }, 5 * 60 * 1000); // 5 minutes
}

export async function pollFineTuningJob(jobId: string, fireworksJobId: string): Promise<boolean> {
  const accountId = FIREWORKS_BASE_MODELS.document_synthesis.split('/')[1];
  
  const response = await fetch(`${FIREWORKS_BASE_URL}/accounts/${accountId}/fine-tuning-jobs/${fireworksJobId}`, {
    headers: { 'Authorization': `Bearer ${FIREWORKS_API_KEY}` }
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`[FireworksTrainer] Poll failed: ${err}`);
    return false;
  }

  const data = (await response.json()) as any;
  const status = data.state?.toLowerCase(); // COMPLETED, FAILED, RUNNING, etc.

  if (status === 'completed') {
    await onJobCompleted(jobId, data);
    return true;
  } else if (status === 'failed') {
    await query(
      'UPDATE fine_tuning_jobs SET status = $1, failed_reason = $2, completed_at = NOW() WHERE id = $3',
      ['failed', data.error_message || 'Unknown Fireworks error', jobId]
    );
    return true;
  } else if (status === 'running' || status === 'submitted') {
    await query('UPDATE fine_tuning_jobs SET status = $1 WHERE id = $2', ['training', jobId]);
  }

  return false;
}

async function onJobCompleted(jobId: string, fireworksData: any) {
  const modelId = fireworksData.output_model_id;
  const valLoss = fireworksData.metrics?.val_loss;

  // Update with completion info
  await query(
    `UPDATE fine_tuning_jobs 
     SET status = $1, fireworks_model_id = $2, val_loss = $3, completed_at = NOW() 
     WHERE id = $4`,
    ['completed', modelId, valLoss, jobId]
  );

  // Deploy model
  try {
    const endpoint = await deployFineTunedModel(modelId);
    await query(
      'UPDATE fine_tuning_jobs SET status = $1, deployment_endpoint = $2, deployed_at = NOW() WHERE id = $3',
      ['deployed', endpoint, jobId]
    );
  } catch (error: any) {
    console.error(`[FireworksTrainer] Auto-deployment failed for job ${jobId}:`, error);
    await query(
      'UPDATE fine_tuning_jobs SET failed_reason = $1 WHERE id = $2',
      [`Deployment failed: ${error.message}`, jobId]
    );
  }
}

export async function deployFineTunedModel(modelId: string): Promise<string> {
  const accountId = FIREWORKS_BASE_MODELS.document_synthesis.split('/')[1];
  
  const response = await fetch(`${FIREWORKS_BASE_URL}/accounts/${accountId}/deployments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIREWORKS_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: modelId,
      // Other deployment params if needed
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Fireworks Deployment failed: ${err}`);
  }

  const data = (await response.json()) as any;
  return data.endpoint_url || data.name; // Return the endpoint URL
}

export async function getDeployedFineTunedModel(capability: string): Promise<FineTuningJob | null> {
  const purposeMap: Record<string, 'document_synthesis' | 'classification'> = {
    reason: 'document_synthesis',
    classify: 'classification',
    intent_classify: 'classification'
  };

  const purpose = purposeMap[capability];
  if (!purpose) return null;

  const res = await query(
    `SELECT * FROM fine_tuning_jobs 
     WHERE model_purpose = $1 AND status = 'deployed' 
     ORDER BY deployed_at DESC LIMIT 1`,
    [purpose]
  );

  return (res.rows[0] as FineTuningJob) || null;
}
