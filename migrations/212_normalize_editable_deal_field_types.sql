-- Normalize field_type in editable_deal_fields to lowercase trimmed values.
-- Also maps Salesforce/HubSpot raw types to their normalized equivalents.
UPDATE editable_deal_fields
SET field_type = LOWER(TRIM(field_type))
WHERE field_type IS NOT NULL
  AND field_type <> LOWER(TRIM(field_type));

-- Map remaining Salesforce/HubSpot raw types to normalized equivalents
UPDATE editable_deal_fields
SET field_type = 'number'
WHERE field_type IN ('double', 'currency', 'int');

UPDATE editable_deal_fields
SET field_type = 'text'
WHERE field_type IN ('string');

UPDATE editable_deal_fields
SET field_type = 'boolean'
WHERE field_type IN ('bool');

UPDATE editable_deal_fields
SET field_type = 'picklist'
WHERE field_type IN ('enumeration', 'multipicklist');
