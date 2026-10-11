const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {functionSource, callbackSource, runScript} = require('./test_epg_source');

const template = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'controllers', 'views', 'responsive', 'ajax', 'multiepg.tmpl'), 'utf8');

function jumpToTime(day, startHour = 0, primeTimeHour = {201: 6, 202: 12, 203: 20}[day], viewportHeight = 400) {
	const code = callbackSource("scope.find('.plusclick').click(");
	const scroller = {
		position: 0,
		offset: () => ({top: 0}),
		scrollTop() { return this.position; },
		animate(value) { this.position = value.scrollTop; }
	};
	const rows = {
		length: 12,
		eq: index => ({
			length: index >= 0 && index < 12 ? 1 : 0,
			offset: () => ({top: 40 + index * 200}),
			outerHeight: () => 200
		})
	};
	const jQuery = selector => {
		if (typeof selector === 'object') return {data: name => name === 'day' ? day : Math.floor(new Date(2026, 8, 28, primeTimeHour).getTime() / 1000)};
		if (selector === '#fulltbl') return scroller;
		if (selector === '#tbl1body tr') return rows;
		if (selector === '#tbl1body .epg__slot') return {first: () => ({length: 1, offset: () => ({top: 40})})};
		if (selector === '.serviceheader') return {first: () => ({outerHeight: () => 40})};
		throw new Error('Unexpected selector: ' + selector);
	};
	const FixedDate = class extends Date {
		static now() { return new Date(2026, 8, 28, 10, 30).getTime(); }
	};
	runScript(functionSource('guidePosition') + '\n(' + code + ').call({});', {
		jQuery, Date: FixedDate,
		tableNode: {clientHeight: viewportHeight},
		config: {mode: 1, day: 0, week: 0, slotStart: Math.floor(new Date(2026, 8, 28, startHour).getTime() / 1000)}
	});
	return scroller.position;
}

function jumpOnTimeline(day, now = 37800, first = 0, targetTime = {201: 6, 202: 12, 203: 20}[day] * 3600,
	scrollWidth = 30140, clientWidth = 600) {
	const code = callbackSource("scope.find('.plusclick').click(");
	const scroller = {animate(value) { this.position = value.scrollLeft; }};
	const jQuery = selector => {
		if (typeof selector === 'object') return {data: name => name === 'day' ? day : targetTime};
		if (selector === '#fulltbl') return scroller;
		if (selector === '.timetable-now') return {css: () => '450px'};
		if (selector === '.epg__channel-col') return {first: () => ({outerWidth: () => 140})};
		throw new Error('Unexpected selector: ' + selector);
	};
	const FixedDate = class extends Date {
		static now() { return now * 1000; }
	};
	runScript(functionSource('clampTimelineScroll') + '\n(' + code + ').call({});', {
		jQuery, Date: FixedDate, config: {mode: 2, day: 0, week: 0, first, slotStart: first}, tableNode: {scrollWidth, clientWidth}
	});
	return scroller.position;
}

test('Uhrzeit-Auswahl und Jetzt sind an jedem Tag in beiden Ansichten sichtbar', () => {
	const nav = template.slice(template.indexOf('<div id="navepg">'), template.indexOf('display_mode'));
	assert.ok(nav.indexOf("tstrings['prime_times']") < nav.indexOf('#if $mode == 1'));
	for (const time of ['06:00', '12:00', '20:00']) assert.ok(nav.includes(time));
	for (const day of [201, 202, 203]) assert.match(nav, new RegExp('data-day="' + day + '" data-time="'));
	assert.doesNotMatch(nav, /#if \$day == 0 and \$week == 0/);
	assert.match(nav, /data-day="200">\$tstrings\['now'\]/);
	assert.match(nav, /#if \$mode == 1\s*<li><div class="plusclick lbl">&nbsp;\$tstrings\['cw'\]/);
});

for (const mode of [1, 2]) {
	for (const [day, week, offset] of [[1, 0, 1], [0, 1, 7], [2, 1, 9], [-1, 0, -1], [0, 0, -1]]) {
		test(`Jetzt lädt heute vor dem Scrollen: Ansicht ${mode}, Tag ${day}, Woche ${week}, Datumsoffset ${offset}`, () => {
			const midnight = new Date(2026, 8, 28).getTime() / 1000;
			const config = {mode, day, week, slotStart: midnight + offset * 86400, first: midnight + offset * 86400,
				bref: 'encoded-bouquet', epgmode: 'radio'};
			let loadedUrl;
			let onLoad;
			let clicks = 0;
			const container = {html(value) { assert.equal(value, 'spinner'); return this; },
				load(url, callback) { loadedUrl = url; onLoad = callback; }};
			const jQuery = selector => {
				if (typeof selector === 'object') return {data: () => 200};
				if (selector === '#tvcontent') return container;
				if (selector === '#pt4') return {click() { clicks++; }};
				throw new Error('Unexpected selector before today is loaded: ' + selector);
			};
			const FixedDate = class extends Date {
				static now() { return (midnight + 10 * 3600 + 30 * 60) * 1000; }
			};
			runScript('(' + callbackSource("scope.find('.plusclick').click(") + ').call({});', {
				jQuery, config, Date: FixedDate, loadspinner: 'spinner'
			});
			assert.equal(loadedUrl, 'ajax/multiepg?bref=encoded-bouquet&day=0&epgmode=radio&week=0');
			assert.equal(clicks, 0, 'Do not scroll the old day');
			assert.equal(typeof onLoad, 'function');
			onLoad('', 'success');
			assert.equal(clicks, 1, 'Scroll only after today has loaded');
			onLoad('', 'error');
			assert.equal(clicks, 1, 'A failed load must not trigger another jump');
		});
	}
}

test('Zeitschrift springt vertikal zu 06:00, 12:00, 20:00 und Jetzt', () => {
	assert.equal(jumpToTime(201), 1440);
	assert.equal(jumpToTime(202), 2880);
	assert.equal(jumpToTime(203), 4800);
	assert.equal(jumpToTime(200), 2400);
});

test('Jetzt zeigt in der Zeitschrift ein Drittel des sichtbaren Zeitbereichs davor', () => {
	for (const height of [400, 760, 1000]) {
		assert.equal(jumpToTime(200, 0, undefined, height), 2520 - (height - 40) / 3);
	}
	assert.equal(jumpToTime(200, 10, undefined, 760), 0, 'Am Anfang bleibt der Sprung begrenzt');
});

test('Zeitschrift begrenzt vergangene Uhrzeiten vor dem ersten EPG-Slot', () => {
	assert.equal(jumpToTime(201, 10), 0);
	assert.equal(jumpToTime(202, 10), 480);
});

test('Zeitstrahl behält seinen horizontalen Uhrzeit-Sprung', () => {
	assert.equal(jumpOnTimeline(201), 3580);
	assert.equal(jumpOnTimeline(202), 7180);
	assert.equal(jumpOnTimeline(203), 11980);
});

test('Jetzt-Sprung im Zeitstrahl verwendet die aktuelle Uhrzeit statt einer veralteten Markierung', () => {
	assert.equal(jumpOnTimeline(200), 6300 - 460 / 3);
	assert.equal(jumpOnTimeline(200, 37920), 6320 - 460 / 3);
	assert.equal(jumpOnTimeline(200, 0), 0);
});

test('Jetzt zeigt im Zeitstrahl ein Drittel des sichtbaren Zeitbereichs davor', () => {
	for (const width of [400, 760, 1000]) {
		assert.equal(jumpOnTimeline(200, 37800, 0, 0, 30140, width), 6300 - (width - 140) / 3);
	}
});

test('beide Ansichten verwenden den serverseitigen data-time-Wert statt einer festen Primetime', () => {
	assert.equal(jumpToTime(201, 0, 8), 1920);
	assert.equal(jumpOnTimeline(201, 37800, 0, 8 * 3600), 4780);
});

test('Zeitstrahl berücksichtigt den konfigurierten Tagesbeginn für Primetime und Jetzt', () => {
	assert.equal(jumpOnTimeline(202, 37800, 3600), 6580);
	assert.equal(jumpOnTimeline(200, 37800, 3600), 5700 - 460 / 3);
});

test('Zeitstrahl begrenzt Uhrzeit- und Jetzt-Sprünge auf den tatsächlichen Scrollbereich', () => {
	assert.equal(jumpOnTimeline(203, 37800, 0, 72000, 2000, 600), 1400);
	assert.equal(jumpOnTimeline(200, 37800, 0, 0, 2000, 600), 1400);
	assert.equal(jumpOnTimeline(203, 37800, 0, 72000, 600, 600), 0);
	assert.equal(jumpOnTimeline(201, 37800, 86400), 0);
});