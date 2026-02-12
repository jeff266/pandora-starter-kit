/**
 * Config API Test Script
 *
 * Run with: node --loader ts-node/esm server/config/test-config-api.ts <workspace_id>
 *
 * Tests all workspace configuration endpoints
 */

import {
  getWorkspaceConfig,
  updateWorkspaceConfig,
  setStageMapping,
  setDepartmentPatterns,
  setRoleFieldMappings,
  setGradeThresholds,
  ConfigValidationError,
} from './workspace-config.js';

const WORKSPACE_ID = process.argv[2];

if (!WORKSPACE_ID) {
  console.error('Usage: node --loader ts-node/esm server/config/test-config-api.ts <workspace_id>');
  process.exit(1);
}

async function runTests() {
  console.log('=== Workspace Configuration API Tests ===\n');
  console.log(`Testing workspace: ${WORKSPACE_ID}\n`);

  try {
    // Test 1: Get current config
    console.log('Test 1: Get current configuration');
    const currentConfig = await getWorkspaceConfig(WORKSPACE_ID);
    console.log('✅ Current config:', JSON.stringify(currentConfig, null, 2));
    console.log('');

    // Test 2: Set stage mapping
    console.log('Test 2: Set stage mapping');
    try {
      await setStageMapping(WORKSPACE_ID, {
        'Pilot Program': 'evaluation',
        'Final Review': 'decision',
        'Verbal Commitment': 'negotiation',
        'Closed Won - Partnership': 'closed_won',
      }, 'test-script');
      console.log('✅ Stage mapping set successfully');
    } catch (error) {
      console.error('❌ Stage mapping failed:', error);
    }
    console.log('');

    // Test 3: Set department patterns
    console.log('Test 3: Set department patterns');
    try {
      await setDepartmentPatterns(WORKSPACE_ID, {
        clinical: ['clinical', 'medical director', 'physician', 'doctor'],
        regulatory: ['regulatory affairs', 'compliance', 'qa', 'quality'],
      }, 'test-script');
      console.log('✅ Department patterns set successfully');
    } catch (error) {
      console.error('❌ Department patterns failed:', error);
    }
    console.log('');

    // Test 4: Set role field mappings
    console.log('Test 4: Set role field mappings');
    try {
      await setRoleFieldMappings(WORKSPACE_ID, {
        'Primary_Contact__c': 'champion',
        'Budget_Owner__c': 'economic_buyer',
        'Technical_Lead__c': 'technical_evaluator',
        'Decision_Maker__c': 'decision_maker',
      }, 'test-script');
      console.log('✅ Role field mappings set successfully');
    } catch (error) {
      console.error('❌ Role field mappings failed:', error);
    }
    console.log('');

    // Test 5: Set grade thresholds
    console.log('Test 5: Set grade thresholds');
    try {
      await setGradeThresholds(WORKSPACE_ID, {
        A: 90,
        B: 75,
        C: 55,
        D: 35,
        F: 0,
      }, 'test-script');
      console.log('✅ Grade thresholds set successfully');
    } catch (error) {
      console.error('❌ Grade thresholds failed:', error);
    }
    console.log('');

    // Test 6: Get updated config
    console.log('Test 6: Get updated configuration');
    const updatedConfig = await getWorkspaceConfig(WORKSPACE_ID);
    console.log('✅ Updated config:', JSON.stringify(updatedConfig, null, 2));
    console.log('');

    // Test 7: Validation error test (invalid stage)
    console.log('Test 7: Validation error handling (should fail)');
    try {
      await setStageMapping(WORKSPACE_ID, {
        'Custom Stage': 'invalid_stage' as any,
      }, 'test-script');
      console.error('❌ Validation should have failed but did not');
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        console.log('✅ Validation correctly rejected invalid stage');
        console.log(`   Error: ${error.message}`);
      } else {
        console.error('❌ Unexpected error:', error);
      }
    }
    console.log('');

    // Test 8: Validation error test (invalid grade thresholds)
    console.log('Test 8: Validation error handling for grade order (should fail)');
    try {
      await setGradeThresholds(WORKSPACE_ID, {
        A: 50,  // A should be > B
        B: 75,
        C: 60,
        D: 30,
        F: 0,
      }, 'test-script');
      console.error('❌ Validation should have failed but did not');
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        console.log('✅ Validation correctly rejected invalid grade order');
        console.log(`   Error: ${error.message}`);
      } else {
        console.error('❌ Unexpected error:', error);
      }
    }
    console.log('');

    console.log('=== All Tests Complete ===');
    process.exit(0);
  } catch (error) {
    console.error('Fatal error during tests:', error);
    process.exit(1);
  }
}

runTests();
