import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readBundles, writeBundles } from '../src/manifest.js';

function profileWith(bundles) {
	const dir = mkdtempSync(join(tmpdir(), 'gdssl-manifest-'));
	writeFileSync(
		join(dir, 'package.json'),
		`${JSON.stringify({ name: 'desktop', dsh: { profile: { bundles }, keepMe: true } }, null, 2)}\n`,
	);
	return dir;
}

test('readBundles returns the bundle list in file order', () => {
	const dir = profileWith(['@deepseek-ai/dsh-base', 'dsh-ops']);
	assert.deepEqual(readBundles(dir), ['@deepseek-ai/dsh-base', 'dsh-ops']);
	rmSync(dir, { recursive: true, force: true });
});

test('readBundles ignores a missing or malformed list', () => {
	const dir = mkdtempSync(join(tmpdir(), 'gdssl-manifest-'));
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'desktop' }));
	assert.deepEqual(readBundles(dir), []);
	rmSync(dir, { recursive: true, force: true });
});

test('writeBundles replaces the list and keeps every other field', () => {
	const dir = profileWith(['@deepseek-ai/dsh-base', 'dsh-ops', 'billion-context']);
	writeBundles(dir, ['@deepseek-ai/dsh-base']);
	const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
	assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base']);
	assert.equal(manifest.dsh.keepMe, true);
	assert.equal(manifest.name, 'desktop');
	rmSync(dir, { recursive: true, force: true });
});
