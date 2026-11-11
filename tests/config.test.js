import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const home = mkdtempSync(join(tmpdir(), 'gdssl-home-'));
process.env.DSH_HOME = home;
const module = await import('../src/config.js');

test('a missing file is seeded with the defaults', () => {
	const config = module.readConfig();
	assert.equal(config.enabled, true);
	assert.equal(config.startDelayMs, 1500);
	assert.deepEqual(config.keep, []);
	const written = JSON.parse(readFileSync(join(home, 'guojinpeng', 'dsh-staged-loader', 'config.json'), 'utf8'));
	assert.equal(written.batchSize, 2);
	rmSync(home, { recursive: true, force: true });
});

test('normalizeConfig clamps numbers and drops malformed lists', () => {
	const config = module.normalizeConfig({
		enabled: false,
		startDelayMs: -5,
		waitForBootMs: 'x',
		batchSize: 99,
		batchPauseMs: 0,
		keep: ['a', '', 3],
		defer: 'b',
	});
	assert.equal(config.enabled, false);
	assert.equal(config.startDelayMs, 0);
	assert.equal(config.waitForBootMs, 60000);
	assert.equal(config.batchSize, 50);
	assert.deepEqual(config.keep, ['a']);
	assert.deepEqual(config.defer, []);
});
