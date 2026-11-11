import { readConfig } from './config.js';
import { createStatusHandler } from './handler.js';
import { readBundles, writeBundles } from './manifest.js';
import { enabledNames, runStaging, selectStaged } from './stage.js';
import { createStatusStore } from './status.js';

export const name = 'guojinpeng/dsh-staged-loader';
export const inject = ['pluginManager', 'profileContext'];

/** Same-origin route the client card polls. */
const ROUTE = '/guojinpeng/dsh-staged-loader/status';

/**
 * Enable the managed third-party bundles after the boot composition settles,
 * and write the core-only bundle list back on exit so the next start is fast.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
	const dir = ctx.get('profileContext')?.dir;
	if (typeof dir !== 'string' || dir === '') {
		ctx.logger?.debug?.('dsh-staged-loader: the profile directory is unavailable; staging is off');
		return;
	}
	const config = readConfig(ctx.logger);
	const status = createStatusStore();
	const staged = new Set();
	/** Bundles this run owns; the exit hook removes exactly these. */
	let planned = [];
	let stopped = false;
	let timer = null;

	ctx.inject(['webServer', 'connection'], (web) => {
		web.effect(
			() => web.webServer.register({ kind: 'exact', path: ROUTE, handler: createStatusHandler(web.connection, status) }),
			'guojinpeng/dsh-staged-loader: status route',
		);
	});

	const start = async () => {
		timer = null;
		await settle(ctx, config.waitForBootMs);
		if (stopped) return;
		const manager = ctx.get('pluginManager');
		const rows = await manager.listBundles();
		planned = selectStaged(config, rows);
		const enabled = enabledNames(rows);
		const deferred = planned.filter((name) => !enabled.has(name));
		await runStaging({ ctx, deferred, config, status, staged, isStopped: () => stopped });
	};

	if (config.enabled) {
		timer = setTimeout(() => {
			start().catch((error) => {
				status.fail(error);
				ctx.logger?.warn?.('dsh-staged-loader: staging failed', error);
			});
		}, config.startDelayMs);
		timer.unref?.();
	}

	ctx.effect(() => async () => {
		stopped = true;
		if (timer !== null) clearTimeout(timer);
		if (planned.length === 0) return;
		try {
			const bundles = readBundles(dir);
			const owned = new Set(planned);
			const next = bundles.filter((bundleName) => !owned.has(bundleName));
			if (next.length !== bundles.length) writeBundles(dir, next);
		} catch (error) {
			ctx.logger?.warn?.('dsh-staged-loader: could not write the core-only bundle list', error);
		}
	});
}

/**
 * Wait until the loader tree has no pending import or lifecycle task, which is
 * when the boot composition has settled. The wait is bounded: a hung entry
 * must not block staging forever.
 */
async function settle(ctx, limitMs) {
	const loader = ctx.get('loader');
	let waiting;
	try {
		waiting = loader?.await?.();
	} catch {
		return;
	}
	if (waiting === undefined) return;
	let timer;
	await Promise.race([
		waiting,
		new Promise((resolve) => {
			timer = setTimeout(resolve, limitMs);
			timer.unref?.();
		}),
	]);
	clearTimeout(timer);
}
