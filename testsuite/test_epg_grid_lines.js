const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const {functionSource, runScript} = require('./test_epg_source');

function hourLines(hourlyLines, constraints = [], start = new Date(2026, 8, 28).getTime() / 1000, mode = 1) {
	const surfaces = Array.from({length: 12}, (_, slot) => ({
		dataset: {slot}, lines: [],
		querySelectorAll() { return this.lines.slice(); },
		appendChild(line) { this.lines.push(line); line.remove = () => this.lines.splice(this.lines.indexOf(line), 1); }
	}));
	const context = runScript(['buildEpgGuideGrid', 'epgGuideValue', 'guidePosition', 'updateHourLines'].map(functionSource).join('\n'), {
		config: {mode, slotStart: start, hourlyLines},
		tableNode: {querySelectorAll: () => surfaces},
		document: {createElement: () => ({dataset: {}, style: {}, setAttribute() {}})}
	});
	context.guideGrid = context.buildEpgGuideGrid(start, constraints);
	context.updateHourLines();
	return {context, surfaces, lines: () => surfaces.flatMap(surface => surface.lines)};
}

test('Zeitschrift zeichnet standardmäßig jede volle Stunde, optional alle zwei Stunden', () => {
	for (const [option, interval] of [[undefined, 1], [true, 1], [false, 2]]) {
		const ui = hourLines(option);
		assert.equal(ui.lines().length, 24 / interval);
		for (const line of ui.lines()) {
			const date = new Date(line.dataset.time * 1000);
			assert.equal(date.getMinutes(), 0);
			assert.equal(date.getHours() % interval, 0);
		}
		ui.context.updateHourLines();
		assert.equal(ui.lines().length, 24 / interval, 'Neuberechnung erzeugt keine doppelten Linien');
	}
	assert.equal(hourLines(false, [], new Date(2026, 8, 28, 3).getTime() / 1000).lines().length, 12);
	assert.equal(hourLines(true, [], undefined, 2).lines().length, 0, 'Stundenlinien gelten nur für die Zeitschrift');
});

test('Stundenlinien folgen dem für kurze Titel gestreckten Zeitraster', () => {
	const start = new Date(2026, 8, 28).getTime() / 1000;
	const ui = hourLines(true, [{start: start + 600, end: start + 660, height: 80}], start);
	assert.ok(ui.context.guidePosition(start + 3600) > 240);
	for (const surface of ui.surfaces) {
		for (const line of surface.lines) {
			assert.equal(parseFloat(line.style.top), ui.context.guidePosition(line.dataset.time) -
				ui.context.guidePosition(start + surface.dataset.slot * 7200));
		}
	}
	ui.context.config.hourlyLines = false;
	ui.context.updateHourLines();
	assert.equal(ui.lines().length, 12);
});

for (const filename of ['sourcefiles/modern/js/responsive.js', 'plugin/public/modern/js/responsive.min.js']) {
	for (const key of ['epg_hourly_lines', 'epg_channel_lines']) {
		test(filename + ': ' + key + ' aktualisiert die Ansicht erst nach erfolgreichem Speichern', () => {
			const handlers = new Map(), requests = [], events = [], window = {};
			const checkbox = {id: key, checked: false};
			const $ = selector => {
				if (selector === checkbox) return {is: () => checkbox.checked};
				if (selector === window) return {trigger: (name, args) => events.push({name, args})};
				return {change: handler => handlers.set(selector, handler)};
			};
			$.get = (url, done) => requests.push({url, done});
			const context = {$, window};
			vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'), context);
			context.WebConfig();
			for (const checked of [false, true]) {
				checkbox.checked = checked;
				handlers.get('#epg_hourly_lines, #epg_channel_lines').call(checkbox);
				assert.equal(requests.at(-1).url, 'api/setwebconfig?' + key + '=' + (checked ? '1' : '0'));
				const count = events.length;
				requests.at(-1).done({result: false});
				assert.equal(events.length, count);
				requests.at(-1).done({result: true});
				assert.equal(events.length, count + 1);
				assert.equal(events.at(-1).name, 'epgGridSettings');
				assert.equal(JSON.stringify(events.at(-1).args), JSON.stringify([
					{[key === 'epg_hourly_lines' ? 'hourlyLines' : 'channelLines']: checked}
				]));
			}
		});
	}
}