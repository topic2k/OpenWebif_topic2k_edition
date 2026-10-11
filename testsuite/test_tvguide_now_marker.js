const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {functionSource, runScript} = require('./test_epg_source');

const template = readFileSync(path.join(__dirname, '../plugin/controllers/views/responsive/ajax/multiepg.tmpl'), 'utf8').replace(/\r\n/g, '\n');

function renderMarker(now, slotStart, rowHeights, hasChannels = true) {
	const functionBody = ['guidePosition', 'updateCurrentEvents', 'updateTvGuideNowMarker'].map(functionSource).join('\n');
	const marker = { length: 1, styles: {}, visible: false,
		css(styles) { Object.assign(this.styles, styles); return this; },
		show() { this.visible = true; return this; },
		hide() { this.visible = false; return this; }
	};
	let scrollTop = 45;
	const rows = rowHeights.map((height, index) => ({
		length: 1,
		offset() { return { top: 150 - scrollTop + rowHeights.slice(0, index).reduce((a, b) => a + b, 0) }; },
		outerHeight() { return height; }
	}));
	const selections = {
		'.epg__tv-guide-now': marker,
		'#tbl1body tr': { length: rows.length, eq(index) { return rows[index]; } },
		'#tbl1body .epg__slot': {first() { return hasChannels ? rows[0] : {length: 0}; }},
		'#fulltbl': { offset() { return { top: 100 }; }, scrollTop() { return scrollTop; } },
		'#tbl1': { outerWidth() { return 900; } }
	};
	const context = {
		jQuery: selector => selections[selector], scope: {find: selector => selections[selector]},
		Date: { now: () => now * 1000 }, config: {slotStart}, marker, tableNode: {querySelectorAll: () => []}
	};
	runScript(functionBody + '\nupdateTvGuideNowMarker();', context);
	return marker;
}

test('today shows a horizontal line across the table on the fixed time grid', () => {
	const marker = renderMarker(3600, 0, [100, 200]);
	assert.equal(marker.visible, true);
	assert.equal(marker.styles.top, '290px');
	assert.equal(marker.styles.width, '900px');
});

test('the line moves into the next slot without depending on text heights', () => {
	const marker = renderMarker(7200 + 1800, 0, [100, 200]);
	assert.equal(marker.visible, true);
	assert.equal(marker.styles.top, '650px');
	assert.equal(renderMarker(9000, 0, [400, 900]).styles.top, marker.styles.top);
});

test('20:47 has the same position for channels with different description lengths', () => {
	const now = (20 * 60 + 47) * 60;
	assert.equal(renderMarker(now, 0, Array(12).fill(480)).styles.top, '5038px');
	assert.equal(renderMarker(now, 0, Array(12).fill(900)).styles.top, '5038px');
});

test('guide layout fixes event positions and clips across slots and day edges', () => {
	const events = [[-900, 900], [7100, 7500], [85000, 88000], [86400, 88000]].map(([begin, end]) => ({
		style: {}, getAttribute: name => name === 'data-begin' ? begin : end
	}));
	const surfaces = events.map((event, index) => ({
		style: {}, getAttribute: () => [0, 0, 11, 11][index], querySelectorAll: () => [event]
	}));
	runScript(functionSource('guidePosition') + '\n' + functionSource('layoutTvGuide') + '\nlayoutTvGuide();', {
		tableNode: {classList: {contains: () => true}, querySelectorAll: () => surfaces}
	});
	assert.equal(events[0].style.top, '0px');
	assert.equal(events[0].style.height, '60px');
	assert.equal(events[1].style.top, 7100 / 15 + 'px');
	assert.equal(events[1].style.height, 400 / 15 + 'px');
	assert.equal(events[2].style.top, 85000 / 15 - 5280 + 'px');
	assert.equal(events[2].style.height, 1400 / 15 + 'px');
	assert.equal(events[3].style.display, 'none');
});

test('times outside the displayed 24-hour range do not show a line', () => {
	assert.equal(renderMarker(-1, 0, [100, 200]).visible, false);
	assert.equal(renderMarker(14400, 0, [100, 200]).visible, false);
});

test('a guide without channels has no time surface and hides the marker safely', () => {
	assert.equal(renderMarker(3600, 0, Array(12).fill(480), false).visible, false);
});

test('the marker is only rendered for today in the current week', () => {
	assert.ok(/#if \$mode == 1[\s\S]*?<div id="fulltbl"[\s\S]*?#if \$day == 0 and \$week == 0\s*<div class="epg__tv-guide-now"/.test(template), 'the marker must be rendered only for the current day and week');
});