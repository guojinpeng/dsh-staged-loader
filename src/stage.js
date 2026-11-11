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
 * Choose the bundles the loader manages from the plugin manager inventory.
 * A row counts when it is installed from the profile, is not a core bundle,
 * is not this package, and is not listed in `keep`.
 * An explicit `defer` list replaces the default rule.
 */
export function selectStaged(config, rows) {
	if (config.defer.length > 0) {
		const installed = new Set(rows.filter((row) => row.installed).map((row) => row.name));
		return config.defer.filter((name) => installed.has(name));
	}
	const keep = new Set(config.keep);
	return rows
		.filter(
			(row) =>
				row.installed === true &&
				row.availability === 'profile' &&
				row.readOnlyReason === undefined &&
				row.name !== SELF &&
				!row.name.startsWith(CORE_PREFIX) &&
				!keep.has(row.name),
		)
		.map((row) => row.name);
}

/** Bundle names that are already enabled, from the same inventory. */
export function enabledNames(rows) {
	return new Set(rows.filter((row) => row.enabled === true).map((row) => row.name));
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
	status.begin(deferred);
	if (deferred.length === 0) {
		status.finishRun();
		return;
	}
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
		staged.add(name);
		status.finish(name, outcome, Date.now() - started, message);
		count += 1;
		if (count % config.batchSize === 0) await pause(config.batchPauseMs);
	}
	status.finishRun();
}
