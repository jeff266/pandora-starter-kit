/**
 * LinkedIn Profile Data Client (via RapidAPI Fresh LinkedIn Profile Data)
 *
 * Fetches current LinkedIn profile information to detect:
 * - Role changes
 * - Company departures
 * - Title changes
 * - Employment status
 */

interface LinkedInProfileData {
  first_name: string;
  last_name: string;
  full_name: string;
  headline: string;
  about: string;
  current_job_duration: string;
  company: string;
  company_linkedin_url: string;
  job_title: string;
  location: string;
  city: string;
  state: string;
  country: string;
  current_company_join_year: number | null;
  current_company_join_month: number | null;
  experiences: Array<{
    title: string;
    company: string;
    company_id: string;
    company_linkedin_url: string;
    is_current: boolean;
    start_year: number;
    start_month: number | null;
    end_year: number | null;
    end_month: number | null;
    duration: string;
    location: string;
    description: string;
  }>;
  educations: Array<{
    school: string;
    degree: string;
    field_of_study: string;
    start_year: number | null;
    end_year: number | null;
  }>;
  profile_image_url: string;
  linkedin_url: string;
  public_id: string;
  is_verified: boolean;
  is_premium: boolean;
}

interface LinkedInAPIResponse {
  data: LinkedInProfileData;
  message: string;
}

export class LinkedInClient {
  private apiKey: string;
  private baseUrl = 'https://fresh-linkedin-profile-data.p.rapidapi.com';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.RAPIDAPI_KEY || '';
    if (!this.apiKey) {
      console.warn('[LinkedInClient] No RAPIDAPI_KEY found in environment');
    }
  }

  /**
   * Get LinkedIn profile data by profile URL
   * @param linkedinUrl - Full LinkedIn profile URL (e.g., https://www.linkedin.com/in/username/)
   */
  async getProfileByUrl(linkedinUrl: string): Promise<LinkedInProfileData | null> {
    if (!this.apiKey) {
      throw new Error('RAPIDAPI_KEY not configured');
    }

    try {
      // Extract public_id from URL
      const publicId = this.extractPublicId(linkedinUrl);
      if (!publicId) {
        console.error('[LinkedInClient] Invalid LinkedIn URL format:', linkedinUrl);
        return null;
      }

      return await this.getProfileByPublicId(publicId);
    } catch (error: any) {
      console.error('[LinkedInClient] Error fetching profile by URL:', error.message);
      return null;
    }
  }

  /**
   * Get LinkedIn profile data by public ID (username)
   * @param publicId - LinkedIn username (e.g., "cjfollini")
   */
  async getProfileByPublicId(publicId: string): Promise<LinkedInProfileData | null> {
    if (!this.apiKey) {
      throw new Error('RAPIDAPI_KEY not configured');
    }

    try {
      // Construct URL with query parameter
      // Based on RapidAPI Fresh LinkedIn Profile Data API - parameter is "linkedin_url"
      const linkedinUrl = `https://www.linkedin.com/in/${publicId}/`;
      const url = `${this.baseUrl}/get-linkedin-profile?linkedin_url=${encodeURIComponent(linkedinUrl)}`;

      console.log(`[LinkedInClient] Fetching profile for: ${publicId}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': 'fresh-linkedin-profile-data.p.rapidapi.com',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[LinkedInClient] API error (${response.status}):`, errorText);

        if (response.status === 401) {
          throw new Error('Invalid RapidAPI key');
        }
        if (response.status === 429) {
          throw new Error('Rate limit exceeded');
        }
        if (response.status === 404) {
          console.warn(`[LinkedInClient] Profile not found: ${publicId}`);
          return null;
        }

        throw new Error(`LinkedIn API error: ${response.status}`);
      }

      const result: LinkedInAPIResponse = await response.json() as unknown as LinkedInAPIResponse;

      if (result.message !== 'ok' && result.message !== 'success') {
        console.warn(`[LinkedInClient] Unexpected API message: ${result.message}`);
      }

      return result.data;
    } catch (error: any) {
      console.error('[LinkedInClient] Error fetching profile:', error.message);
      throw error;
    }
  }

  /**
   * Extract public_id (username) from LinkedIn URL
   */
  private extractPublicId(url: string): string | null {
    try {
      // Handle various LinkedIn URL formats:
      // https://www.linkedin.com/in/username/
      // https://linkedin.com/in/username
      // linkedin.com/in/username
      const match = url.match(/linkedin\.com\/in\/([^\/\?]+)/i);
      return match ? match[1] : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if API key is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }
}

// Singleton instance
let linkedInClient: LinkedInClient | null = null;

export function getLinkedInClient(): LinkedInClient {
  if (!linkedInClient) {
    linkedInClient = new LinkedInClient();
  }
  return linkedInClient;
}
