/**
 * In-memory progress of one staging run. The HTTP route and the client card
 * read {@link createStatusStore} snapshots; nothing is persisted.
 */
export function createStatusStore() {
	const state = {
		running: false,
		startedAt: 0,
		finishedAt: 0,
		total: 0,
		done: 0,
		current: null,
		error: null,
	};
	let items = [];

	const row = (name) => items.find((item) => item.name === name);

	return {
		/** Start a run over the given bundle names. */
		begin(names) {
			items = names.map((name) => ({ name, state: 'pending', ms: 0, message: '' }));
			state.running = true;
			state.startedAt = Date.now();
			state.finishedAt = 0;
			state.total = names.length;
			state.done = 0;
			state.current = null;
			state.error = null;
		},
		/** Mark one bundle as loading. */
		start(name) {
			state.current = name;
			const item = row(name);
			if (item !== undefined) item.state = 'loading';
		},
		/** Record one bundle outcome: ready, restart or failed. */
		finish(name, outcome, ms, message) {
			const item = row(name);
			if (item !== undefined) {
				item.state = outcome;
				item.ms = ms;
				item.message = message;
			}
			state.done += 1;
		},
		/** End the run. */
		finishRun() {
			state.running = false;
			state.finishedAt = Date.now();
			state.current = null;
		},
		/** End the run with an error that stopped staging before the first bundle. */
		fail(error) {
			state.running = false;
			state.finishedAt = Date.now();
			state.current = null;
			state.error = error instanceof Error ? error.message : String(error);
		},
		/** Plain copy for the HTTP response. */
		snapshot() {
			return { ...state, items: items.map((item) => ({ ...item })), now: Date.now() };
		},
	};
}
