const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const {functionSource, runScript} = require('./test_epg_source');

function colors(pixels) {
	return sharedColors([pixels]);
}

function sharedColors(picons) {
	const context = runScript(functionSource('epgPiconColors'));
	const result = context.epgPiconColors(picons.map(pixels => Uint8ClampedArray.from(pixels.flat())));
	return result && {background: result.background, highlight: result.highlight, foreground: result.foreground};
}

function luminance(rgb) {
	const channels = rgb.match(/\d+/g).map(Number).map(value => {
		value /= 255;
		return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
	});
	return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first, second) {
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('Picons bestimmen einen nicht zu dunklen Hintergrund mit dezentem Verlauf und lesbarem Text', () => {
	for (const value of [0, 32, 128, 220, 255]) {
		const result = colors([[value, value, value, 255]]);
		const shade = Number(result.background.match(/\d+/)[0]);
		const highlight = Number(result.highlight.match(/\d+/)[0]);
		assert.ok(shade >= 150 && shade <= 230);
		assert.equal(highlight - shade, 12);
		for (const stop of [result.background, result.highlight]) {
			assert.ok(contrast(luminance(stop), luminance(result.foreground)) >= 4.5);
		}
	}
	assert.notEqual(colors([[0, 0, 0, 255]]).background, colors([[255, 255, 255, 255]]).background);
});

test('Alle Picons tragen unabhängig von Größe und Reihenfolge zur gemeinsamen Farbe bei', () => {
	const white = [[255, 255, 255, 255]], black = [[0, 0, 0, 255]];
	const result = sharedColors([white, black]);
	assert.deepEqual(result, sharedColors([black, white]));
	assert.deepEqual(result, sharedColors([white, Array.from({length: 100}, () => black[0])]));
	assert.deepEqual(result, colors(white.concat(black)));
	assert.notEqual(result.background, colors(black).background);
	for (const stop of [result.background, result.highlight]) {
		assert.ok(contrast(luminance(stop), 0) >= 7);
		assert.ok(contrast(luminance(stop), 1) >= 2.5);
	}
});

test('Kleine Schriftanteile beeinflussen die Auswahl statt nur einer gemittelten Logofarbe', () => {
	const pixels = Array.from({length: 90}, () => [230, 0, 0, 255]);
	const red = colors(pixels);
	pixels.push(...Array.from({length: 10}, () => [255, 255, 255, 255]));
	const result = colors(pixels);
	assert.ok(luminance(result.background) < luminance(red.background));
	assert.ok(contrast(luminance(result.highlight), 1) > contrast(luminance(red.highlight), 1));
	assert.ok(contrast(luminance(result.background), luminance(result.foreground)) >= 4.5);
});

test('Transparente Ränder beeinflussen den Hintergrund nicht, leere Bilder bleiben unverändert', () => {
	const white = [[255, 255, 255, 255]];
	assert.deepEqual(colors(white.concat(Array.from({length: 100}, () => [0, 0, 0, 0]))), colors(white));
	assert.equal(colors([[255, 255, 255, 0], [0, 0, 0, 12]]), null);
	assert.equal(colors([]), null);
	assert.equal(sharedColors([]), null);
	assert.deepEqual(sharedColors([[], white, [[255, 255, 255, 0]]]), colors(white));
});

test('Teiltransparente Picons werden mit dem berechneten Hintergrund zusammengesetzt', () => {
	const result = colors([[255, 255, 255, 128], [0, 0, 0, 128]]);
	for (const stop of [result.background, result.highlight]) {
		const shade = Number(stop.match(/\d+/)[0]);
		for (const value of [0, 255]) {
			const composite = Math.round(value * 128 / 255 + shade * 127 / 255);
			assert.ok(contrast(luminance(stop), luminance(`rgb(${composite}, ${composite}, ${composite})`)) > 1.5);
		}
		assert.ok(contrast(luminance(stop), luminance(result.foreground)) >= 4.5);
	}
});

test('Ausgelieferte Styles verwenden einen Verlauf aus den gemeinsam berechneten Farben', () => {
	const css = fs.readFileSync(path.join(__dirname, '..', 'plugin/public/modern/css/multiepg.min.css'), 'utf8');
	const rule = css.match(/[^}]*epg__channel--adaptive[^}]*\}/);
	assert.ok(rule);
	assert.match(rule[0], /background(?:-color)?:var\(--epg-channel-background\)/);
	assert.match(rule[0], /linear-gradient\([^;]*var\(--epg-channel-highlight\)[^;]*var\(--epg-channel-background\)/);
});