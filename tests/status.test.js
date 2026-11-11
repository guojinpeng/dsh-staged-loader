import assert from 'node:assert/strict';
import test from 'node:test';
import { createStatusStore } from '../src/status.js';

test('a run moves every row from pending to its outcome', () => {
	const status = createStatusStore();
	status.begin(['a', 'b']);
	let snapshot = status.snapshot();
	assert.equal(snapshot.running, true);
	assert.equal(snapshot.total, 2);
	assert.equal(snapshot.items[0].state, 'pending');

	status.start('a');
	snapshot = status.snapshot();
	assert.equal(snapshot.current, 'a');
	assert.equal(snapshot.items[0].state, 'loading');

	status.finish('a', 'ready', 12, '');
	status.finish('b', 'restart', 3, 'changed');
	status.finishRun();
	snapshot = status.snapshot();
	assert.equal(snapshot.running, false);
	assert.equal(snapshot.done, 2);
	assert.equal(snapshot.current, null);
	assert.equal(snapshot.items[1].state, 'restart');
	assert.equal(snapshot.items[1].message, 'changed');
});

test('fail records the message and ends the run', () => {
	const status = createStatusStore();
	status.fail(new Error('nope'));
	const snapshot = status.snapshot();
	assert.equal(snapshot.running, false);
	assert.equal(snapshot.error, 'nope');
});

test('snapshot is a copy', () => {
	const status = createStatusStore();
	status.begin(['a']);
	status.snapshot().items[0].state = 'changed';
	assert.equal(status.snapshot().items[0].state, 'pending');
});
