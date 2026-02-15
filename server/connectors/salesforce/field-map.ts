/**
 * Salesforce Field Name Mapping
 *
 * Maps Pandora's normalized field names to Salesforce field names.
 * Salesforce uses PascalCase for standard fields (e.g., CloseDate, StageName).
 */

const SALESFORCE_FIELD_MAP: Record<string, string> = {
  'close_date': 'CloseDate',
  'amount': 'Amount',
  'stage': 'StageName',
  'deal_name': 'Name',
  'probability': 'Probability',
  'forecast_category': 'ForecastCategoryName',
  'next_step': 'NextStep',
  'description': 'Description',
  'type': 'Type',
  'lead_source': 'LeadSource',
  'owner_id': 'OwnerId',
  'account_id': 'AccountId',
  'campaign_id': 'CampaignId',
  'is_closed': 'IsClosed',
  'is_won': 'IsWon',
};

export function mapFieldsToSalesforce(fields: Record<string, any>): Record<string, any> {
  const mapped: Record<string, any> = {};

  for (const [key, value] of Object.entries(fields)) {
    const sfKey = SALESFORCE_FIELD_MAP[key] || key;
    mapped[sfKey] = value;
  }

  return mapped;
}

/**
 * Reverse mapping: Salesforce field names → Pandora field names
 */
export function mapFieldsFromSalesforce(fields: Record<string, any>): Record<string, any> {
  const reverseMap = Object.fromEntries(
    Object.entries(SALESFORCE_FIELD_MAP).map(([k, v]) => [v, k])
  );

  const mapped: Record<string, any> = {};

  for (const [key, value] of Object.entries(fields)) {
    const pandoraKey = reverseMap[key] || key;
    mapped[pandoraKey] = value;
  }

  return mapped;
}
