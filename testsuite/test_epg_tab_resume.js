const assert = require('node:assert/strict');
const test = require('node:test');
const {functionSource, runScript} = require('./test_epg_source');

function createHandler(initialVisibility = 'visible') {
	let now = 1000;
	let loaded;
	const requests = [];
	const inserted = [];
	let jumps = 0;
	const document = {
		visibilityState: initialVisibility,
		addEventListener() {}
	};
	const FixedDate = class extends Date {
		static now() { return now; }
	};
	const jQuery = selector => {
		if (selector === '#tvcontent') return {length: 1, html(markup) { inserted.push(markup); return this; }};
		if (selector === '#pt4') return {length: 1, click() { jumps++; }};
		throw new Error('Unexpected selector: ' + selector);
	};
	jQuery.ajax = options => {
		requests.push(options);
		return {done(callback) { loaded = callback; return this; }};
	};
	const context = runScript('var resumeRequestVersion = 0;\n' +
		'var hiddenSince = document.visibilityState === \'hidden\' ? Date.now() : null;\n' +
		'function alive() { return !disposed; }\n' + functionSource('handleVisibilityChange') + '\n' +
		functionSource('handleResumeSettings'), {
		document, Date: FixedDate, disposed: false, jQuery,
		config: {mode: 2, day: 1, week: 3, bref: 'bouquet%20%26%20test', epgmode: 'radio', jumpOnResume: true}
	});
	return {
		context, document, requests, inserted,
		setNow(value) { now = value; },
		handle() { context.handleVisibilityChange(); },
		complete(markup) { loaded(markup); },
		jumps: () => jumps
	};
}

test('Tab-Rückkehr lädt erst nach mindestens fünf Minuten und springt nach erfolgreichem Abruf auf Jetzt', () => {
	const state = createHandler();
	state.document.visibilityState = 'hidden';
	state.setNow(1000);
	state.handle();
	state.document.visibilityState = 'visible';
	state.setNow(300999);
	state.handle();
	assert.equal(state.requests.length, 0, 'Ein Wechsel unter fünf Minuten behält die Position');

	state.document.visibilityState = 'hidden';
	state.setNow(301000);
	state.handle();
	state.document.visibilityState = 'visible';
	state.setNow(601000);
	state.handle();
	assert.equal(state.requests.length, 1, 'Genau fünf Minuten lösen einen Abruf aus');
	assert.equal(state.requests[0].url, 'ajax/multiepg?bref=bouquet%20%26%20test&day=0&epgmode=radio&week=0');
	state.complete('<div id="modern-epg"></div>');
	assert.deepEqual(state.inserted, ['<div id="modern-epg"></div>']);
	assert.equal(state.jumps(), 1);
});

test('versteckte Initialisierung zählt über fünf Minuten und Mehrfachereignisse starten keinen zweiten Abruf', () => {
	const state = createHandler('hidden');
	state.setNow(1000);
	state.handle();
	state.setNow(2000);
	state.handle();
	state.document.visibilityState = 'visible';
	state.setNow(301001);
	state.handle();
	state.handle();
	assert.equal(state.requests.length, 1);
});

test('Antwort einer verlassenen EPG-Instanz wird verworfen und ein Ladefehler löst keinen Sprung aus', () => {
	const abandoned = createHandler();
	abandoned.document.visibilityState = 'hidden';
	abandoned.setNow(1000);
	abandoned.handle();
	abandoned.document.visibilityState = 'visible';
	abandoned.setNow(301000);
	abandoned.handle();
	abandoned.context.disposed = true;
	abandoned.complete('<div id="stale"></div>');
	assert.deepEqual(abandoned.inserted, []);
	assert.equal(abandoned.jumps(), 0);

	const failed = createHandler();
	failed.document.visibilityState = 'hidden';
	failed.setNow(1000);
	failed.handle();
	failed.document.visibilityState = 'visible';
	failed.setNow(301000);
	failed.handle();
	assert.deepEqual(failed.inserted, []);
	assert.equal(failed.jumps(), 0);
});

test('deaktivierter Auto-Sprung unterdrückt Abruf und verwirft laufende Rückkehr-Antworten', () => {
	const disabled = createHandler();
	disabled.context.config.jumpOnResume = false;
	disabled.document.visibilityState = 'hidden';
	disabled.setNow(1000);
	disabled.handle();
	disabled.document.visibilityState = 'visible';
	disabled.setNow(301000);
	disabled.handle();
	assert.equal(disabled.requests.length, 0);

	const pending = createHandler();
	pending.document.visibilityState = 'hidden';
	pending.setNow(1000);
	pending.handle();
	pending.document.visibilityState = 'visible';
	pending.setNow(301000);
	pending.handle();
	assert.equal(pending.requests.length, 1);
	pending.context.handleResumeSettings(null, {jumpOnResume: false});
	pending.context.handleResumeSettings(null, {jumpOnResume: true});
	pending.complete('<div id="stale"></div>');
	assert.deepEqual(pending.inserted, []);
	assert.equal(pending.jumps(), 0);
});