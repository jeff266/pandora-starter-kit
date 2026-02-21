// Google Drive Delivery for Reports

import { ReportGeneration, ReportTemplate } from '../reports/types.js';
import { createLogger } from '../utils/logger.js';
import * as fs from 'fs';
import { DateTime } from 'luxon';

const logger = createLogger('GDriveDelivery');

export interface GDriveDeliveryResult {
  success: boolean;
  file_links: { format: string; url: string }[];
  error?: string;
}

export interface GDriveConfig {
  folder_id: string;
  folder_name?: string;
  versioning?: 'new_file' | 'overwrite';
  naming_pattern?: string;
}

export async function deliverReportToGDrive(
  generation: ReportGeneration,
  template: ReportTemplate,
  workspaceId: string,
  config: GDriveConfig
): Promise<GDriveDeliveryResult> {

  if (!config.folder_id) {
    return { success: false, file_links: [], error: 'No Google Drive folder configured' };
  }

  try {
    // Get Google Drive client from connector
    const driveClient = await getGoogleDriveClient(workspaceId);
    if (!driveClient) {
      return {
        success: false,
        file_links: [],
        error: 'Google Drive not connected. Reconnect in Settings → Connectors.',
      };
    }

    const fileLinks: { format: string; url: string }[] = [];

    // Upload each generated format
    for (const [format, fileInfo] of Object.entries(generation.formats_generated || {})) {
      if (!fileInfo.filepath || !fs.existsSync(fileInfo.filepath)) {
        logger.warn('File not found for upload', { format, filepath: fileInfo.filepath });
        continue;
      }

      const buffer = fs.readFileSync(fileInfo.filepath);
      const filename = buildFilename(template.name, generation.created_at, format, config.naming_pattern);

      const mimeTypes: Record<string, string> = {
        pdf: 'application/pdf',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      };

      try {
        let fileId: string;

        if (config.versioning === 'overwrite') {
          // Find existing file with same base name
          const existing = await driveClient.findFileInFolder(config.folder_id, filename);
          if (existing) {
            await driveClient.updateFileContent(existing.id, buffer, mimeTypes[format]);
            fileId = existing.id;
            logger.info('Updated existing Google Drive file', { filename, fileId });
          } else {
            const uploaded = await driveClient.uploadFile(config.folder_id, filename, buffer, mimeTypes[format]);
            fileId = uploaded.id;
            logger.info('Uploaded new Google Drive file', { filename, fileId });
          }
        } else {
          const uploaded = await driveClient.uploadFile(config.folder_id, filename, buffer, mimeTypes[format]);
          fileId = uploaded.id;
          logger.info('Uploaded new Google Drive file', { filename, fileId });
        }

        fileLinks.push({
          format,
          url: `https://drive.google.com/file/d/${fileId}/view`,
        });
      } catch (error) {
        logger.error(`Google Drive upload failed for ${format}`, error instanceof Error ? error : undefined);
        // Don't fail the whole delivery if one format fails
      }
    }

    if (fileLinks.length === 0) {
      return { success: false, file_links: [], error: 'All file uploads failed' };
    }

    return { success: true, file_links: fileLinks };
  } catch (error) {
    logger.error('Google Drive delivery failed', error instanceof Error ? error : undefined);
    return {
      success: false,
      file_links: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function buildFilename(
  reportName: string,
  createdAt: string,
  format: string,
  pattern?: string
): string {
  const date = DateTime.fromISO(createdAt);
  const safeName = reportName.replace(/[^a-z0-9]/gi, '-').toLowerCase();

  if (pattern) {
    return pattern
      .replace('{{report_name}}', safeName)
      .replace('{{date}}', date.toFormat('yyyy-MM-dd'))
      .replace('{{format}}', format);
  }

  // Default: "report-name-2026-02-20.pdf"
  return `${safeName}-${date.toFormat('yyyy-MM-dd')}.${format}`;
}

/**
 * Get Google Drive client from workspace connectors
 */
async function getGoogleDriveClient(workspaceId: string): Promise<GoogleDriveClientAdapter | null> {
  const { query } = await import('../db.js');
  const { GoogleDriveClient } = await import('../connectors/google-drive/client.js');
  type GoogleDriveCredentials = {
    accessToken: string;
    refreshToken?: string;
    clientId?: string;
    clientSecret?: string;
    expiresAt?: number;
  };

  // Get connector config from database
  const result = await query(
    `SELECT id, credentials, config, client_id, client_secret
     FROM connector_configs
     WHERE workspace_id = $1 AND connector_type = 'google_drive' AND status = 'active'
     LIMIT 1`,
    [workspaceId]
  );

  if (result.rows.length === 0) {
    logger.info('No active Google Drive connector found', { workspaceId });
    return null;
  }

  const config = result.rows[0];
  const credentials: GoogleDriveCredentials = {
    accessToken: config.credentials.access_token || config.credentials.accessToken,
    refreshToken: config.credentials.refresh_token || config.credentials.refreshToken,
    clientId: config.client_id,
    clientSecret: config.client_secret,
    expiresAt: config.credentials.expires_at,
  };

  const client = new GoogleDriveClient();

  // Token refresh callback to update database
  const onTokenRefresh = async (newAccessToken: string, newExpiresAt: number) => {
    try {
      await query(
        `UPDATE connector_configs
         SET credentials = jsonb_set(
           jsonb_set(credentials, '{access_token}', to_jsonb($1::text)),
           '{expires_at}', to_jsonb($2::bigint)
         ),
         last_sync_at = NOW()
         WHERE id = $3`,
        [newAccessToken, newExpiresAt, config.id]
      );
      logger.info('Refreshed Google Drive token', { workspaceId, connector_id: config.id });
    } catch (error) {
      logger.error('Failed to update refreshed token', error instanceof Error ? error : undefined);
    }
  };

  return new GoogleDriveClientAdapter(client, credentials, onTokenRefresh);
}

/**
 * Adapter class to wrap GoogleDriveClient with token refresh handling
 */
class GoogleDriveClientAdapter {
  constructor(
    private client: any,
    private credentials: any,
    private onTokenRefresh?: (accessToken: string, expiresAt: number) => Promise<void>
  ) {}

  async findFileInFolder(folderId: string, filename: string): Promise<{ id: string; name: string } | null> {
    return await this.client.findFileInFolder(this.credentials, folderId, filename);
  }

  async uploadFile(folderId: string, filename: string, buffer: Buffer, mimeType: string): Promise<{ id: string }> {
    return await this.client.uploadFile(this.credentials, folderId, filename, buffer, mimeType);
  }

  async updateFileContent(fileId: string, buffer: Buffer, mimeType: string): Promise<void> {
    return await this.client.updateFileContent(this.credentials, fileId, buffer, mimeType);
  }
}
