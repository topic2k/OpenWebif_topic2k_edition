const assert = require('node:assert/strict');
const {test} = require('node:test');
const {functionSource, runScript} = require('./test_epg_source');

function gridFor(constraints) {
	const context = runScript(['buildEpgGuideGrid', 'epgGuideValue', 'guidePosition', 'guideTimeAt'].map(functionSource).join('\n'));
	context.guideGrid = context.buildEpgGuideGrid(0, constraints);
	return context;
}

test('Ohne kurze Titel bleibt das ursprüngliche Zeitraster erhalten', () => {
	const layout = gridFor([{start: 3600, end: 7200, height: 40}]);
	for (const time of [0, 3600, 7200, 86399, 86400]) {
		assert.equal(layout.guidePosition(time), time / 15);
		assert.equal(layout.guideTimeAt(time / 15), time);
	}
});

test('Kurze Sendungen erhalten senderübergreifend Platz für den größten Titel', () => {
	const layout = gridFor([{start: 7200, end: 7380, height: 24}, {start: 7200, end: 7380, height: 80}]);
	assert.equal(layout.guidePosition(7200), 480);
	assert.equal(layout.guidePosition(7380) - layout.guidePosition(7200), 80);
	assert.equal(layout.guidePosition(7440), 564);
	assert.equal(layout.guidePosition(7260), 480 + 80 / 3);
	assert.equal(layout.guideTimeAt(480 + 80 / 3), 7260);
});

test('Versetzte kurze Sendungen und Slotgrenzen bleiben monoton und überlappungsfrei', () => {
	const constraints = [{start: 7100, end: 7200, height: 50}, {start: 7140, end: 7300, height: 90},
		{start: 7200, end: 7260, height: 40}, {start: 7260, end: 7380, height: 60}];
	const layout = gridFor(constraints);
	for (const event of constraints) assert.ok(layout.guidePosition(event.end) - layout.guidePosition(event.start) >= event.height);
	for (let time = 7000; time < 7400; time++) {
		assert.ok(layout.guidePosition(time + 1) > layout.guidePosition(time));
		assert.ok(Math.abs(layout.guideTimeAt(layout.guidePosition(time)) - time) < 0.000001);
	}
});

test('Dichte Titel am Tagesende passen vollständig vor die gemeinsame Tagesgrenze', () => {
	const constraints = Array.from({length: 120}, (_, index) => ({start: 79200 + index * 60, end: 79260 + index * 60, height: 48}));
	const layout = gridFor(constraints);
	for (const event of constraints) assert.equal(layout.guidePosition(event.end) - layout.guidePosition(event.start), 48);
	assert.equal(layout.guidePosition(86400), 79200 / 15 + 120 * 48);
});