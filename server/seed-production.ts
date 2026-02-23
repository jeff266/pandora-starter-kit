import { query } from './db.js';

export async function seedProductionData(): Promise<void> {
  const usersResult = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM users');
  if (usersResult.rows[0].count > 0) {
    return;
  }

  console.log('[ProductionSeed] No users found, seeding essential data...');

  await query(`
    INSERT INTO users (id, email, name, account_type, password_hash, created_at)
    VALUES 
      ('d6139815-981e-44b4-93c2-441173e4833c', 'jeff@pandora-revops.com', 'Jeff Chen', 'standard', NULL, '2026-02-15 06:07:16.464608+00'),
      ('aa5551b7-545a-44d2-a4e3-76d368d20c9d', 'jeff@revopsimpact.us', 'Jeff Ignacio', 'multi_workspace', '$2b$12$lT6zmc6fEAZc8.6CpDSQiOnxkFR6IYh4QlsCigoMpwj6rYk2nG/SK', '2026-02-15 08:38:41.958162+00')
    ON CONFLICT (id) DO NOTHING
  `);

  const workspaces = [
    { id: '43bf45e5-8094-483f-b790-a8d88dbf46dd', name: 'Multi-Tenant Test Workspace', slug: 'mt-test' },
    { id: 'f9667305-c194-4fdf-8731-80f6eaea2543', name: 'Growthbook', slug: 'growthbook' },
    { id: '11111111-1111-1111-1111-111111111111', name: 'HubSpot Test Workspace', slug: 'hubspot-test' },
    { id: '31551fe0-b746-4384-aab2-d5cdd70b19ed', name: 'Imubit', slug: 'imubit' },
    { id: '4160191d-73bc-414b-97dd-5a1853190378', name: 'Frontera Health', slug: 'frontera-health' },
    { id: 'b5318340-37f0-4815-9a42-d6644b01a298', name: 'Render', slug: 'render' },
  ];

  for (const ws of workspaces) {
    await query(
      `INSERT INTO workspaces (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [ws.id, ws.name, ws.slug]
    );
  }

  const userIds = [
    'd6139815-981e-44b4-93c2-441173e4833c',
    'aa5551b7-545a-44d2-a4e3-76d368d20c9d',
  ];

  for (const userId of userIds) {
    for (const ws of workspaces) {
      await query(
        `INSERT INTO user_workspaces (user_id, workspace_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`,
        [userId, ws.id]
      );
    }
  }

  console.log('[ProductionSeed] Seeded 2 users, 6 workspaces, 12 memberships');
}
