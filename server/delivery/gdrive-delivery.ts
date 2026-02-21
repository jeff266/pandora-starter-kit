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
 * This is a placeholder - actual implementation depends on your connector system
 */
async function getGoogleDriveClient(workspaceId: string): Promise<GoogleDriveClient | null> {
  // TODO: Implement based on your existing connector infrastructure
  // Should retrieve OAuth token and create Google Drive API client

  // For now, return null to indicate Drive is not connected
  logger.warn('Google Drive client not implemented', { workspaceId });
  return null;
}

/**
 * Google Drive client interface
 * Implement this based on your existing connector system
 */
interface GoogleDriveClient {
  findFileInFolder(folderId: string, filename: string): Promise<{ id: string; name: string } | null>;
  uploadFile(folderId: string, filename: string, buffer: Buffer, mimeType: string): Promise<{ id: string }>;
  updateFileContent(fileId: string, buffer: Buffer, mimeType: string): Promise<void>;
}
