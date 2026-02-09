import { query } from '../../db.js';
import { HubSpotClient } from './client.js';
import type { SourceSchema, ObjectTypeSchema, FieldSchema } from '../_interface.js';

function mapHubSpotType(hsType: string, hsFieldType: string): string {
  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    date: 'date',
    datetime: 'date',
    bool: 'boolean',
    enumeration: 'picklist',
  };
  return typeMap[hsType] || 'string';
}

export async function discoverSchema(client: HubSpotClient): Promise<SourceSchema> {
  const allProps = await client.getAllProperties();

  const toObjectTypeSchema = (
    name: string,
    props: Array<{ name: string; label: string; type: string; fieldType: string; hubspotDefined: boolean; hidden: boolean; archived: boolean; options: Array<{ label: string; value: string }> }>
  ): ObjectTypeSchema => {
    const fields: FieldSchema[] = props
      .filter(p => !p.hidden && !p.archived)
      .map(p => ({
        name: p.name,
        label: p.label,
        type: mapHubSpotType(p.type, p.fieldType),
        required: false,
        custom: !p.hubspotDefined,
        options: p.options?.length > 0 ? p.options.map(o => ({ label: o.label, value: o.value })) : undefined,
      }));

    return { name, fields };
  };

  return {
    objectTypes: [
      toObjectTypeSchema('deals', allProps.deals),
      toObjectTypeSchema('contacts', allProps.contacts),
      toObjectTypeSchema('companies', allProps.companies),
    ],
  };
}

export async function discoverPipelines(client: HubSpotClient): Promise<any> {
  const pipelines = await client.getPipelines();
  return pipelines.map(p => ({
    id: p.id,
    label: p.label,
    stages: p.stages.map(s => ({
      id: s.id,
      label: s.label,
      displayOrder: s.displayOrder,
      probability: s.metadata.probability,
      isClosed: s.metadata.isClosed === 'true',
    })),
  }));
}

export async function storeSchemaMetadata(
  workspaceId: string,
  schema: SourceSchema,
  pipelines: any
): Promise<void> {
  const metadata = {
    schema,
    pipelines,
    discoveredAt: new Date().toISOString(),
  };

  await query(
    `UPDATE connections
     SET sync_cursor = COALESCE(sync_cursor, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE workspace_id = $2 AND connector_name = 'hubspot'`,
    [JSON.stringify({ schemaMetadata: metadata }), workspaceId]
  );
}
