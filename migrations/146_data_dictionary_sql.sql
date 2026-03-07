ALTER TABLE data_dictionary ADD COLUMN IF NOT EXISTS sql_definition TEXT;
ALTER TABLE data_dictionary ADD COLUMN IF NOT EXISTS segmentable_by TEXT[] DEFAULT '{}';
