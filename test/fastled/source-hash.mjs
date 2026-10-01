import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

/** Content, not mtimes: changed include files must invalidate native objects. */
export async function hashTree(root) {
  const paths = [];
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), `${relative}/`);
      else if (entry.isFile()) paths.push(relative);
    }
  }
  await visit(root);
  paths.sort();
  const files = new Array(paths.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= paths.length) return;
      const content = await readFile(path.join(root, paths[index]));
      files[index] = { path: paths[index], sha256: createHash('sha256').update(content).digest('hex') };
    }
  }));
  const sha256 = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  return { sha256, files };
}
