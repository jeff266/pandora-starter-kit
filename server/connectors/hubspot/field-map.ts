/**
 * HubSpot Field Name Mapping
 *
 * Maps Pandora's normalized field names to HubSpot property names.
 * HubSpot uses lowercase, no spaces (e.g., closedate, dealstage).
 */

const HUBSPOT_FIELD_MAP: Record<string, string> = {
  'close_date': 'closedate',
  'amount': 'amount',
  'stage': 'dealstage',
  'deal_name': 'dealname',
  'pipeline': 'pipeline',
  'probability': 'hs_deal_stage_probability',
  'owner': 'hubspot_owner_id',
  'forecast_category': 'hs_forecast_category',
  'next_step': 'hs_next_step',
  'description': 'description',
  'closed_lost_reason': 'closed_lost_reason',
  'closed_won_reason': 'closed_won_reason',
  'deal_type': 'dealtype',
};

export function mapFieldsToHubSpot(fields: Record<string, any>): Record<string, any> {
  const mapped: Record<string, any> = {};

  for (const [key, value] of Object.entries(fields)) {
    const hsKey = HUBSPOT_FIELD_MAP[key] || key;
    mapped[hsKey] = value;
  }

  return mapped;
}

/**
 * Reverse mapping: HubSpot property names → Pandora field names
 */
export function mapFieldsFromHubSpot(fields: Record<string, any>): Record<string, any> {
  const reverseMap = Object.fromEntries(
    Object.entries(HUBSPOT_FIELD_MAP).map(([k, v]) => [v, k])
  );

  const mapped: Record<string, any> = {};

  for (const [key, value] of Object.entries(fields)) {
    const pandoraKey = reverseMap[key] || key;
    mapped[pandoraKey] = value;
  }

  return mapped;
}
