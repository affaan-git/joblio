'use strict';

const fsp = require('node:fs/promises');

const SUPPORTS_POSIX_PERMS = process.platform !== 'win32';

async function enforcePerms(filePath, mode, label) {
  try {
    await fsp.chmod(filePath, mode);
    return;
  } catch {}
  if (!SUPPORTS_POSIX_PERMS) return;
  try {
    const stat = await fsp.stat(filePath);
    const actual = stat.mode & 0o777;
    if (actual & 0o077) {
      const desc = label || 'data';
      throw new Error(`Could not restrict permissions on ${desc} file. It may be world-readable.`);
    }
  } catch (err) {
    if (err.message.includes('Could not restrict')) throw err;
  }
}

module.exports = { enforcePerms };
