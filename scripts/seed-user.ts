import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function seedUser() {
  const email = process.argv[2] || 'jeff@pandora-revops.com';
  const name = process.argv[3] || 'Jeff Chen';

  console.log(`[seed] Creating/updating user: ${name} <${email}>`);

  const user = await pool.query(`
    INSERT INTO users (email, name, role)
    VALUES ($1, $2, 'admin')
    ON CONFLICT (email) DO UPDATE SET name = $2, role = 'admin'
    RETURNING id
  `, [email, name]);

  const userId = user.rows[0].id;
  console.log(`[seed] User ID: ${userId}`);

  const workspaces = await pool.query('SELECT id, name FROM workspaces');
  for (const ws of workspaces.rows) {
    await pool.query(`
      INSERT INTO user_workspaces (user_id, workspace_id, role)
      VALUES ($1, $2, 'admin')
      ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = 'admin'
    `, [userId, ws.id]);
    console.log(`[seed] Linked: ${ws.name} (admin)`);
  }

  console.log(`\n[seed] Done. Log in at the app with ${email}`);
  await pool.end();
}

seedUser().catch(err => {
  console.error('[seed] Error:', err);
  process.exit(1);
});
