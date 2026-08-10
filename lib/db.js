import{neon as e}from"@neondatabase/serverless";const a=process.env.POSTGRES_URL||process.env.POSTGRES_PRISMA_URL||process.env.DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||process.env.POSTGRES_URL_NON_POOLING;if(!a)throw new Error("No Postgres connection string found in env (checked POSTGRES_URL, POSTGRES_PRISMA_URL, DATABASE_URL, DATABASE_URL_UNPOOLED, POSTGRES_URL_NON_POOLING).");const s=e(a);export async function ensureSchema(){await(s`
CREATE TABLE IF NOT EXISTS users (
id SERIAL PRIMARY KEY,
name TEXT NOT NULL,
email TEXT UNIQUE NOT NULL,
password_hash TEXT NOT NULL,
role TEXT NOT NULL,
must_change_password BOOLEAN NOT NULL DEFAULT true,
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`),await(s`
CREATE TABLE IF NOT EXISTS modules (
name TEXT PRIMARY KEY,
data JSONB NOT NULL,
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`)}export async function getUserByEmail(e){const t=(await(s`SELECT * FROM users WHERE email = ${e} LIMIT 1;`))[0];return t&&t.role?{...t,role:t.role.replace(/\p{C}/gu,"").trim()}:t||null}export async function getModule(e){const a=await(s`SELECT data FROM modules WHERE name = ${e} LIMIT 1;`);return a[0]?a[0].data:null}export async function setModule(e,a){await(s`
INSERT INTO modules (name, data, updated_at)
VALUES (${e}, ${JSON.stringify(a)}::jsonb, now())
ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = now();
`)}export async function upsertUser({name:e,email:a,passwordHash:n,role:t}){await(s`
INSERT INTO users (name, email, password_hash, role)
VALUES (${e}, ${a}, ${n}, ${t})
ON CONFLICT (email) DO NOTHING;
`)}export async function updatePassword(e,a){await(s`UPDATE users SET password_hash = ${a}, must_change_password = false WHERE id = ${e};`)}export async function resetUserPassword(e,a){await(s`UPDATE users SET password_hash = ${a}, must_change_password = true WHERE id = ${e};`)}export async function listUsers(){return s`SELECT id, name, email, role, must_change_password, created_at FROM users ORDER BY created_at ASC;`}export async function createUser({name:e,email:a,passwordHash:n,role:t}){return(await(s`
INSERT INTO users (name, email, password_hash, role)
VALUES (${e}, ${a}, ${n}, ${t})
ON CONFLICT (email) DO NOTHING
RETURNING id, name, email, role, must_change_password, created_at;
`))[0]||null}export async function updateUserRole(e,a){await(s`UPDATE users SET role = ${a} WHERE id = ${e};`)}export async function updateUserName(e,a){await(s`UPDATE users SET name = ${a} WHERE id = ${e};`)}export async function updateUserEmail(e,a){await(s`UPDATE users SET email = ${a} WHERE id = ${e};`)}export async function deleteUser(e){await(s`DELETE FROM users WHERE id = ${e};`)}export async function renameUserRole(e,a){return(await(s`UPDATE users SET role = ${a} WHERE role = ${e} RETURNING id;`)).length}
