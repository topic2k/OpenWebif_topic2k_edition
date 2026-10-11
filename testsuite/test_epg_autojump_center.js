const assert = require('node:assert/strict');
const test = require('node:test');
const {functionSource, sourceSection, runScript} = require('./test_epg_source');

const jumpConfig = sourceSection('var epgJumpNow = config.jumpNow;', 'function autoJumpTvGuide()');

function runGuide(hour, minute, enabled = true, startHour = 0) {
	const scroller = {
		length: 1,
		offset: () => ({top: 0}),
		scrollTop(value) {
			if (value !== undefined) this.position = value;
			return this.position || 0;
		},
		height: () => 400
	};
	const row = index => ({
		length: 1,
		offset: () => ({top: 40 + index * 200}),
		outerHeight: () => 200,
		find: () => ({each: () => {}})
	});
	const $ = selector => {
		if (selector === '#fulltbl') return scroller;
		if (selector === '.serviceheader') return {first: () => ({outerHeight: () => 40})};
		if (selector === '#tbl1body') return {find: () => ({eq: row})};
		if (selector === '#tbl1body .epg__slot') return {first: () => row(0)};
		throw new Error('Unexpected selector: ' + selector);
	};
	const FixedDate = class extends Date {
		constructor() { super(2026, 8, 28, hour, minute); }
		static now() { return new FixedDate().getTime(); }
	};
	const slotStart = Math.floor(new Date(2026, 8, 28, startHour).getTime() / 1000);
	const context = runScript(jumpConfig + functionSource('guidePosition') + '\n' + functionSource('autoJumpTvGuide'), {
		jQuery: $, Date: FixedDate,
		config: {day: 0, slotStart, jumpNow: enabled, jumpActiveService: false, currentServiceRef: ''}
	});
	context.autoJumpTvGuide();
	return scroller.position || 0;
}

function runTimeline(marker, eventStart, enabled = true, scrollWidth = 30140) {
	const scroller = {
		scrollLeft(value) {
			if (value !== undefined) this.position = value;
			return this.position || 0;
		},
		width: () => 600
	};
	const currentEvent = eventStart == null ? {length: 0} : {
		length: 1,
		position: () => ({left: eventStart})
	};
	const row = {length: 1, find: () => ({first: () => ({closest: () => currentEvent})})};
	const $ = selector => {
		if (selector === '#fulltbl') return scroller;
		if (selector === '.epg__row') return {first: () => row};
		if (selector === '.curevent') return {first: () => ({closest: () => currentEvent})};
		if (selector === '.timetable-now') return {css: () => marker + 'px'};
		if (selector === '.epg__channel-col') return {first: () => ({outerWidth: () => 140})};
		throw new Error('Unexpected selector: ' + selector);
	};
	const context = runScript(jumpConfig + functionSource('epgTimelineNowPosition') + '\n' +
		functionSource('clampTimelineScroll') + '\n' + functionSource('autoJumpTimeline'), {
		jQuery: $, Date: {now: () => 4560000},
		tableNode: {scrollWidth, clientWidth: 600},
		config: {day: 0, first: 0, jumpNow: enabled, jumpActiveService: false, currentServiceRef: ''}
	});
	context.autoJumpTimeline();
	return scroller.position || 0;
}

test('Zeitschrift platziert die Uhrzeit bei 30 % des sichtbaren Zeitbereichs', () => {
	assert.equal(runGuide(11, 0), 2532);
	assert.equal(runGuide(11, 45), 2712);
	assert.equal(runGuide(15, 30, true, 10), 1212);
	assert.equal(runGuide(20, 47), 4880);
	assert.equal(runGuide(0, 30), 12);
	assert.equal(runGuide(9, 0, true, 10), 0);
});

test('Zeitstrahl platziert die aktuelle Zeit bei 30 % statt am Beginn einer laufenden Sendung', () => {
	assert.equal(runTimeline(900, 300), 622);
	assert.equal(runTimeline(900, null), 622);
});

test('Automatischer Jetzt-Sprung im Zeitstrahl ignoriert eine veraltete Markierung', () => {
	assert.equal(runTimeline(450, 300), 622);
});

test('Bei ausgeschalteter Option bleibt die Startposition unverändert', () => {
	assert.equal(runGuide(11, 0, false), 0);
	assert.equal(runTimeline(900, 300, false), 0);
});

test('Automatischer Jetzt-Sprung bleibt in kurzen und leeren Zeitstrahlen begrenzt', () => {
	assert.equal(runTimeline(900, null, true, 800), 200);
	assert.equal(runTimeline(900, null, true, 600), 0);
});