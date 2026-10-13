import fs from 'node:fs';

/**
 * Loads KEY=value lines from a `.env` file into process.env (without overriding anything already set).
 * Keeps secrets such as ANTHROPIC_API_KEY out of the code and out of git (.env is git-ignored).
 */
export function loadDotEnv(file: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (!fs.existsSync(file)) return [];
  const loaded: string[] = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, ''); // trailing comment on an unquoted value
    if (env[m[1]] === undefined && value !== '') {
      env[m[1]] = value;
      loaded.push(m[1]);
    }
  }
  return loaded;
}
