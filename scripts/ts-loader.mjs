import { access } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function existingUrl(candidate) {
  const pathname = fileURLToPath(candidate);
  try {
    await access(pathname);
    return candidate;
  } catch {
    return null;
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = path.join(repoRoot, specifier.slice(2));
    for (const suffix of ['', '.ts', '.tsx', '.js', '.mjs']) {
      const found = await existingUrl(pathToFileURL(`${base}${suffix}`));
      if (found) return { url: found.href, shortCircuit: true };
    }
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    try {
      return await nextResolve(specifier, context);
    } catch (error) {
      const parentPath = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : repoRoot;
      const base = path.resolve(parentPath, specifier);
      for (const suffix of ['.ts', '.tsx', '.js', '.mjs']) {
        const found = await existingUrl(pathToFileURL(`${base}${suffix}`));
        if (found) return { url: found.href, shortCircuit: true };
      }
      throw error;
    }
  }

  return nextResolve(specifier, context);
}
