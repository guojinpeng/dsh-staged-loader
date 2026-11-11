import assert from 'node:assert/strict';
import test from 'node:test';
import { enabledNames, runStaging, selectStaged } from '../src/stage.js';
import { createStatusStore } from '../src/status.js';

const config = (over) => ({ keep: [], defer: [], batchSize: 2, batchPauseMs: 0, ...over });

const rows = [
	{ name: '@deepseek-ai/dsh-base', installed: true, availability: 'installation', enabled: true },
	{ name: '@guojinpeng/dsh-staged-loader', installed: true, availability: 'profile', enabled: true },
	{ name: 'dsh-ops', installed: true, availability: 'profile', enabled: false },
	{ name: 'billion-context', installed: true, availability: 'profile', enabled: true },
	{ name: 'dshmarket', installed: false, availability: 'missing', enabled: false },
	{ name: 'dsh-plugin-manager', installed: true, availability: 'profile', enabled: true, readOnlyReason: 'management-required' },
];

test('selectStaged keeps profile bundles and drops core, self, read-only and missing rows', () => {
	assert.deepEqual(selectStaged(config(), rows), ['dsh-ops', 'billion-context']);
});

test('selectStaged honours keep', () => {
	assert.deepEqual(selectStaged(config({ keep: ['billion-context'] }), rows), ['dsh-ops']);
});

test('selectStaged honours an explicit defer list', () => {
	assert.deepEqual(selectStaged(config({ defer: ['billion-context', 'not-installed'] }), rows), ['billion-context']);
});

test('enabledNames reads the enabled flag', () => {
	const enabled = enabledNames(rows);
	assert.equal(enabled.has('dsh-ops'), false);
	assert.equal(enabled.has('billion-context'), true);
});

/** Build a context whose plugin manager records calls and answers from resultFor. */
function context(resultFor) {
	const calls = [];
	const ctx = {
		get(name) {
			if (name !== 'pluginManager') return undefined;
			return {
				async setBundleEnabled(bundle, enabled) {
					calls.push([bundle, enabled]);
					return resultFor(bundle);
				},
			};
		},
	};
	return { ctx, calls };
}

test('runStaging enables each deferred bundle in order', async () => {
	const { ctx, calls } = context(() => ({}));
	const status = createStatusStore();
	const staged = new Set();
	await runStaging({ ctx, deferred: ['dsh-ops', 'billion-context'], config: config(), status, staged, isStopped: () => false });
	assert.deepEqual(calls, [
		['dsh-ops', true],
		['billion-context', true],
	]);
	assert.deepEqual([...staged], ['dsh-ops', 'billion-context']);
	const snapshot = status.snapshot();
	assert.equal(snapshot.running, false);
	assert.equal(snapshot.done, 2);
});

test('runStaging keeps the warning and restart outcomes on the rows', async () => {
	const { ctx } = context((bundle) => {
		if (bundle === 'dsh-ops') return { warnings: ['one', 'two'] };
		if (bundle === 'billion-context') return { restartReason: 'changed patch' };
		return {};
	});
	const status = createStatusStore();
	await runStaging({
		ctx,
		deferred: ['dsh-ops', 'billion-context'],
		config: config(),
		status,
		staged: new Set(),
		isStopped: () => false,
	});
	const items = status.snapshot().items;
	assert.equal(items[0].state, 'ready');
	assert.equal(items[0].message, '2 warning(s)');
	assert.equal(items[1].state, 'restart');
	assert.equal(items[1].message, 'changed patch');
});

test('runStaging records a failure and continues with the next bundle', async () => {
	const { ctx, calls } = context((bundle) => {
		if (bundle === 'dsh-ops') throw new Error('boom');
		return {};
	});
	const status = createStatusStore();
	await runStaging({ ctx, deferred: ['dsh-ops', 'billion-context'], config: config(), status, staged: new Set(), isStopped: () => false });
	assert.equal(calls.length, 2);
	const items = status.snapshot().items;
	assert.equal(items[0].state, 'failed');
	assert.equal(items[0].message, 'boom');
	assert.equal(items[1].state, 'ready');
});

test('runStaging stops between bundles when the host is shutting down', async () => {
	const { ctx, calls } = context(() => ({}));
	const status = createStatusStore();
	let stop = false;
	const stopping = {
		get(name) {
			if (name !== 'pluginManager') return undefined;
			return {
				async setBundleEnabled(bundle, enabled) {
					calls.push([bundle, enabled]);
					stop = true;
					return {};
				},
			};
		},
	};
	await runStaging({ ctx: stopping, deferred: ['dsh-ops', 'billion-context'], config: config(), status, staged: new Set(), isStopped: () => stop });
	assert.deepEqual(calls, [['dsh-ops', true]]);
	void ctx;
});

test('runStaging finishes at once when nothing is deferred', async () => {
	const { ctx, calls } = context(() => ({}));
	const status = createStatusStore();
	await runStaging({ ctx, deferred: [], config: config(), status, staged: new Set(), isStopped: () => false });
	assert.equal(calls.length, 0);
	assert.equal(status.snapshot().running, false);
	assert.equal(status.snapshot().total, 0);
});
