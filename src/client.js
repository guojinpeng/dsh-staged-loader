/**
 * Client half of the staged loader: one floating card in the bottom-right
 * corner that follows the host staging progress. The card is plain DOM so it
 * adds no React dependency and mounts before the workspace renders.
 */
const STATUS_PATH = '/guojinpeng/dsh-staged-loader/status';
const CARD_ID = 'gdssl-card';
const STYLE_ID = 'gdssl-style';

const STRINGS = {
	zh: {
		loading: '正在加载插件',
		done: '插件加载完成',
		problems: (count) => `插件加载完成，${count} 项需要注意`,
		restart: '需重启',
	},
	en: {
		loading: 'Loading plugins',
		done: 'Plugins loaded',
		problems: (count) => `Plugins loaded, ${count} item(s) need attention`,
		restart: 'restart needed',
	},
};

const CSS = `
#${CARD_ID} {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483000;
  width: 264px;
  padding: 12px 14px;
  border-radius: 12px;
  font: 12px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: #1f2328;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid rgba(31, 35, 40, 0.12);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  pointer-events: none;
  transition: opacity 0.2s ease;
}
@media (prefers-color-scheme: dark) {
  #${CARD_ID} {
    color: #e6edf3;
    background: rgba(30, 33, 38, 0.97);
    border-color: rgba(255, 255, 255, 0.12);
  }
}
#${CARD_ID} .gdssl-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
}
#${CARD_ID} .gdssl-count {
  font-weight: 400;
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
}
#${CARD_ID} .gdssl-track {
  height: 4px;
  margin: 8px 0 6px;
  border-radius: 2px;
  overflow: hidden;
  background: rgba(127, 127, 127, 0.22);
}
#${CARD_ID} .gdssl-fill {
  height: 100%;
  width: 0;
  border-radius: 2px;
  background: #2f81f7;
  transition: width 0.2s ease;
}
#${CARD_ID} .gdssl-current,
#${CARD_ID} .gdssl-note {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.7;
}
#${CARD_ID} .gdssl-current:empty {
  display: none;
}
`;

/** Pick the card language from the browser locale. */
function strings() {
	const language = typeof navigator === 'object' ? String(navigator.language ?? '') : '';
	return language.toLowerCase().startsWith('zh') ? STRINGS.zh : STRINGS.en;
}

/** Drop the npm scope from a bundle name for a narrow card. */
function shortName(name) {
	const slash = name.lastIndexOf('/');
	return slash === -1 ? name : name.slice(slash + 1);
}

/** Build the card once and update its text nodes on every render. */
function createCard(doc, t) {
	const style = doc.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	doc.head?.appendChild(style);

	const root = doc.createElement('div');
	root.id = CARD_ID;
	root.setAttribute('role', 'status');
	root.setAttribute('aria-live', 'polite');
	root.style.display = 'none';

	const head = doc.createElement('div');
	head.className = 'gdssl-head';
	const title = doc.createElement('span');
	title.className = 'gdssl-title';
	const count = doc.createElement('span');
	count.className = 'gdssl-count';
	head.append(title, count);

	const track = doc.createElement('div');
	track.className = 'gdssl-track';
	const fill = doc.createElement('div');
	fill.className = 'gdssl-fill';
	track.appendChild(fill);

	const current = doc.createElement('div');
	current.className = 'gdssl-current';
	const note = doc.createElement('div');
	note.className = 'gdssl-note';

	root.append(head, track, current, note);
	let hideTimer = null;

	/** Problems the user should see: a failed enable or a restart requirement. */
	const problemsOf = (state) => (state.items ?? []).filter((item) => item.state === 'failed' || item.state === 'restart');

	return {
		root,
		/** Attach the card when the document has a body. */
		mount() {
			if (root.isConnected) return true;
			const parent = doc.body ?? doc.documentElement;
			if (!parent) return false;
			parent.appendChild(root);
			return true;
		},
		/** Paint one status snapshot. */
		render(state) {
			clearTimeout(hideTimer);
			const total = typeof state.total === 'number' ? state.total : 0;
			const done = typeof state.done === 'number' ? state.done : 0;
			const problems = problemsOf(state);
			root.style.display = '';
			title.textContent = problems.length > 0 ? t.problems(problems.length) : state.running ? t.loading : t.done;
			count.textContent = total > 0 ? `${done}/${total}` : '';
			fill.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;
			current.textContent = state.running && typeof state.current === 'string' ? shortName(state.current) : '';
			note.textContent = state.error ?? problems
				.slice(0, 3)
				.map((item) => `${shortName(item.name)}${item.state === 'restart' ? ` · ${t.restart}` : ''}`)
				.join('，');
		},
		/** Keep a finished card visible long enough to be read, then fade it. */
		scheduleHide(state, milliseconds) {
			clearTimeout(hideTimer);
			hideTimer = setTimeout(() => {
				root.style.display = 'none';
			}, problemsOf(state).length > 0 || state.error !== null ? 12000 : milliseconds);
		},
		dispose() {
			clearTimeout(hideTimer);
			root.remove();
			style.remove();
		},
	};
}

/** Register the card; polling stops when the run ends or the route rejects. */
function apply(ctx) {
	const doc = document;
	const card = createCard(doc, strings());
	let timer = null;
	let rejected = false;

	const poll = () => {
		timer = null;
		fetch(STATUS_PATH, { cache: 'no-store', headers: { accept: 'application/json' } })
			.then(async (response) => {
				if (response.status === 401 || response.status === 403) {
					rejected = true;
					card.dispose();
					return;
				}
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const state = await response.json();
				if (rejected || !card.mount()) return;
				card.render(state);
				if (state.running) {
					timer = setTimeout(poll, 600);
					return;
				}
				if (state.total > 0) card.scheduleHide(state, 4000);
			})
			.catch(() => {
				if (rejected) return;
				timer = setTimeout(poll, 1500);
			});
	};

	ctx.effect(() => () => {
		rejected = true;
		if (timer !== null) clearTimeout(timer);
		card.dispose();
	});

	poll();
}

/**
 * The client module loader evaluates this file as a classic script in page
 * scope. Top-level `import` or `export` breaks that evaluation with a
 * SyntaxError, so the module registers through __ModuleLoader__ only.
 */
const inject = [];

window.__ModuleLoader__.load({
	id: '@guojinpeng/dsh-staged-loader',
	factory: () => ({ apply, inject }),
});
