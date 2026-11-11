import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDeferred, runStaging } from '../src/stage.js';
import { createStatusStore } from '../src/status.js';

const config = (over) => ({ keep: [], defer: [], batchSize: 2, batchPauseMs: 0, ...over });

test('resolveDeferred defers every non-core bundle by default', () => {
	const selected = ['@deepseek-ai/dsh-base', 'dsh-ops', '@guojinpeng/dsh-staged-loader', 'billion-context'];
	assert.deepEqual(resolveDeferred(config(), selected), ['dsh-ops', 'billion-context']);
});

test('resolveDeferred honours keep', () => {
	const selected = ['@deepseek-ai/dsh-base', 'dsh-ops', 'billion-context'];
	assert.deepEqual(resolveDeferred(config({ keep: ['billion-context'] }), selected), ['dsh-ops']);
});

test('resolveDeferred honours an explicit defer list', () => {
	const selected = ['@deepseek-ai/dsh-base', 'dsh-ops', 'billion-context'];
	assert.deepEqual(resolveDeferred(config({ defer: ['billion-context', 'not-installed'] }), selected), ['billion-context']);
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
	const rows = status.snapshot().items;
	assert.equal(rows[0].state, 'ready');
	assert.equal(rows[0].message, '2 warning(s)');
	assert.equal(rows[1].state, 'restart');
	assert.equal(rows[1].message, 'changed patch');
});

test('runStaging records a failure and continues with the next bundle', async () => {
	const { ctx, calls } = context((bundle) => {
		if (bundle === 'dsh-ops') throw new Error('boom');
		return {};
	});
	const status = createStatusStore();
	const staged = new Set();
	await runStaging({ ctx, deferred: ['dsh-ops', 'billion-context'], config: config(), status, staged, isStopped: () => false });
	assert.equal(calls.length, 2);
	const rows = status.snapshot().items;
	assert.equal(rows[0].state, 'failed');
	assert.equal(rows[0].message, 'boom');
	assert.equal(rows[1].state, 'ready');
	assert.equal(staged.size, 2);
});

test('runStaging stops between bundles when the host is shutting down', async () => {
	const { ctx, calls } = context(() => ({}));
	const status = createStatusStore();
	let stop = false;
	const ctxStopping = {
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
	await runStaging({ ctx: ctxStopping, deferred: ['dsh-ops', 'billion-context'], config: config(), status, staged: new Set(), isStopped: () => stop });
	assert.deepEqual(calls, [['dsh-ops', true]]);
	void ctx;
});
