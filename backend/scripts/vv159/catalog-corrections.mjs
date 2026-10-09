// Dry run by default. DATABASE_URL selects the target; no catalog import is performed.
import 'dotenv/config';
import postgres from 'postgres';
import {readFile, writeFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const restore = args.includes('--restore');
const backup = args.find(a => a.startsWith('--backup='))?.slice(9);
if (args.some(a => !['--apply', '--restore'].includes(a) && !a.startsWith('--backup='))) throw new Error('Unknown argument');
if (restore && apply) throw new Error('Choose --apply or --restore');
if ((apply || restore) && !backup) throw new Error('--backup=/absolute/path.json is required');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const patches = JSON.parse(await readFile(new URL('./catalog-corrections.json', import.meta.url), 'utf8'));
const sql = postgres(process.env.DATABASE_URL, {max: 1});
const columns = ['name', 'description', 'category_id', 'species'];
const pick = row => Object.fromEntries(columns.map(key => [key, row[key]]));
try {
  await sql.begin(async tx => {
    if (restore) {
      const saved = JSON.parse(await readFile(backup, 'utf8'));
      if (saved.version !== 1 || saved.issue !== 'VV-159') throw new Error('Invalid backup');
      for (const item of saved.rows) {
        const [row] = await tx`select * from products where id = ${item.id} for update`;
        if (!row || row.slug !== item.slug || !isDeepStrictEqual(pick(row), item.after)) throw new Error(`Restore conflict: ${item.slug}`);
        await tx`update products set name=${tx.json(item.before.name)}, description=${tx.json(item.before.description)}, category_id=${item.before.category_id}, species=${item.before.species}, updated_at=now() where id=${item.id}`;
      }
      console.log(`Restored ${saved.rows.length} products`);
      return;
    }
    const rows = [];
    for (const patch of patches) {
      const [row] = await tx`select * from products where id = ${patch.id} for update`;
      if (!row || row.slug !== patch.slug) throw new Error(`Missing product: ${patch.slug}`);
      const after = {...pick(row), ...patch.after};
      if (isDeepStrictEqual(pick(row), after)) continue; // Safe repeat after a successful apply.
      const before = patch.before;
      if (!Object.values(row.name).every(n => n.toLowerCase().trim() === before.displayName.toLowerCase().trim()) ||
          !isDeepStrictEqual(row.description, before.description) || row.image_url !== before.image_url ||
          row.color !== before.color || row.category_id !== before.category_id || (before.species && row.species !== before.species)) throw new Error(`Catalog changed since audit: ${patch.slug}`);
      rows.push({id: row.id, slug: row.slug, before: pick(row), after});
    }
    if (!apply) {
      console.log(JSON.stringify({dryRun: true, count: rows.length, changes: rows.map(r => ({slug: r.slug, before: r.before.name, after: r.after.name}))}, null, 2));
      return;
    }
    if (rows.length === 0) { console.log('Already applied'); return; }
    // Persist exact DB values before modifying anything. Never overwrite a prior backup.
    await writeFile(backup, JSON.stringify({version: 1, issue: 'VV-159', createdAt: new Date().toISOString(), rows}, null, 2), {flag: 'wx', mode: 0o600});
    for (const row of rows) {
      await tx`update products set name=${tx.json(row.after.name)}, description=${tx.json(row.after.description)}, category_id=${row.after.category_id}, species=${row.after.species}, updated_at=now() where id=${row.id}`;
    }
    console.log(`Applied ${rows.length} products; backup: ${backup}`);
  });
} finally {
  await sql.end();
}
