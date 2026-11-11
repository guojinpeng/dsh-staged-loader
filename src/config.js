import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Resolve the DSH home directory with the official precedence:
 * `$DSH_HOME` when set and non-empty, otherwise `~/.dsh`.
 * The plugin keeps this local so it adds no npm dependency.
 */
export function resolveDshHome(env = process.env) {
	const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
	if (configured !== '') return configured;
	return join(homedir(), '.dsh');
}

/** Absolute path of the staged loader configuration. */
export const CONFIG_PATH = join(resolveDshHome(), 'guojinpeng', 'dsh-staged-loader', 'config.json');

/** Defaults used when the file is absent or a field is invalid. */
export const DEFAULT_CONFIG = Object.freeze({
	enabled: true,
	startDelayMs: 1500,
	waitForBootMs: 60000,
	batchSize: 2,
	batchPauseMs: 200,
	keep: [],
	defer: [],
});

/** Keep only non-empty strings; every other shape falls back to an empty list. */
function textList(value) {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item) => typeof item === 'string' && item.trim() !== '')
		.map((item) => item.trim());
}

/** Clamp one finite number into the accepted range. */
function numberIn(value, fallback, min, max) {
	const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	return Math.min(max, Math.max(min, number));
}

/** Coerce any parsed value into a complete configuration object. */
export function normalizeConfig(value) {
	const input = value !== null && typeof value === 'object' ? value : {};
	return {
		enabled: input.enabled !== false,
		startDelayMs: numberIn(input.startDelayMs, DEFAULT_CONFIG.startDelayMs, 0, 60000),
		waitForBootMs: numberIn(input.waitForBootMs, DEFAULT_CONFIG.waitForBootMs, 0, 300000),
		batchSize: Math.round(numberIn(input.batchSize, DEFAULT_CONFIG.batchSize, 1, 50)),
		batchPauseMs: numberIn(input.batchPauseMs, DEFAULT_CONFIG.batchPauseMs, 0, 10000),
		keep: textList(input.keep),
		defer: textList(input.defer),
	};
}

/**
 * Read the configuration. A missing file is seeded with the defaults so the
 * user can edit it; a malformed file uses the defaults and stays untouched.
 * @param logger - host logger, optional.
 */
export function readConfig(logger) {
	let parsed;
	let absent = false;
	try {
		parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
	} catch (error) {
		absent = error?.code === 'ENOENT';
		if (!absent) logger?.warn?.('dsh-staged-loader: the config file is unreadable, defaults are used', error);
	}
	const config = normalizeConfig(parsed);
	if (absent && !existsSync(CONFIG_PATH)) {
		try {
			mkdirSync(dirname(CONFIG_PATH), { recursive: true });
			writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
		} catch (error) {
			logger?.warn?.('dsh-staged-loader: could not write the default config file', error);
		}
	}
	return config;
}
