/**
 * Google Drive Document Adapter
 *
 * Implements DocumentAdapter interface to normalize Google Drive files to Pandora documents.
 * Supports content extraction for Google Workspace docs and text files.
 *
 * Supported file types:
 * - Google Docs, Sheets, Slides (exported as text)
 * - Plain text, Markdown files
 * - PDFs, images (metadata only, no content extraction yet)
 */

import type {
  DocumentAdapter,
  NormalizedDocument,
  SyncResult,
} from '../adapters/types.js';
import { GoogleDriveClient, type GoogleDriveCredentials, type DriveFile } from './client.js';
import { transformWithErrorCapture } from '../../utils/sync-helpers.js';

export class GoogleDriveDocumentAdapter implements DocumentAdapter {
  readonly sourceType = 'google-drive';
  readonly category = 'documents' as const;

  private client = new GoogleDriveClient();

  /**
   * Test connection to Google Drive
   */
  async testConnection(credentials: Record<string, any>): Promise<{ success: boolean; error?: string }> {
    const driveCredentials = this.validateCredentials(credentials);
    return this.client.testConnection(driveCredentials);
  }

  /**
   * Get health status (storage quota)
   */
  async health(credentials: Record<string, any>): Promise<{ healthy: boolean; details?: Record<string, any> }> {
    try {
      const driveCredentials = this.validateCredentials(credentials);
      const quota = await this.client.getStorageQuota(driveCredentials);
      return {
        healthy: true,
        details: quota || undefined,
      };
    } catch (error) {
      return {
        healthy: false,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Initial sync: fetch all documents from Google Drive
   */
  async initialSync(
    credentials: Record<string, any>,
    workspaceId: string,
    options?: Record<string, any>
  ): Promise<{ documents?: SyncResult<NormalizedDocument> }> {
    const driveCredentials = this.validateCredentials(credentials);
    const files: DriveFile[] = [];

    let pageToken: string | undefined;
    const query = options?.query || this.buildDefaultQuery();

    // Paginate through all files
    do {
      const response = await this.client.listFiles(driveCredentials, {
        pageSize: 100,
        pageToken,
        query,
        orderBy: 'modifiedTime desc',
      });

      files.push(...response.files);
      pageToken = response.nextPageToken;
    } while (pageToken);

    const documentTransformResult = transformWithErrorCapture(
      files,
      (file) => this.transformDocument(file, workspaceId),
      'Google Drive Documents',
      (file) => file.id
    );

    return { documents: documentTransformResult };
  }

  /**
   * Incremental sync: fetch documents modified since lastSyncTime
   */
  async incrementalSync(
    credentials: Record<string, any>,
    workspaceId: string,
    lastSyncTime: Date,
    options?: Record<string, any>
  ): Promise<{ documents?: SyncResult<NormalizedDocument> }> {
    const driveCredentials = this.validateCredentials(credentials);
    const files: DriveFile[] = [];

    let pageToken: string | undefined;
    const baseQuery = options?.query || this.buildDefaultQuery();
    const modifiedQuery = `${baseQuery} and modifiedTime > '${lastSyncTime.toISOString()}'`;

    // Paginate through modified files
    do {
      const response = await this.client.listFiles(driveCredentials, {
        pageSize: 100,
        pageToken,
        query: modifiedQuery,
        orderBy: 'modifiedTime desc',
      });

      files.push(...response.files);
      pageToken = response.nextPageToken;
    } while (pageToken);

    const documentTransformResult = transformWithErrorCapture(
      files,
      (file) => this.transformDocument(file, workspaceId),
      'Google Drive Documents (Incremental)',
      (file) => file.id
    );

    return { documents: documentTransformResult };
  }

  /**
   * Transform Google Drive file to normalized document
   */
  transformDocument(file: DriveFile, workspaceId: string, options?: any): NormalizedDocument {
    const owner = file.owners?.[0]?.displayName || null;
    const sizeBytes = file.size ? parseInt(file.size, 10) : null;

    return {
      workspace_id: workspaceId,
      source: 'google-drive',
      source_id: file.id,
      source_data: {
        name: file.name,
        mimeType: file.mimeType,
        owners: file.owners,
        webViewLink: file.webViewLink,
        description: file.description,
      },
      title: file.name,
      file_type: this.normalizeFileType(file.mimeType),
      url: file.webViewLink || null,
      size_bytes: sizeBytes,
      owner,
      created_date: new Date(file.createdTime),
      modified_date: new Date(file.modifiedTime),
      content_text: null, // Populated separately via extractContent
      tags: [],
      custom_fields: {
        mimeType: file.mimeType,
        fullFileExtension: file.fullFileExtension,
      },
    };
  }

  /**
   * Extract text content from a document
   */
  async extractContent(
    credentials: Record<string, any>,
    sourceId: string
  ): Promise<{ text: string | null; error?: string }> {
    try {
      const driveCredentials = this.validateCredentials(credentials);

      // Get file metadata to determine mimeType
      const file = await this.client.getFile(driveCredentials, sourceId);

      // Extract content based on file type
      const text = await this.client.extractContent(driveCredentials, sourceId, file.mimeType);

      return { text };
    } catch (error) {
      return {
        text: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Build default query to exclude trashed files and certain file types
   */
  private buildDefaultQuery(): string {
    return "trashed = false and mimeType != 'application/vnd.google-apps.folder'";
  }

  /**
   * Normalize Google mimeType to simple file type
   */
  private normalizeFileType(mimeType: string): string | null {
    if (mimeType.startsWith('application/vnd.google-apps.')) {
      const type = mimeType.replace('application/vnd.google-apps.', '');
      return `google-${type}`;
    }

    const mapping: Record<string, string> = {
      'application/pdf': 'pdf',
      'text/plain': 'text',
      'text/markdown': 'markdown',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'image/png': 'image',
      'image/jpeg': 'image',
      'image/gif': 'image',
    };

    return mapping[mimeType] || null;
  }

  /**
   * Validate and extract Google Drive credentials
   */
  private validateCredentials(credentials: Record<string, any>): GoogleDriveCredentials {
    if (!credentials.accessToken) {
      throw new Error('Google Drive adapter requires accessToken in credentials');
    }

    return {
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      expiresAt: credentials.expiresAt,
    };
  }
}
