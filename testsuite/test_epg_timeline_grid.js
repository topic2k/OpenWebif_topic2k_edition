const assert = require('node:assert/strict');
const {test} = require('node:test');
const {functionSource, runScript} = require('./test_epg_source');

function gridFor(constraints, finish = 86400) {
	const context = runScript(['buildEpgTimelineGrid', 'epgGuideValue', 'timelinePosition', 'timelineTimeAt', 'epgTimelineNowPosition'].map(functionSource).join('\n'));
	context.timelineGrid = context.buildEpgTimelineGrid(0, finish, constraints);
	return context;
}

test('Zeitstrahl ohne kurze Titel behält sechs Sekunden pro Pixel', () => {
	const layout = gridFor([{start: 3600, end: 7200, width: 200}]);
	for (const time of [0, 3600, 7200, 86399, 86400]) {
		assert.equal(layout.timelinePosition(time), 140 + time / 6);
		assert.equal(layout.timelineTimeAt(140 + time / 6), time);
	}
});

test('Kurze Sendungen erhalten senderübergreifend die Breite des längsten Titels', () => {
	const layout = gridFor([{start: 7200, end: 7380, width: 100}, {start: 7200, end: 7380, width: 500}]);
	assert.equal(layout.timelinePosition(7200), 1340);
	assert.equal(layout.timelinePosition(7380) - layout.timelinePosition(7200), 500);
	assert.equal(layout.timelinePosition(7440), 1850);
	assert.equal(layout.timelinePosition(7260), 1340 + 500 / 3);
	assert.equal(layout.timelineTimeAt(1340 + 500 / 3), 7260);
	layout.EpgTime.now = () => 7260;
	assert.equal(layout.epgTimelineNowPosition(), 1340 + 500 / 3, 'Jetzt-Markierung nutzt dasselbe Zeitraster');
});

test('Versetzte Sendungen bleiben monoton, vollständig und ohne Überschneidungen', () => {
	const constraints = [{start: 7100, end: 7200, width: 150}, {start: 7140, end: 7300, width: 390},
		{start: 7200, end: 7260, width: 140}, {start: 7260, end: 7380, width: 160}];
	const layout = gridFor(constraints);
	for (const event of constraints) assert.ok(layout.timelinePosition(event.end) - layout.timelinePosition(event.start) >= event.width);
	for (let time = 7000; time < 7400; time++) {
		assert.ok(layout.timelinePosition(time + 1) > layout.timelinePosition(time));
		assert.ok(Math.abs(layout.timelineTimeAt(layout.timelinePosition(time)) - time) < 0.000001);
	}
});

test('Kurze Titel am Ende mehrtägiger Zeitstrahlen passen vor die gemeinsame Endgrenze', () => {
	const constraints = Array.from({length: 120}, (_, index) => ({start: 165600 + index * 60, end: 165660 + index * 60, width: 200}));
	const layout = gridFor(constraints, 172800);
	for (const event of constraints) assert.equal(layout.timelinePosition(event.end) - layout.timelinePosition(event.start), 200);
	assert.equal(layout.timelinePosition(172800), 140 + 165600 / 6 + 120 * 200);
});

test('Leere und ungültige Zeitbereiche erzeugen kein degeneriertes Zeitraster', () => {
	const layout = gridFor([], 0);
	assert.equal(layout.timelineGrid, null);
	assert.equal(layout.timelinePosition(0), 140);
	assert.equal(layout.buildEpgTimelineGrid(0, NaN, []), null);
});