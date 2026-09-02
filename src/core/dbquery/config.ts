/**
 * Config loader for the db-query subsystem.
 *
 * Spec §2.2 — three-tier load order (first wins for path source):
 *   1. CGRAPHX_DB_PROFILES_PATH env var (custom file path; ONLY this file)
 *   2. <projectRoot>/.cgraphx/db-profiles.json (project-local)
 *   3. ~/.cgraphx/db-profiles.json (user-global)
 *
 * Merge semantics:
 *   - same-name profile: project-local overrides user-global
 *   - different-name profiles: union
 *   - `default` field: project-local wins
 *
 * Spec §2.5 — subsystem disable switch (OR semantics, any source disables):
 *   1. CGRAPHX_DB_QUERY_DISABLED env var (highest priority)
 *   2. project-local top-level `enabled: false`
 *   3. user-global top-level `enabled: false`
 *
 * Errors are NOT thrown for missing config / bad JSON / missing fields — the
 * caller (executor / MCP / CLI) gets back a result with status, then converts
 * to success-shaped response (spec §6.2). We only throw for genuinely
 * unexpected filesystem errors (permission denied mid-read of a real file).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  PROFILES_FILENAME,
  PROFILES_PATH_ENV,
  DISABLED_ENV,
} from './constants';
import {
  type DBProfile,
  type DriverKind,
  type ProfilesConfig,
  type ProfilesFile,
  type ProfileEntry,
  type ConfigSource,
} from './types';
import { ConfigNotFoundError } from './errors';

const VALID_DRIVERS: ReadonlySet<DriverKind> = new Set(['mysql', 'postgres', 'http']);

interface LoadedFile {
  source: ConfigSource;
  path: string;
  existed: boolean; // true if the file exists on disk (regardless of parse success)
  data: ProfilesFile | null; // null = missing or unparsable
  error?: { message: string; detail: string };
}

function readConfigFile(filePath: string): { existed: boolean; data: ProfilesFile | null; error?: { message: string; detail: string } } {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { existed: false, data: null };
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { existed: true, data: null, error: { message: 'invalid config shape (expected object)', detail: filePath } };
    }
    return { existed: true, data: parsed as ProfilesFile };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { existed: true, data: null, error: { message: 'JSON parse failed', detail: msg } };
  }
}

function userGlobalConfigPath(): string {
  return path.join(os.homedir(), '.cgraphx', PROFILES_FILENAME);
}

function projectLocalConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.cgraphx', PROFILES_FILENAME);
}

function envConfigPath(): string | null {
  const v = process.env[PROFILES_PATH_ENV];
  return v && v.trim() ? v : null;
}

function envDisabled(): boolean {
  const v = process.env[DISABLED_ENV];
  return !!v && v.trim() !== '' && v.trim() !== '0' && v.trim().toLowerCase() !== 'false';
}

function normalizeProfileEntry(
  name: string,
  raw: ProfileEntry,
  sourcePath: string,
): { profile: DBProfile | null; error: string | null } {
  if (!raw || typeof raw !== 'object') {
    return { profile: null, error: `profile "${name}" is not an object (${sourcePath})` };
  }
  const { type, host, port, user, password, database, schema, description, url, headers } = raw;

  if (!type || !VALID_DRIVERS.has(type)) {
    return { profile: null, error: `profile "${name}": type must be 'mysql', 'postgres', or 'http' (got: ${String(type)})` };
  }

  // HTTP driver — requires url; host/user/password/database unused.
  if (type === 'http') {
    if (typeof url !== 'string' || !url) {
      return { profile: null, error: `profile "${name}": missing required field "url" for type=http` };
    }
    let normalizedHeaders: Record<string, string> | undefined;
    if (headers !== undefined) {
      if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) {
        return { profile: null, error: `profile "${name}": "headers" must be an object for type=http` };
      }
      normalizedHeaders = {};
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v !== 'string') {
          return { profile: null, error: `profile "${name}": header "${k}" must be a string` };
        }
        normalizedHeaders[k] = v;
      }
    }
    return {
      profile: {
        name,
        description: typeof description === 'string' ? description : undefined,
        type,
        host: '',
        port: 0,
        user: '',
        password: '',
        database: '',
        url,
        headers: normalizedHeaders,
        schema,
      },
      error: null,
    };
  }

  // mysql / postgres — require host/user/password/database.
  if (typeof host !== 'string' || !host) {
    return { profile: null, error: `profile "${name}": missing required field "host"` };
  }
  if (typeof user !== 'string' || !user) {
    return { profile: null, error: `profile "${name}": missing required field "user"` };
  }
  if (typeof password !== 'string') {
    return { profile: null, error: `profile "${name}": missing required field "password"` };
  }
  if (typeof database !== 'string' || !database) {
    return { profile: null, error: `profile "${name}": missing required field "database"` };
  }

  const defaultPort = type === 'mysql' ? 3306 : 5432;
  return {
    profile: {
      name,
      description: typeof description === 'string' ? description : undefined,
      type,
      host,
      port: typeof port === 'number' && port > 0 ? port : defaultPort,
      user,
      password,
      database,
      schema: type === 'postgres' ? (schema ?? 'public') : undefined,
    },
    error: null,
  };
}

/**
 * Load and merge profiles config per spec §2.2-§2.5.
 *
 * Never throws for expected conditions (file missing / bad JSON / missing
 * fields); returns a ConfigNotFoundError in those cases. Only throws for
 * unexpected filesystem errors (e.g. permission denied on an existing file).
 */
export function loadProfiles(projectRoot?: string): ProfilesConfig {
  // 1. Resolve which files to read.
  const envPath = envConfigPath();
  const filesToRead: Array<{ source: ConfigSource; path: string }> = [];
  if (envPath) {
    filesToRead.push({ source: 'env', path: envPath });
  } else {
    if (projectRoot) {
      filesToRead.push({ source: 'project-local', path: projectLocalConfigPath(projectRoot) });
    }
    filesToRead.push({ source: 'user-global', path: userGlobalConfigPath() });
  }

  // 2. Read each.
  const loaded: LoadedFile[] = filesToRead.map(({ source, path: p }) => {
    const r = readConfigFile(p);
    return { source, path: p, existed: r.existed, data: r.data, error: r.error };
  });

  // 3. Compute disabled state (OR semantics across all sources).
  //    Spec §2.5: env disabled is highest priority; if env path is set,
  //    only that file's `enabled` flag is consulted (along with the env var).
  const disabled =
    envDisabled() ||
    loaded.some(f => f.data && f.data.enabled === false);

  // 4. Collect errors and merge profiles.
  const sources: ConfigSource[] = [];
  const errors: string[] = [];
  const mergedProfiles = new Map<string, DBProfile>();
  let defaultProfile: string | null = null;

  // Process in reverse priority order so higher-priority writes win.
  // Order in `loaded`: [env?, project-local?, user-global?].
  // We iterate from the end so project-local / env overwrite user-global.
  for (let i = loaded.length - 1; i >= 0; i--) {
    const f = loaded[i]!;
    if (!f.data) {
      if (f.error) {
        errors.push(`${f.path}: ${f.error.message} (${f.error.detail})`);
      }
      continue;
    }
    sources.push(f.source);
    if (typeof f.data.default === 'string' && f.data.default) {
      defaultProfile = f.data.default;
    }
    for (const [name, raw] of Object.entries(f.data)) {
      if (name === 'default' || name === 'enabled') continue;
      if (typeof raw !== 'object' || raw === null) continue;
      const { profile, error } = normalizeProfileEntry(name, raw as ProfileEntry, f.path);
      if (error) {
        errors.push(error);
        continue;
      }
      if (profile) {
        mergedProfiles.set(profile.name, profile);
      }
    }
  }

  // 5. No file on disk at all → ConfigNotFoundError (enabled still computed above).
  const hasAnyFile = loaded.some(f => f.existed);
  if (!hasAnyFile) {
    throw new ConfigNotFoundError(
      `No db-profiles.json found. Create .cgraphx/db-profiles.json in ` +
        `the project root, or ~/.cgraphx/db-profiles.json globally, or set ` +
        `the ${PROFILES_PATH_ENV} environment variable.`,
      { searchedPaths: loaded.map(f => f.path) },
    );
  }

  // 6. Field errors.
  if (errors.length > 0) {
    throw new ConfigNotFoundError(
      `db-profiles.json has errors: ${errors.join('; ')}`,
      { errors },
    );
  }

  // 7. Default points to nonexistent profile.
  const profileList = Array.from(mergedProfiles.values());
  if (defaultProfile && !mergedProfiles.has(defaultProfile)) {
    throw new ConfigNotFoundError(
      `Default profile "${defaultProfile}" does not exist. ` +
        `Available profiles: ${profileList.map(p => p.name).join(', ') || '(none)'}`,
      { defaultProfile, available: profileList.map(p => p.name) },
    );
  }

  return {
    profiles: profileList,
    defaultProfile,
    sources: Array.from(new Set(sources)).sort(),
    enabled: !disabled,
  };
}

/**
 * Resolve the actual profile to use given an optional name.
 * Throws ProfileNotFoundError when the name doesn't exist or no name + no default.
 */
export function resolveProfile(config: ProfilesConfig, requested?: string): DBProfile {
  const name = requested ?? config.defaultProfile;
  if (!name) {
    throw new ConfigNotFoundError(
      `No profile specified and no default configured. Available: ` +
        `${config.profiles.map(p => p.name).join(', ') || '(none)'}`,
    );
  }
  const found = config.profiles.find(p => p.name === name);
  if (!found) {
    throw new ConfigNotFoundError(
      `Profile "${name}" not found. Available: ${config.profiles.map(p => p.name).join(', ') || '(none)'}`,
      { requested: name },
    );
  }
  return found;
}
