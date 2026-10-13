import path from 'node:path';

/**
 * Decides where the database and uploaded images live.
 *
 * On Railway the container's own disk is wiped on every deploy; only a mounted volume survives.
 * So there, we refuse to start unless the data folder is inside the volume, rather than quietly
 * saving users' cards somewhere that will vanish on the next redeploy.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv, projectRoot: string): string {
  const volume = env.RAILWAY_VOLUME_MOUNT_PATH;
  const onRailway = Boolean(env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID);
  const dir = path.resolve(env.DATA_DIR ?? volume ?? path.join(projectRoot, 'data'));

  if (onRailway && env.ALLOW_EPHEMERAL_DATA !== '1') {
    if (!volume) {
      throw new Error(
        'Refusing to start: this is running on Railway but no Volume is attached, so all accounts and cards ' +
          'would be deleted on the next deploy. In Railway add a Volume to this service (mount path /data), ' +
          'then redeploy. (Set ALLOW_EPHEMERAL_DATA=1 only if you really want throwaway data.)',
      );
    }
    const rel = path.relative(path.resolve(volume), dir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(
        `Refusing to start: the data folder (${dir}) is outside the Railway Volume (${volume}), so it would be ` +
          `wiped on the next deploy. Set DATA_DIR to ${volume} (or remove DATA_DIR), then redeploy.`,
      );
    }
  }
  return dir;
}
