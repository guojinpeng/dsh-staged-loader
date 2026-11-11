import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Last manifest the loader changed, kept beside the live file for recovery. */
export const BACKUP_FILE = 'package.json.staged-loader-backup';

/** Absolute path of the profile manifest. */
export function manifestFile(dir) {
	return join(dir, 'package.json');
}

/** Copy the current manifest before the loader rewrites the bundle list. */
export function backupManifest(dir) {
	try {
		copyFileSync(manifestFile(dir), join(dir, BACKUP_FILE));
	} catch {
		// A missing backup never blocks the write; the live file is still valid.
	}
}

/** Read the profile manifest as plain JSON. */
export function readManifest(dir) {
	return JSON.parse(readFileSync(manifestFile(dir), 'utf8'));
}

/** Read the bundle list the profile starts with, in file order. */
export function readBundles(dir) {
	const bundles = readManifest(dir)?.dsh?.profile?.bundles;
	return Array.isArray(bundles) ? bundles.filter((name) => typeof name === 'string') : [];
}

/**
 * Replace the bundle list and keep every other manifest field. The write goes
 * through a sibling temporary file, so a crash never leaves half a manifest.
 */
export function writeBundles(dir, bundles) {
	const file = manifestFile(dir);
	const manifest = readManifest(dir);
	const dsh = manifest?.dsh !== null && typeof manifest.dsh === 'object' ? manifest.dsh : {};
	manifest.dsh = { ...dsh, profile: { ...dsh.profile, bundles } };
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	renameSync(temporary, file);
}
