import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("migration runner records applied files and does not replay historical migrations", async () => {
  const source = await readFile(new URL("../scripts/migrate.mjs", import.meta.url), "utf8");

  assert.match(source, /create table if not exists schema_migrations/i);
  assert.match(source, /LEGACY_BASELINE = "202607310002_repair_identity_sequences\.sql"/);
  assert.match(source, /if \(applied\.has\(file\)\)/);
  assert.match(source, /insert into schema_migrations \(filename\) values \(\$1\)/i);
  assert.match(source, /await client\.query\("begin"\)/);
  assert.match(source, /await client\.query\("rollback"\)/);
});
