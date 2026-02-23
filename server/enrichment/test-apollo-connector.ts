/**
 * Test script for Apollo enrichment connector
 *
 * Run with: npx tsx server/enrichment/test-apollo-connector.ts
 */

import { calculateConfidenceScore, type EnrichedAccountData } from './confidence-scorer.js';
import { normalizeApolloOrganization } from './apollo-normalizer.js';
import { ApolloClient } from './apollo-client.js';

console.log('🧪 Testing Apollo Enrichment Connector\n');

// Test 1: Confidence Scoring
console.log('Test 1: Confidence Scoring');
console.log('─'.repeat(50));

const testData: EnrichedAccountData = {
  domain: 'anthropic.com',
  company_name: 'Anthropic',
  industry: 'Artificial Intelligence',
  employee_count: 500,
  employee_range: '201-500',
  revenue_range: '$50M-$100M',
  funding_stage: 'Series C',
  hq_country: 'United States',
  hq_state: 'California',
  hq_city: 'San Francisco',
  tech_stack: ['Python', 'AWS', 'TypeScript'],
  growth_signal: 'rapid_growth',
  founded_year: 2021,
  public_or_private: 'private',
};

const score = calculateConfidenceScore(testData);
console.log(`Sample Company: ${testData.company_name}`);
console.log(`Confidence Score: ${score.toFixed(2)}`);
console.log(`Expected: High (0.9-1.0)`);
console.log(`✅ Pass: ${score >= 0.9 ? 'Yes' : 'No'}\n`);

// Test 2: Apollo Normalizer
console.log('Test 2: Apollo Normalizer');
console.log('─'.repeat(50));

const mockApolloResponse = {
  id: '12345',
  name: 'Anthropic',
  primary_domain: 'anthropic.com',
  website_url: 'https://anthropic.com',
  industry: 'Computer Software',
  estimated_num_employees: 500,
  annual_revenue_printed: '$50M-$100M',
  funding_total_usd: 75000000,
  publicly_traded_symbol: null,
  country: 'United States',
  state: 'California',
  city: 'San Francisco',
  founded_year: 2021,
  technology_names: ['Python', 'AWS', 'TypeScript'],
};

const normalized = normalizeApolloOrganization(mockApolloResponse);
console.log('Normalized Data:');
console.log(JSON.stringify(normalized, null, 2));
console.log(`✅ Pass: Domain extracted correctly: ${normalized.domain === 'anthropic.com'}`);
console.log(`✅ Pass: Employee range derived: ${normalized.employee_range === '501-1000'}`);
console.log(`✅ Pass: Revenue range derived: ${normalized.revenue_range === '$50M-$100M'}`);
console.log(`✅ Pass: Funding stage derived: ${normalized.funding_stage === 'Series C'}`);
console.log(`✅ Pass: Tech stack preserved: ${JSON.stringify(normalized.tech_stack) === JSON.stringify(['Python', 'AWS', 'TypeScript'])}\n`);

// Test 3: Apollo API Client (requires API key)
console.log('Test 3: Apollo API Client');
console.log('─'.repeat(50));

const apiKey = process.env.APOLLO_API_KEY;

if (apiKey) {
  console.log('Apollo API Key found in environment');

  try {
    const client = new ApolloClient(apiKey);
    console.log('Testing API connection with domain: anthropic.com...');

    const response = await client.enrichOrganization('anthropic.com');

    if (response.organization) {
      console.log('✅ API call successful');
      console.log(`Company: ${response.organization.name}`);
      console.log(`Domain: ${response.organization.primary_domain || 'N/A'}`);
      console.log(`Employees: ${response.organization.estimated_num_employees || 'N/A'}`);
    } else {
      console.log('⚠️  No organization data returned');
    }
  } catch (error) {
    console.log(`❌ API call failed: ${error instanceof Error ? error.message : String(error)}`);
  }
} else {
  console.log('⚠️  APOLLO_API_KEY not set in environment');
  console.log('   To test API connectivity, set APOLLO_API_KEY in .env');
}

console.log('\n' + '═'.repeat(50));
console.log('🎉 Apollo Connector Tests Complete');
console.log('═'.repeat(50));
