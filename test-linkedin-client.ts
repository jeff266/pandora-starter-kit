/**
 * Test script for LinkedIn client
 *
 * Usage: RAPIDAPI_KEY=your_key tsx test-linkedin-client.ts
 */

import { getLinkedInClient } from './server/connectors/linkedin/client.js';

async function testLinkedInClient() {
  console.log('=== LinkedIn Client Test ===\n');

  const client = getLinkedInClient();

  // Check configuration
  if (!client.isConfigured()) {
    console.error('❌ RAPIDAPI_KEY not configured');
    console.log('Set RAPIDAPI_KEY environment variable in Replit Secrets');
    process.exit(1);
  }

  console.log('✅ API key configured\n');

  // Test with the sample profile from the user's example
  const testUrl = 'https://www.linkedin.com/in/cjfollini/';
  console.log(`Testing with profile: ${testUrl}`);

  try {
    const profile = await client.getProfileByUrl(testUrl);

    if (!profile) {
      console.error('❌ No profile data returned');
      process.exit(1);
    }

    console.log('\n✅ Profile fetched successfully!\n');
    console.log('Profile Data:');
    console.log('─────────────');
    console.log(`Name: ${profile.full_name}`);
    console.log(`Current Title: ${profile.job_title}`);
    console.log(`Current Company: ${profile.company}`);
    console.log(`Duration at Company: ${profile.current_job_duration}`);
    console.log(`Location: ${profile.location}`);
    console.log(`Headline: ${profile.headline}`);
    console.log(`\nExperience Count: ${profile.experiences?.length || 0}`);
    console.log(`Education Count: ${profile.educations?.length || 0}`);

    if (profile.experiences && profile.experiences.length > 0) {
      console.log('\nCurrent Experience:');
      const currentExp = profile.experiences.find((e) => e.is_current);
      if (currentExp) {
        console.log(`  - ${currentExp.title} at ${currentExp.company}`);
        console.log(`  - Started: ${currentExp.start_year}/${currentExp.start_month || '??'}`);
        console.log(`  - Duration: ${currentExp.duration}`);
      }
    }

    console.log('\n✅ LinkedIn API test completed successfully!');
    console.log('\n📋 Next Steps:');
    console.log('1. Ensure contacts have linkedin_url field populated');
    console.log('2. Test role filtering: Default checks only critical roles (champion, economic_buyer, decision_maker)');
    console.log('3. Use check_all_roles=true to check all contacts');
    console.log('\nRole Filtering Benefits:');
    console.log('• 40-60% cost reduction');
    console.log('• Focus on decision makers');
    console.log('• Better signal quality');
  } catch (error: any) {
    console.error('\n❌ Error fetching profile:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testLinkedInClient().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
