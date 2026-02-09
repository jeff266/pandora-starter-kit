/**
 * Google Drive API Client
 *
 * Pure API client for Google Drive API v3.
 * Stateless - receives OAuth credentials per call with auto-refresh support.
 *
 * API Documentation: https://developers.google.com/drive/api/v3/reference
 *
 * Key Features:
 * - OAuth 2.0 with refresh token handling
 * - File metadata retrieval
 * - Content export for Google Docs/Sheets/Slides
 * - Binary file download for PDFs/images/etc.
 */

export interface GoogleDriveCredentials {
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  expiresAt?: number; // Unix timestamp in milliseconds
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime: string;
  modifiedTime: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
  webViewLink?: string;
  description?: string;
  fullFileExtension?: string;
}

export interface ListFilesOptions {
  pageSize?: number;
  pageToken?: string;
  query?: string; // e.g., "mimeType='application/pdf'"
  orderBy?: string; // e.g., "modifiedTime desc"
  fields?: string;
}

export interface ListFilesResponse {
  files: DriveFile[];
  nextPageToken?: string;
}

export class GoogleDriveClient {
  private readonly apiUrl = 'https://www.googleapis.com/drive/v3';
  private readonly oauth2Url = 'https://oauth2.googleapis.com/token';

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string
  ): Promise<{ accessToken: string; expiresAt: number }> {
    const response = await fetch(this.oauth2Url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Google OAuth error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.access_token) {
      throw new Error('Google OAuth: No access token returned');
    }

    const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;

    return {
      accessToken: data.access_token,
      expiresAt,
    };
  }

  /**
   * Ensure credentials are fresh, refresh if needed
   */
  private async ensureFreshToken(credentials: GoogleDriveCredentials): Promise<string> {
    // If token is not expired (with 5min buffer), use it
    if (credentials.expiresAt && credentials.expiresAt > Date.now() + 5 * 60 * 1000) {
      return credentials.accessToken;
    }

    // Token expired or expiring soon, refresh it
    if (credentials.refreshToken && credentials.clientId && credentials.clientSecret) {
      const refreshed = await this.refreshAccessToken(
        credentials.refreshToken,
        credentials.clientId,
        credentials.clientSecret
      );
      return refreshed.accessToken;
    }

    // No refresh token available, use existing token and hope it works
    return credentials.accessToken;
  }

  /**
   * Test connection by fetching about info
   */
  async testConnection(credentials: GoogleDriveCredentials): Promise<{ success: boolean; error?: string }> {
    try {
      const accessToken = await this.ensureFreshToken(credentials);
      const response = await fetch(`${this.apiUrl}/about?fields=user`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Google Drive API error: ${response.status} ${response.statusText}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * List files from Drive
   */
  async listFiles(
    credentials: GoogleDriveCredentials,
    options: ListFilesOptions = {}
  ): Promise<ListFilesResponse> {
    const accessToken = await this.ensureFreshToken(credentials);

    const params = new URLSearchParams({
      pageSize: String(options.pageSize || 100),
      fields: options.fields || 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, owners, webViewLink, description, fullFileExtension)',
    });

    if (options.pageToken) {
      params.set('pageToken', options.pageToken);
    }

    if (options.query) {
      params.set('q', options.query);
    }

    if (options.orderBy) {
      params.set('orderBy', options.orderBy);
    }

    const response = await fetch(`${this.apiUrl}/files?${params}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Google Drive API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get file metadata
   */
  async getFile(credentials: GoogleDriveCredentials, fileId: string): Promise<DriveFile> {
    const accessToken = await this.ensureFreshToken(credentials);

    const params = new URLSearchParams({
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, owners, webViewLink, description, fullFileExtension',
    });

    const response = await fetch(`${this.apiUrl}/files/${fileId}?${params}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Google Drive API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Export Google Workspace document as text/plain
   * Works for: Docs, Sheets, Slides, Drawings
   */
  async exportDocument(credentials: GoogleDriveCredentials, fileId: string): Promise<string> {
    const accessToken = await this.ensureFreshToken(credentials);

    const response = await fetch(
      `${this.apiUrl}/files/${fileId}/export?mimeType=text/plain`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Google Drive export error: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  /**
   * Download file content (for non-Google Workspace files)
   */
  async downloadFile(credentials: GoogleDriveCredentials, fileId: string): Promise<ArrayBuffer> {
    const accessToken = await this.ensureFreshToken(credentials);

    const response = await fetch(`${this.apiUrl}/files/${fileId}?alt=media`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Google Drive download error: ${response.status} ${response.statusText}`);
    }

    return response.arrayBuffer();
  }

  /**
   * Extract text content from a file (auto-detects export vs download)
   */
  async extractContent(
    credentials: GoogleDriveCredentials,
    fileId: string,
    mimeType: string
  ): Promise<string | null> {
    try {
      // Google Workspace files (export as text/plain)
      if (this.isGoogleWorkspaceFile(mimeType)) {
        return await this.exportDocument(credentials, fileId);
      }

      // Plain text files (download directly)
      if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
        const buffer = await this.downloadFile(credentials, fileId);
        return new TextDecoder().decode(buffer);
      }

      // PDFs, images, other binaries - not supported for text extraction yet
      console.log(`[Google Drive] Content extraction not supported for mimeType: ${mimeType}`);
      return null;
    } catch (error) {
      console.error(`[Google Drive] Error extracting content from ${fileId}:`, error);
      return null;
    }
  }

  /**
   * Check if file is a Google Workspace document
   */
  private isGoogleWorkspaceFile(mimeType: string): boolean {
    return mimeType.startsWith('application/vnd.google-apps.');
  }

  /**
   * Get storage quota information
   */
  async getStorageQuota(credentials: GoogleDriveCredentials): Promise<{
    limit: string;
    usage: string;
    usageInDrive: string;
  } | null> {
    try {
      const accessToken = await this.ensureFreshToken(credentials);
      const response = await fetch(`${this.apiUrl}/about?fields=storageQuota`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.storageQuota || null;
    } catch (error) {
      console.error('[Google Drive] Error fetching storage quota:', error);
      return null;
    }
  }
}
