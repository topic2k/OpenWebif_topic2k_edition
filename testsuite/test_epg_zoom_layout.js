const assert = require('node:assert/strict');
const test = require('node:test');
const {functionSource, runScript} = require('./test_epg_source');

function layout(viewport, cardTop, tableTop, mode = 'Zeitschrift') {
	const state = {viewport, cardTop, tableTop, cardHeight: 0, tableHeight: 0, tableWidth: 0};
	const card = {
		getBoundingClientRect: () => ({top: state.cardTop, bottom: state.cardTop + state.cardHeight})
	};
	const table = {
		getBoundingClientRect: () => ({top: state.tableTop}),
		style: {setProperty() {}},
		querySelectorAll: () => [],
		classList: {contains: name => name === 'epg__tv-guide' && mode === 'Zeitschrift'},
		querySelector: selector => {
			assert.equal(selector, '.epg__slot');
			return null;
		}
	};
	const jQuery = selector => {
		if (selector === '#epgcard') return {
			0: card,
			length: 1,
			height(value) { if (value !== undefined) state.cardHeight = value; return state.cardHeight; }
		};
		if (selector === '#epgcard > .body') return {css: () => '20px', width: () => 820};
		if (selector === '#fulltbl') return {
			0: table,
			length: 1,
			height(value) { state.tableHeight = value; return this; },
			width(value) { state.tableWidth = value; return this; }
		};
		throw new Error('Unerwarteter Selektor: ' + selector);
	};
	const source = ['resizeModernEpgCard', 'fixTableHeight', 'layoutTvGuideLabels', 'buildEpgTimelineGrid', 'timelinePosition', 'layoutTimelineLabels', 'updateHourLines', 'updateCurrentEvents', 'hideEpgTooltip', 'updateTimelineNowMarker'].map(functionSource).join('\n');
	const context = runScript(source, {jQuery, tableNode: table, tooltip: {}, tooltipTimeout: null, clearTimeout,
		scope: {find: () => ({removeAttr() {}})}, config: {mode: mode === 'Zeitschrift' ? 1 : 2},
		window: {get innerHeight() { return state.viewport; }}});
	return {state, resize: () => context.fixTableHeight()};
}

test('EPG-Karte und Tabelle füllen den verfügbaren Platz nach Browser-Zoom in beiden Ansichten', () => {
	for (const mode of ['Zeitschrift', 'Zeitstrahl']) {
		const {state, resize} = layout(900, 120, 370, mode);
		resize();
		assert.equal(state.cardHeight, 760, mode);
		assert.equal(state.tableHeight, 490, mode);
		assert.equal(state.tableWidth, 820, mode);
		state.viewport = 1200;
		state.cardTop = 80;
		state.tableTop = 300;
		resize();
		assert.equal(state.cardHeight, 1100, mode);
		assert.equal(state.tableHeight, 860, mode);
	}
});

test('starker Zoom hält die EPG-Tabelle lesbar statt Navigation und Tabelle zu überlappen', () => {
	const {state, resize} = layout(500, 180, 460);
	resize();
	assert.equal(state.cardHeight, 440);
	assert.equal(state.tableHeight, 140);
});