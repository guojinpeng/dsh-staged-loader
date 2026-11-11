/** This package never defers itself. */
export const SELF = '@guojinpeng/dsh-staged-loader';

/** Bundles shipped with DSH start at boot and are never deferred. */
const CORE_PREFIX = '@deepseek-ai/';

/** Resolve after a pause without keeping the process alive. */
function pause(ms) {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		timer.unref?.();
	});
}

/**
 * Choose the bundles to enable after the page is ready.
 * An explicit `defer` list wins; otherwise every selected bundle outside the
 * core prefix is deferred, minus `keep` and this package.
 */
export function resolveDeferred(config, selected) {
	const chosen = new Set(selected);
	if (config.defer.length > 0) return config.defer.filter((name) => chosen.has(name));
	const keep = new Set(config.keep);
	return selected.filter((name) => !name.startsWith(CORE_PREFIX) && name !== SELF && !keep.has(name));
}

/**
 * Enable the deferred bundles one by one through the plugin manager, so each
 * bundle is recomposed live instead of at boot. A failure does not stop the
 * run: the next bundle is tried and the failure shows on the card.
 */
export async function runStaging({ ctx, deferred, config, status, staged, isStopped }) {
	const manager = ctx.get('pluginManager');
	if (manager === undefined) {
		status.fail(new Error('the pluginManager service is unavailable'));
		return;
	}
	if (deferred.length === 0) {
		status.begin([]);
		status.finishRun();
		return;
	}
	status.begin(deferred);
	let count = 0;
	for (const name of deferred) {
		if (isStopped()) break;
		status.start(name);
		const started = Date.now();
		let outcome = 'ready';
		let message = '';
		try {
			const result = await manager.setBundleEnabled(name, true);
			if (typeof result?.restartReason === 'string') {
				outcome = 'restart';
				message = result.restartReason;
			} else if (Array.isArray(result?.warnings) && result.warnings.length > 0) {
				message = `${result.warnings.length} warning(s)`;
			}
		} catch (error) {
			outcome = 'failed';
			message = error instanceof Error ? error.message : String(error);
		}
		// Record the bundle on exit even after a failure: the next start
		// retries it instead of loading it at boot again.
		staged.add(name);
		status.finish(name, outcome, Date.now() - started, message);
		count += 1;
		if (count % config.batchSize === 0) await pause(config.batchPauseMs);
	}
	status.finishRun();
}
