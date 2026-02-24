/**
 * Field Name Resolver
 *
 * Resolves Pandora field names to CRM API field names.
 * Also provides human-readable labels for the preview UI.
 */

export function resolveFieldToCRM(
  connectorType: 'hubspot' | 'salesforce',
  pandoraField: string
): { apiName: string; label: string } {

  const map = connectorType === 'hubspot' ? HUBSPOT_FIELDS : SALESFORCE_FIELDS;
  const entry = map[pandoraField];

  if (entry) return entry;

  // Unknown field — return as-is with generated label
  return {
    apiName: pandoraField,
    label: pandoraField.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  };
}

const HUBSPOT_FIELDS: Record<string, { apiName: string; label: string }> = {
  'close_date':         { apiName: 'closedate',                  label: 'Close Date' },
  'stage':              { apiName: 'dealstage',                  label: 'Deal Stage' },
  'amount':             { apiName: 'amount',                     label: 'Amount' },
  'deal_name':          { apiName: 'dealname',                   label: 'Deal Name' },
  'forecast_category':  { apiName: 'hs_forecast_category',      label: 'Forecast Category' },
  'pipeline':           { apiName: 'pipeline',                   label: 'Pipeline' },
  'probability':        { apiName: 'hs_deal_stage_probability',  label: 'Win Probability' },
  'next_step':          { apiName: 'hs_next_step',               label: 'Next Step' },
  'owner':              { apiName: 'hubspot_owner_id',           label: 'Deal Owner' },
};

const SALESFORCE_FIELDS: Record<string, { apiName: string; label: string }> = {
  'close_date':         { apiName: 'CloseDate',             label: 'Close Date' },
  'stage':              { apiName: 'StageName',             label: 'Stage' },
  'amount':             { apiName: 'Amount',                label: 'Amount' },
  'deal_name':          { apiName: 'Name',                  label: 'Opportunity Name' },
  'forecast_category':  { apiName: 'ForecastCategoryName',  label: 'Forecast Category' },
  'probability':        { apiName: 'Probability',           label: 'Probability (%)' },
  'next_step':          { apiName: 'NextStep',              label: 'Next Step' },
  'description':        { apiName: 'Description',           label: 'Description' },
  'owner':              { apiName: 'OwnerId',               label: 'Owner' },
};
