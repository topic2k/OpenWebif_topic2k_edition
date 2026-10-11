const assert = require('node:assert/strict');
const { test } = require('node:test');
const {functionSource, sourceSection, runScript} = require('./test_epg_source');

function startClock(mode = 2, day = 0, week = 0) {
	let now = 13000000;
	let attached = true;
	let nextId = 1;
	const timers = new Map();
	const observers = new Set();
	const handlers = new Map();
	const node = {};
	const marker = {0: node, length: 1, styles: {},
		css(key, value) {
			if (typeof key === 'object') Object.assign(this.styles, key);
			else this.styles[key] = value;
			return this;
		},
		show() { return this; },
		hide() { return this; }
	};
	const window = {};
	const document = {body: {}};
	const events = {
		on(name, callback) {
			if (!handlers.has(name)) handlers.set(name, new Set());
			handlers.get(name).add(callback);
			return this;
		},
		one(name, callback) {
			const once = event => { this.off(name, once); callback(event); };
			return this.on(name, once);
		},
		off(name, callback) { handlers.get(name)?.delete(callback); return this; }
	};
	const rows = {length: 12, eq: index => ({offset: () => ({top: index * 200}), outerHeight: () => 200})};
	const jQuery = selector => {
		if (selector === '.timetable-now' || selector === '.epg__tv-guide-now') return marker;
		if (selector === '#tblinner') return {height: () => 444};
		if (selector === '#tbl1body tr') return rows;
		if (selector === '#tbl1body .epg__slot') return {first: () => ({length: 1, offset: () => ({top: 0})})};
		if (selector === '#fulltbl') return {offset: () => ({top: 0}), scrollTop: () => 0};
		if (selector === '#tbl1') return {outerWidth: () => 900};
		if (selector === window) return events;
		throw new Error('Unexpected selector: ' + selector);
	};
	jQuery.contains = (root, element) => root === document && element === node && attached;
	const FixedDate = class extends Date {
		constructor() { super(now); }
		static now() { return now; }
	};
	const schedule = (callback, delay, repeating) => {
		const id = nextId++;
		timers.set(id, {callback, delay, repeating, due: now + delay});
		return id;
	};
	const context = {jQuery, window, document, Date: FixedDate,
		tableNode: {querySelectorAll: () => []},
		scope: {find: jQuery}, config: {mode, day, week, first: 10000, slotStart: 10000},
		setTimeout: (callback, delay) => schedule(callback, delay, false),
		setInterval: (callback, delay) => schedule(callback, delay, true),
		clearInterval: id => timers.delete(id),
		MutationObserver: class {
			constructor(callback) { this.callback = callback; }
			observe(root, options) {
				assert.equal(root, document.body);
				assert.equal(options.childList, true);
				assert.equal(options.subtree, true);
				observers.add(this);
			}
			disconnect() { observers.delete(this); }
		}
	};
	const script = ['startEpgNowMarker', 'epgTimelineNowPosition', 'guidePosition', 'updateCurrentEvents', 'updateTvGuideNowMarker'].map(functionSource).join('\n') + '\n' +
		sourceSection('if (config.day === 0 && config.week === 0)', 'var list = document.getElementById');
	runScript(script, context);
	return {
		marker, timers, observers, handlers,
		advance(milliseconds) {
			const target = now + milliseconds;
			while (true) {
				const next = [...timers.entries()].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
				if (!next) break;
				const [id, timer] = next;
				now = timer.due;
				if (timer.repeating) timer.due += timer.delay;
				else timers.delete(id);
				timer.callback();
			}
			now = target;
		},
		remove() {
			attached = false;
			for (const observer of [...observers]) observer.callback();
		},
		pagehide(persisted = false) {
			for (const [name, callbacks] of [...handlers]) {
				if (name.startsWith('pagehide.')) for (const callback of [...callbacks]) callback({originalEvent: {persisted}});
			}
		},
		pageshow() {
			for (const [name, callbacks] of [...handlers]) {
				if (name.startsWith('pageshow.')) for (const callback of [...callbacks]) callback();
			}
		}
	};
}

test('Zeitstrahl-Markierung folgt der Uhrzeit über mehrere Aktualisierungen', () => {
	const clock = startClock();
	assert.equal(parseFloat(clock.marker.styles.left), 640);
	for (let tick = 1; tick <= 3; tick++) {
		clock.advance(10000);
		assert.equal(parseFloat(clock.marker.styles.left), 140 + (3000 + tick * 10) / 6);
	}
	assert.equal(clock.timers.size, 1);
});

for (const mode of [1, 2]) {
	test('Ansicht ' + mode + ' räumt beim Entfernen sofort Timer, Beobachter und Fensterereignisse auf', () => {
		const clock = startClock(mode);
		clock.remove();
		assert.equal(clock.timers.size, 0);
		assert.equal(clock.observers.size, 0);
		assert.ok([...clock.handlers.values()].every(callbacks => callbacks.size === 0));
		const styles = {...clock.marker.styles};
		clock.advance(30000);
		assert.deepEqual(clock.marker.styles, styles);
	});

	test('Ansicht ' + mode + ' räumt beim Verlassen der Seite auf', () => {
		const clock = startClock(mode);
		clock.pagehide();
		assert.equal(clock.timers.size, 0);
		assert.equal(clock.observers.size, 0);
		assert.ok([...clock.handlers.values()].every(callbacks => callbacks.size === 0));
	});

	test('Ansicht ' + mode + ' startet nach Rückkehr aus dem Browser-Seitencache genau eine Aktualisierung', () => {
		const clock = startClock(mode);
		clock.pagehide(true);
		assert.equal(clock.timers.size, 0);
		assert.equal(clock.observers.size, 0);
		clock.advance(30000);
		clock.pageshow();
		assert.equal(clock.timers.size, 1);
		assert.equal(clock.observers.size, 1);
		if (mode === 2) assert.equal(parseFloat(clock.marker.styles.left), 645);
		clock.pageshow();
		assert.equal(clock.timers.size, 1);
		clock.remove();
		assert.equal(clock.timers.size, 0);
		assert.equal(clock.observers.size, 0);
		assert.ok([...clock.handlers.values()].every(callbacks => callbacks.size === 0));
	});
}

test('Andere Tage und Wochen starten keine Jetzt-Aktualisierung', () => {
	for (const mode of [1, 2]) {
		assert.equal(startClock(mode, 1).timers.size, 0);
		assert.equal(startClock(mode, 0, 1).timers.size, 0);
	}
});