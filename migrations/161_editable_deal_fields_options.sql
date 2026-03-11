-- Add field_options column to editable_deal_fields
-- Stores allowed picklist/dropdown values sourced from the connected CRM schema

ALTER TABLE editable_deal_fields
  ADD COLUMN IF NOT EXISTS field_options JSONB;
