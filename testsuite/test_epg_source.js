const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'sourcefiles', 'modern', 'js', 'responsive-multiepg.js'), 'utf8').replace(/\r\n/g, '\n');

function expressionAt(start) {
	assert.notEqual(start, -1, 'EPG source expression is missing');
	for (let end = source.indexOf('}', start); end !== -1; end = source.indexOf('}', end + 1)) {
		const expression = source.slice(start, end + 1);
		try {
			new vm.Script('(' + expression + ')');
			return expression;
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
		}
	}
	throw new Error('Incomplete EPG source expression');
}

function functionSource(name) {
	const match = new RegExp('function\\s+' + name + '\\s*\\(').exec(source);
	assert.ok(match, name + ' must be defined in responsive-multiepg.js');
	return expressionAt(match.index);
}

function callbackSource(registration) {
	const start = source.indexOf(registration);
	assert.notEqual(start, -1, registration + ' must be defined in responsive-multiepg.js');
	return expressionAt(source.indexOf('function', start));
}

function iifeSource(marker) {
	const position = source.indexOf(marker);
	assert.notEqual(position, -1, marker + ' must be defined in responsive-multiepg.js');
	const start = source.lastIndexOf('(function()', position);
	return '(' + expressionAt(start === -1 ? -1 : start + 1) + ')();';
}

function sourceSection(beginning, ending) {
	const start = source.indexOf(beginning);
	const end = source.indexOf(ending, start);
	assert.ok(start !== -1 && end > start, 'EPG source section is missing: ' + beginning);
	return source.slice(start, end);
}

function runScript(script, values = {}) {
	const context = vm.createContext({config: {mode: 1, day: 0, week: 0, first: 0, slotStart: 0}, guideGrid: null, timelineGrid: null, ...values});
	vm.runInContext(fs.readFileSync(path.join(root, 'sourcefiles', 'modern', 'js', 'epgtime.js'), 'utf8'), context);
	if (context.window) {
		context.EpgTime = context.window.EpgTime;
		context.root = context.window;
	}
	vm.runInContext(script, context);
	return context;
}

function readCss() {
	return fs.readFileSync(path.join(root, 'sourcefiles', 'modern', 'css', 'multiepg.css'), 'utf8');
}

module.exports = {source, functionSource, callbackSource, iifeSource, sourceSection, runScript, readCss};