var reloadTimers = false;

(function(root) {
	var disposeCurrent;

	function resizeModernEpgCard() {
		var card = jQuery('#epgcard');
		if (!card.length) return;
		var cardTop = card[0].getBoundingClientRect().top;
		var table = jQuery('#fulltbl');
		var minHeight = 320;
		if (table.length) {
			var bottomPadding = parseFloat(jQuery('#epgcard > .body').css('padding-bottom')) || 0;
			minHeight = table[0].getBoundingClientRect().top - cardTop + 140 + bottomPadding;
		}
		card.height(Math.max(window.innerHeight - cardTop - 20, minHeight));
	}

	function initShell() {
		resizeModernEpgCard();
		jQuery(function() {
			load_tvcontent_spin('ajax/multiepg?epgmode=tv');
		});
		jQuery.AdminBSB.input.activate();
	}

	function startEpgNowMarker(marker, update) {
		if (!marker.length) return;
		var node = marker[0];
		var interval;
		var observer = new MutationObserver(function() {
			if (!jQuery.contains(document, node)) stop();
		});
		function stop() {
			clearInterval(interval);
			observer.disconnect();
			jQuery(window).off('resize.epgNowMarker', update).off('pagehide.epgNowMarker', onPageHide);
		}
		function onPageHide(event) {
			stop();
			if (event.originalEvent && event.originalEvent.persisted) {
				jQuery(window).one('pageshow.epgNowMarker', function() {
					if (jQuery.contains(document, node)) startEpgNowMarker(marker, update);
				});
			}
		}
		update();
		interval = setInterval(function() {
			if (!jQuery.contains(document, node)) {
				stop();
				return;
			}
			update();
		}, 10000);
		observer.observe(document.body, {childList: true, subtree: true});
		jQuery(window).on('resize.epgNowMarker', update).on('pagehide.epgNowMarker', onPageHide);
		return stop;
	}

	function epgKeepVisibleShift(start, end, size, edge) {
		return Math.max(0, Math.min(edge - start, end - start - size));
	}

	function buildEpgGuideGrid(start, constraints) {
		var times = new Set();
		var endings = {};
		for (var slot = 0; slot <= 12; slot++) times.add(start + slot * 7200);
		constraints.forEach(function(event) {
			times.add(event.start);
			times.add(event.end);
			if (!endings[event.end]) endings[event.end] = [];
			endings[event.end].push(event);
		});
		var positions = {};
		var grid = [];
		Array.from(times).sort(function(a, b) { return a - b; }).forEach(function(time, index) {
			var previous = grid[index - 1];
			var position = previous ? previous.position + (time - previous.time) / EpgTime.guideSecondsPerPixel : 0;
			(endings[time] || []).forEach(function(event) {
				position = Math.max(position, Math.ceil(positions[event.start] + event.height));
			});
			positions[time] = position;
			grid.push({time: time, position: position});
		});
		return grid;
	}

	function buildEpgTimelineGrid(start, finish, constraints) {
		if (!isFinite(start) || !isFinite(finish) || finish <= start) return null;
		var times = new Set([start, finish]);
		var endings = {};
		constraints.forEach(function(event) {
			times.add(event.start);
			times.add(event.end);
			if (!endings[event.end]) endings[event.end] = [];
			endings[event.end].push(event);
		});
		var positions = {};
		var grid = [];
		Array.from(times).sort(function(a, b) { return a - b; }).forEach(function(time, index) {
			var previous = grid[index - 1];
			var position = previous ? previous.position + EpgTime.timelinePosition(time, previous.time) - 140 : 0;
			(endings[time] || []).forEach(function(event) {
				position = Math.max(position, Math.ceil(positions[event.start] + event.width));
			});
			positions[time] = position;
			grid.push({time: time, position: position});
		});
		return grid;
	}

	function epgGuideValue(grid, value, from, to) {
		var low = 0, high = grid.length - 1;
		while (high - low > 1) {
			var middle = Math.floor((low + high) / 2);
			if (grid[middle][from] <= value) low = middle;
			else high = middle;
		}
		var first = grid[low], last = grid[high];
		return first[to] + (value - first[from]) / (last[from] - first[from]) * (last[to] - first[to]);
	}

	function epgPiconColors(pixels) {
		var linear = [];
		for (var channel = 0; channel < 256; channel++) {
			var value = channel / 255;
			linear.push(value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
		}
		var histogram = {};
		pixels.forEach(function(picon) {
			var entries = {}, weight = 0;
			for (var index = 0; index < picon.length; index += 4) {
				var alpha = picon[index + 3] / 255;
				if (alpha < 0.125) continue;
				var red = picon[index], green = picon[index + 1], blue = picon[index + 2];
				var luminance = 0.2126 * linear[red] + 0.7152 * linear[green] + 0.0722 * linear[blue];
				var key = Math.round(luminance * 31) * 8 + Math.round(alpha * 7);
				var bin = entries[key] || (entries[key] = {red: 0, green: 0, blue: 0, alpha: 0, weight: 0});
				bin.red += red * alpha;
				bin.green += green * alpha;
				bin.blue += blue * alpha;
				bin.alpha += alpha * alpha;
				bin.weight += alpha;
				weight += alpha;
			}
			// Give each logo equal influence, independent of size and transparent margins.
			Object.keys(entries).forEach(function(key) {
				var bin = entries[key];
				var combined = histogram[key] || (histogram[key] = {red: 0, green: 0, blue: 0, alpha: 0, weight: 0});
				combined.red += bin.red / weight;
				combined.green += bin.green / weight;
				combined.blue += bin.blue / weight;
				combined.alpha += bin.alpha / weight;
				combined.weight += bin.weight / weight;
			});
		});
		var bins = Object.keys(histogram).map(function(key) {
			var bin = histogram[key];
			bin.red /= bin.weight;
			bin.green /= bin.weight;
			bin.blue /= bin.weight;
			bin.alpha /= bin.weight;
			return bin;
		});
		if (!bins.length) return null;
		var bestShade = 150, bestPenalty = Infinity;
		// Keep the shared gradient light enough and evaluate contrast at both ends.
		for (var shade = 150; shade <= 230; shade++) {
			var penalty = 0;
			bins.forEach(function(bin) {
				for (var stop = shade; stop <= shade + 12; stop += 12) {
					var backgroundPart = stop * (1 - bin.alpha);
					var composite = 0.2126 * linear[Math.round(bin.red * bin.alpha + backgroundPart)] +
						0.7152 * linear[Math.round(bin.green * bin.alpha + backgroundPart)] +
						0.0722 * linear[Math.round(bin.blue * bin.alpha + backgroundPart)];
					var contrast = (Math.max(composite, linear[stop]) + 0.05) / (Math.min(composite, linear[stop]) + 0.05);
					penalty += bin.weight / (contrast * contrast * contrast * contrast);
				}
			});
			if (penalty < bestPenalty) {
				bestPenalty = penalty;
				bestShade = shade;
			}
		}
		return {
			background: 'rgb(' + bestShade + ', ' + bestShade + ', ' + bestShade + ')',
			highlight: 'rgb(' + (bestShade + 12) + ', ' + (bestShade + 12) + ', ' + (bestShade + 12) + ')',
			foreground: (linear[bestShade] + 0.05) / 0.05 >= 1.05 / (linear[bestShade] + 0.05) ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)'
		};
	}

	function startEpgPiconContrast(container) {
		var active = true;
		var images = Array.from(container.querySelectorAll('.serviceheader img, .epg__channel-col .picon img'));
		var headers = Array.from(container.querySelectorAll('.serviceheader, .epg__channel-col'));
		var samples = new Map();
		var pending = true;
		function applyColors() {
			pending = false;
			if (!active) return;
			var colors = epgPiconColors(Array.from(samples.values()));
			headers.forEach(function(header) {
				if (colors) {
					header.style.setProperty('--epg-channel-background', colors.background);
					header.style.setProperty('--epg-channel-highlight', colors.highlight);
					header.style.setProperty('--epg-channel-foreground', colors.foreground);
					header.classList.add('epg__channel--adaptive');
				} else {
					header.classList.remove('epg__channel--adaptive');
					header.style.removeProperty('--epg-channel-background');
					header.style.removeProperty('--epg-channel-highlight');
					header.style.removeProperty('--epg-channel-foreground');
				}
			});
		}
		function update() {
			if (!active || !container.contains(this)) return;
			samples.delete(this);
			if (this.complete) {
				this.style.display = this.naturalWidth ? '' : 'none';
				if (this.naturalWidth && this.naturalHeight) {
					try {
						var canvas = document.createElement('canvas');
						var scale = Math.min(1, 64 / Math.max(this.naturalWidth, this.naturalHeight));
						canvas.width = Math.max(1, Math.round(this.naturalWidth * scale));
						canvas.height = Math.max(1, Math.round(this.naturalHeight * scale));
						var context = canvas.getContext('2d', {willReadFrequently: true});
						if (context) {
							context.drawImage(this, 0, 0, canvas.width, canvas.height);
							samples.set(this, context.getImageData(0, 0, canvas.width, canvas.height).data);
						}
					} catch (error) {
						// Unreadable images do not influence the shared background.
					}
				}
			}
			if (!pending) {
				pending = true;
				Promise.resolve().then(applyColors);
			}
		}
		var observer = new MutationObserver(function(records) {
			records.forEach(function(record) { update.call(record.target); });
		});
		images.forEach(function(image) {
			image.addEventListener('load', update);
			image.addEventListener('error', update);
			observer.observe(image, {attributes: true, attributeFilter: ['src', 'srcset']});
			if (image.complete) update.call(image);
		});
		applyColors();
		return function() {
			active = false;
			samples.clear();
			observer.disconnect();
			images.forEach(function(image) {
				image.removeEventListener('load', update);
				image.removeEventListener('error', update);
			});
		};
	}

	function init(config) {
		if (disposeCurrent) disposeCurrent();
		var scope = jQuery('#modern-epg');
		var tableNode = document.getElementById('fulltbl');
		if (!scope.length || !tableNode) return;
		var disposed = false;
		var stopMarker;
		var stopPiconContrast = startEpgPiconContrast(tableNode);
		var pending = false;
		var frame;
		var jumpTimeout;
		var visibleTimeout;
		var guideGrid;
		var timelineGrid;
		var tooltipTimeout;
		var tooltip = jQuery('<div class="epg__tooltip" role="tooltip" id="epg-tooltip" hidden></div>').appendTo(scope)[0];
		var observer = new MutationObserver(function() {
			if (!jQuery.contains(document, tableNode)) dispose();
		});
		function alive() {
			return !disposed && document.getElementById('fulltbl') === tableNode;
		}
		function dispose() {
			disposed = true;
			if (stopMarker) stopMarker();
			stopPiconContrast();
			clearTimeout(jumpTimeout);
			clearTimeout(visibleTimeout);
			hideEpgTooltip();
			tooltip.remove();
			scope.off('.epgTooltip');
			cancelAnimationFrame(frame);
			observer.disconnect();
			tableNode.removeEventListener('scroll', schedule);
			jQuery(window).off('.epgTable .epgKeepVisible .epgNowMarker');
			jQuery(document).off('.epgCalendar');
			if (disposeCurrent === dispose) disposeCurrent = null;
		}
		disposeCurrent = dispose;
		observer.observe(document.body, {childList: true, subtree: true});
		reloadTimers = false;

		function timelinePosition(time) {
			return timelineGrid ? 140 + epgGuideValue(timelineGrid, time, 'time', 'position') : EpgTime.timelinePosition(time, config.first);
		}

		function timelineTimeAt(position) {
			return timelineGrid ? epgGuideValue(timelineGrid, position - 140, 'position', 'time') : config.first + (position - 140) * 6;
		}

		function epgTimelineNowPosition() {
			return timelinePosition(EpgTime.now());
		}

		function clampTimelineScroll(left) {
			return Math.max(0, Math.min(left, tableNode.scrollWidth - tableNode.clientWidth));
		}

		function guidePosition(time) {
			return guideGrid ? epgGuideValue(guideGrid, time, 'time', 'position') : EpgTime.guidePosition(time, config.slotStart);
		}

		function guideTimeAt(position) {
			return guideGrid ? epgGuideValue(guideGrid, position, 'position', 'time') : config.slotStart + position * EpgTime.guideSecondsPerPixel;
		}

		function updateHourLines() {
			if (config.mode !== 1) return;
			var interval = config.hourlyLines === false ? 2 : 1;
			tableNode.querySelectorAll('.epg__slot').forEach(function(surface) {
				surface.querySelectorAll('.epg__hour-line').forEach(function(line) { line.remove(); });
				var start = config.slotStart + Number(surface.dataset.slot) * 7200;
				var hour = EpgTime.dateAt(start);
				hour.setMinutes(0, 0, 0);
				for (var time = hour.getTime() / 1000; time < start + 7200; time += 3600) {
					if (time < start || EpgTime.dateAt(time).getHours() % interval) continue;
					var line = document.createElement('div');
					line.className = 'epg__hour-line';
					line.setAttribute('aria-hidden', 'true');
					line.dataset.time = time;
					line.style.top = guidePosition(time) - guidePosition(start) + 'px';
					surface.appendChild(line);
				}
			});
		}
		scope.toggleClass('epg--channel-lines', config.channelLines !== false);
		jQuery(window).on('epgGridSettings.epgTable', function(event, options) {
			if (!alive()) return;
			if (options.hourlyLines !== undefined) config.hourlyLines = options.hourlyLines;
			if (options.channelLines !== undefined) config.channelLines = options.channelLines;
			scope.toggleClass('epg--channel-lines', config.channelLines !== false);
			fixTableHeight();
			if (config.mode === 1 && config.day === 0 && config.week === 0) updateTvGuideNowMarker();
			schedule();
		});

		function updateEpgDateRange() {
			if (!alive()) return;
			var container = tableNode;
			var label = document.getElementById('epg-date-range');
			if (!container || !label) return;
			var bounds = container.getBoundingClientRect();
			var dates = {};
			function addDate(timestamp) {
				if (!isFinite(timestamp)) return;
				var date = EpgTime.dateAt(timestamp);
				if (isNaN(date.getTime())) return;
				dates[EpgTime.dateKey(date)] = date;
			}
			function visible(rect) {
				return rect.bottom > bounds.top && rect.top < bounds.bottom && rect.right > bounds.left && rect.left < bounds.right;
			}
			if (container.classList.contains('epg__tv-guide')) {
				var slotStart = Number(container.getAttribute('data-slot-start'));
				var origin = guideGrid && container.querySelector('.epg__slot');
				var originTop = origin ? origin.getBoundingClientRect().top : bounds.top;
				container.querySelectorAll('#tbl1body tr').forEach(function(row, index) {
					var rect = row.getBoundingClientRect();
					if (!visible(rect)) return;
					// Use the row's two-hour slot even when its channel has no EPG events.
					if (guideGrid) {
						addDate(Math.max(slotStart + index * 7200, guideTimeAt(Math.max(bounds.top, rect.top) - originTop)));
						addDate(Math.min(slotStart + (index + 1) * 7200, guideTimeAt(Math.min(bounds.bottom, rect.bottom) - originTop)) - 1);
					} else {
						var startFraction = Math.max(0, (bounds.top - rect.top) / (rect.bottom - rect.top));
						var endFraction = Math.min(1, (bounds.bottom - rect.top) / (rect.bottom - rect.top));
						addDate(EpgTime.slotTime(slotStart, index, startFraction));
						addDate(EpgTime.slotTime(slotStart, index, endFraction) - 1);
					}
				});
				container.querySelectorAll('.epg__event[data-begin]').forEach(function(event) {
					if (visible(event.getBoundingClientRect())) addDate(Number(event.getAttribute('data-begin')));
				});
			} else {
				var first = Number(container.getAttribute('data-first'));
				var range = EpgTime.timelineWindow(first, container.scrollLeft, container.clientWidth,
					Number(container.getAttribute('data-timeline-end')));
				if (timelineGrid) {
					var visibleStart = Math.max(first, timelineTimeAt(container.scrollLeft + 140));
					var visibleEnd = Math.min(config.timelineEnd, timelineTimeAt(container.scrollLeft + container.clientWidth));
					range = visibleEnd > visibleStart ? {start: visibleStart, end: visibleEnd - 1} : null;
				}
				if (range) {
					var start = range.start;
					addDate(start);
					addDate(range.end);
					container.querySelectorAll('.epg__timeline-row').forEach(function(row) {
						if (!visible(row.getBoundingClientRect())) return;
						row.querySelectorAll('.eventlist .event[data-begin]').forEach(function(event) {
							var begin = Number(event.getAttribute('data-begin'));
							if (begin < start && Number(event.getAttribute('data-end')) > start && visible(event.getBoundingClientRect())) addDate(begin);
						});
					});
				}
			}
			var days = Object.keys(dates).map(function(key) { return dates[key]; }).sort(function(a, b) { return a - b; });
			if (!days.length) days = [EpgTime.dateAt(config.slotStart)];
			label.textContent = days.map(function(date) {
				return EpgTime.formatDate(date, config.dateLabels);
			}).join(' / ');
		}

		function layoutTvGuide() {
			if (!tableNode.classList.contains('epg__tv-guide')) return;
			tableNode.querySelectorAll('.epg__slot').forEach(function(surface) {
				var slotTime = config.slotStart + Number(surface.getAttribute('data-slot')) * 7200;
				var slotOffset = guidePosition(slotTime);
				surface.style.height = guidePosition(slotTime + 7200) - slotOffset + 'px';
				surface.querySelectorAll('.epg__event[data-begin][data-end]').forEach(function(event) {
					var interval = EpgTime.interval(Number(event.getAttribute('data-begin')), Number(event.getAttribute('data-end')),
						config.slotStart, config.slotStart + 86400, EpgTime.guideSecondsPerPixel);
					event.style.display = interval ? '' : 'none';
					if (!interval) return;
					event.style.top = guidePosition(interval.start) - slotOffset + 'px';
					event.style.height = (guideGrid ? guidePosition(interval.end) - guidePosition(interval.start) : interval.length) + 'px';
				});
			});
		}
		layoutTvGuide();

		function layoutTvGuideLabels() {
			if (!tableNode.classList.contains('epg__tv-guide')) return;
			var origin = tableNode.querySelector('.epg__slot');
			if (!origin) return;
			var constraints = [];
			var events = tableNode.querySelectorAll('.epg__event[data-begin]');
			events.forEach(function(event) {
				var info = event.querySelector('.epg__event-info');
				info.style.maxHeight = 'none';
				info.style.top = '';
				info.style.transform = '';
				info._epgShift = 0;
				event.classList.remove('epg__details-hidden');
				var interval = EpgTime.interval(Number(event.dataset.begin), Number(event.dataset.end),
					config.slotStart, config.slotStart + 86400, EpgTime.guideSecondsPerPixel);
				if (!interval) return;
				var title = event.querySelector('.epg__title');
				var time = event.querySelector('.epg__time--start');
				constraints.push({start: interval.start, end: interval.end,
					height: Math.ceil(Math.max(title.getBoundingClientRect().height, time.getBoundingClientRect().height)) + 4});
			});
			guideGrid = buildEpgGuideGrid(config.slotStart, constraints);
			layoutTvGuide();
			events.forEach(function(event) {
				if (event.style.display === 'none') return;
				var info = event.querySelector('.epg__event-info');
				event.classList.toggle('epg__details-hidden', info.getBoundingClientRect().height > event.getBoundingClientRect().height - 4);
				info.style.maxHeight = '100%';
			});
		}

		function layoutTimelineLabels() {
			if (config.mode !== 2) return;
			var events = tableNode.querySelectorAll('.eventlist .event[data-begin][data-end]');
			var constraints = [];
			events.forEach(function(event) {
				event.classList.remove('epg__details-hidden');
				var info = event.querySelector('.epg__timeline-info');
				info.style.transform = '';
				info._epgShift = 0;
				var interval = EpgTime.interval(Number(event.dataset.begin), Number(event.dataset.end), config.first, config.timelineEnd, 6);
				if (!interval) return;
				constraints.push({start: interval.start, end: interval.end, width: Math.ceil(event.querySelector('.ename').getBoundingClientRect().width) + 1});
			});
			timelineGrid = buildEpgTimelineGrid(config.first, config.timelineEnd, constraints);
			tableNode.style.setProperty('--epg-timeline-width', timelinePosition(config.timelineEnd) - 140 + 'px');
			events.forEach(function(event) {
				var interval = EpgTime.interval(Number(event.dataset.begin), Number(event.dataset.end), config.first, config.timelineEnd, 6);
				event.style.display = interval ? '' : 'none';
				if (!interval) return;
				event.style.left = timelinePosition(interval.start) - 140 + 'px';
				event.style.width = timelinePosition(interval.end) - timelinePosition(interval.start) + 'px';
				var time = event.querySelector('.etime');
				event.classList.toggle('epg__details-hidden', event.querySelector('.epg__timeline-info').getBoundingClientRect().height > 58 ||
					time.scrollWidth > event.clientWidth);
			});
		}

		function updateCurrentEvents() {
			var now = EpgTime.now();
			tableNode.querySelectorAll('.event[data-begin][data-end]').forEach(function(event) {
				event.classList.toggle('curevent', Number(event.dataset.begin) <= now && now < Number(event.dataset.end));
			});
		}

		function hideEpgTooltip() {
			clearTimeout(tooltipTimeout);
			tooltip.hidden = true;
			scope.find('[aria-describedby="epg-tooltip"]').removeAttr('aria-describedby');
		}

		scope.on('mouseenter.epgTooltip focusin.epgTooltip', '.event[data-begin]', function(event) {
			hideEpgTooltip();
			if (event.target.closest('.epg__timer-marker')) return;
			var programme = this;
			var details = programme.querySelector('.epg__desc');
			var timelineDetails = programme.querySelector('.epg__tooltip-details');
			if (!programme.classList.contains('epg__details-hidden') && (!details || details.scrollHeight <= details.clientHeight) &&
				(!timelineDetails || !timelineDetails.textContent.trim())) return;
			tooltipTimeout = setTimeout(function() {
				if (!alive()) return;
				var title = programme.querySelector('.epg__title, .ename');
				var description = programme.querySelector('.epg__desc, .epg__tooltip-details');
				if (description) {
					description = description.cloneNode(true);
					description.querySelectorAll('.epg__timer-status').forEach(function(status) { status.remove(); });
				}
				tooltip.textContent = (title.dataset.epgTitle || title.textContent.trim()) + '\n' + EpgTime.dateAt(Number(programme.dataset.begin)).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) +
					' – ' + EpgTime.dateAt(Number(programme.dataset.end)).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) +
					(description ? '\n' + description.textContent.trim() : '');
				tooltip.hidden = false;
				var rect = programme.getBoundingClientRect();
				tooltip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - tooltip.offsetWidth - 8)) + 'px';
				tooltip.style.top = Math.max(8, Math.min(rect.top + 24, window.innerHeight - tooltip.offsetHeight - 8)) + 'px';
				programme.setAttribute('aria-describedby', 'epg-tooltip');
			}, 1500);
		}).on('mouseleave.epgTooltip focusout.epgTooltip click.epgTooltip', '.event[data-begin]', hideEpgTooltip)
			.on('keydown.epgTooltip', function(event) { if (event.key === 'Escape') hideEpgTooltip(); });
		scope.on('scroll.epgTooltip', '#fulltbl', hideEpgTooltip);

		function updateKeepVisible() {
			pending = false;
			if (!alive()) return;
			var container = tableNode;
			var bounds = container.getBoundingClientRect();
			if (container.classList.contains('epg__tv-guide')) {
				var header = container.querySelector('.serviceheader');
				var edge = bounds.top + (header ? header.offsetHeight : 0);
				container.querySelectorAll('.epg__event[data-begin]').forEach(function(event) {
					var eventBounds = event.getBoundingClientRect();
					if (eventBounds.bottom <= edge || eventBounds.top >= bounds.bottom || eventBounds.right <= bounds.left || eventBounds.left >= bounds.right) return;
					var info = event.querySelector('.epg__event-info');
					var start = info.getBoundingClientRect().top - (info._epgShift || 0);
					var shift = epgKeepVisibleShift(start, eventBounds.bottom, info.offsetHeight, edge);
					info.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
					info._epgShift = shift;
				});
			} else {
				var channel = container.querySelector('.epg__channel-col');
				var edge = bounds.left + (channel ? channel.offsetWidth : 0);
				container.querySelectorAll('.epg__timeline-row').forEach(function(row) {
					var rowBounds = row.getBoundingClientRect();
					if (rowBounds.bottom <= bounds.top || rowBounds.top >= bounds.bottom) return;
					row.querySelectorAll('.eventlist .event[data-begin]').forEach(function(event) {
						var eventBounds = event.getBoundingClientRect();
						if (eventBounds.right <= edge || eventBounds.left >= bounds.right) return;
						var info = event.querySelector('.epg__timeline-info');
						var start = info.getBoundingClientRect().left - (info._epgShift || 0);
						var shift = epgKeepVisibleShift(start, eventBounds.right, info.offsetWidth, edge);
						info.style.transform = shift ? 'translateX(' + shift + 'px)' : '';
						info._epgShift = shift;
					});
				});
			}
		}
		function schedule() {
			if (!pending && alive()) {
				pending = true;
				frame = requestAnimationFrame(updateKeepVisible);
			}
		}
		tableNode.addEventListener('scroll', schedule);
		jQuery(window).off('resize.epgKeepVisible').on('resize.epgKeepVisible', schedule);
		schedule();
		visibleTimeout = setTimeout(function() {
			fixTableHeight();
			updateEpgDateRange();
			if (config.mode === 1 && config.day === 0 && config.week === 0) updateTvGuideNowMarker();
			schedule();
		}, 150);

		function fixTableHeight() {
			var table = jQuery('#fulltbl');
			var card = jQuery('#epgcard');
			if (!table.length || !card.length) return;
			resizeModernEpgCard();
			var body = jQuery('#epgcard > .body');
			var bottomPadding = parseFloat(body.css('padding-bottom')) || 0;
			table.height(Math.max(140, card[0].getBoundingClientRect().bottom - table[0].getBoundingClientRect().top - bottomPadding));
			table.width(body.width());
			layoutTvGuideLabels();
			layoutTimelineLabels();
			updateHourLines();
			updateCurrentEvents();
			hideEpgTooltip();
			updateTimelineNowMarker();
		}
		fixTableHeight();
		updateEpgDateRange();
		jQuery('#fulltbl').on('scroll', updateEpgDateRange);
		jQuery(window).off('resize.epgTable').on('resize.epgTable', function(){ fixTableHeight(); updateEpgDateRange(); });

		function updateTvGuideNowMarker() {
			updateCurrentEvents();
			var marker = scope.find('.epg__tv-guide-now');
			var rows = jQuery('#tbl1body tr');
			var slot = EpgTime.slot(EpgTime.now(), config.slotStart);
			if (slot.index < 0 || slot.index >= rows.length) {
				marker.hide();
				return;
			}
			var container = jQuery('#fulltbl');
			var origin = jQuery('#tbl1body .epg__slot').first();
			if (!origin.length) {
				marker.hide();
				return;
			}
			var top = origin.offset().top - container.offset().top + container.scrollTop() + guidePosition(EpgTime.now());
			marker.css({top: top + 'px', width: jQuery('#tbl1').outerWidth() + 'px'}).show();
		}
		function updateTimelineNowMarker() {
			if (config.mode !== 2 || config.day !== 0 || config.week !== 0) return;
			var marker = scope.find('.timetable-now');
			var now = EpgTime.now();
			updateCurrentEvents();
			if (now < config.first || now >= config.timelineEnd) {
				marker.hide();
				return;
			}
			marker.css({left: epgTimelineNowPosition() + 'px', height: scope.find('#tblinner').height()}).show();
		}
		if (config.day === 0 && config.week === 0) {
			if (config.mode === 1) {
				stopMarker = startEpgNowMarker(scope.find('.epg__tv-guide-now'), updateTvGuideNowMarker);
			} else {
				stopMarker = startEpgNowMarker(scope.find('.timetable-now'), updateTimelineNowMarker);
			}
		} else {
			scope.find('.timetable-now').css('height', '0').hide();
		}

		var list = document.getElementById('bqlist');
		var wrap = document.getElementById('bqwrap');
		function updateBouquetHint() {
			wrap.classList.toggle('at-end', list.scrollLeft + list.clientWidth >= list.scrollWidth - 2);
		}
		list.addEventListener('scroll', updateBouquetHint);
		updateBouquetHint();
		scope.find('.bq').click(function() {
			var id = jQuery(this).data('ref');
			jQuery('#tvcontent').html(loadspinner).load('ajax/multiepg?bref=' + id + '&day=' + config.day + '&epgmode=' + config.epgmode);
			SetLSValue('lastmbq_' + config.epgmode, id);
		});

		(function() {
			var toggle = jQuery('#epg-calendar-toggle');
			var popup = jQuery('#epg-calendar-popup');
			var nav = toggle.closest('.nav-tabs');
			var grid = jQuery('#epg-calendar-grid');
			var selected = EpgTime.dateAt(config.slotStart);
			var calendarYear = selected.getFullYear();
			var calendarMonth = selected.getMonth();
			var bouquet = toggle.attr('data-bref');
			var available = window.epgCalendarDaysCache || (window.epgCalendarDaysCache = {});
			var watched = {};
			function loadCalendarDays(year, month) {
				var key = JSON.stringify([bouquet, year, month]);
				var entry = available[key];
				if (!entry) entry = available[key] = {days: null, updated: 0, request: null};
				if (!entry.request && (!entry.days || Date.now() - entry.updated >= 60000)) {
					entry.request = jQuery.getJSON('api/epgcalendar?bref=' + encodeURIComponent(bouquet) + '&year=' + year + '&month=' + (month + 1))
						.done(function(data) {
							if (data.result) {
								entry.days = new Set(data.days);
								entry.updated = Date.now();
							}
						}).always(function() { entry.request = null; });
				}
				if (entry.request && watched[key] !== entry.request) {
					watched[key] = entry.request;
					entry.request.done(function(data) {
						if (data.result && alive() && popup.is(':visible') && year === calendarYear && month === calendarMonth) renderCalendar();
					});
				}
				return entry.days;
			}
			function renderCalendar() {
				var year = calendarYear;
				var month = calendarMonth;
				var days = loadCalendarDays(year, month);
				jQuery('#epg-calendar-month').text(new Date(year, month, 1).toLocaleDateString(undefined, {month: 'long', year: 'numeric'}));
				grid.find('button, .epg-calendar__blank').remove();
				var blanks = (new Date(year, month, 1).getDay() + 6) % 7;
				for (var gap = 0; gap < blanks; gap++) grid.append('<span class="epg-calendar__blank"></span>');
				var count = new Date(year, month + 1, 0).getDate();
				for (var number = 1; number <= count; number++) {
					var date = new Date(year, month, number);
					var button = jQuery('<button type="button"></button>').text(number).attr('title', date.toLocaleDateString()).data('date', date);
					button.toggleClass('has-epg', !!(days && days.has(EpgTime.dateKey(date))));
					button.toggleClass('is-selected', EpgTime.dayOffset(date, selected) === 0);
					grid.append(button);
				}
			}
			toggle.on('click', function(event) {
				event.stopPropagation();
				popup.toggle();
				nav.toggleClass('epg-calendar-open', popup.is(':visible'));
				toggle.attr('aria-expanded', popup.is(':visible') ? 'true' : 'false');
				if (popup.is(':visible')) renderCalendar();
			});
			jQuery('#epg-calendar-prev, #epg-calendar-next').on('click', function() {
				var change = this.id === 'epg-calendar-next' ? 1 : -1;
				var month = new Date(calendarYear, calendarMonth + change, 1);
				calendarYear = month.getFullYear();
				calendarMonth = month.getMonth();
				renderCalendar();
			});
			grid.on('click', 'button', function() {
				var date = jQuery(this).data('date');
				jQuery('#tvcontent').html(loadspinner).load('ajax/multiepg?bref=' + encodeURIComponent(bouquet) + '&day=' + EpgTime.dayOffset(date, new Date()) + '&epgmode=' + config.epgmode + '&week=0');
			});
			jQuery(document).off('click.epgCalendar keydown.epgCalendar').on('click.epgCalendar', function(event) {
				if (!jQuery(event.target).closest('#epg-calendar-wrap').length) {
					popup.hide();
					nav.removeClass('epg-calendar-open');
					toggle.attr('aria-expanded', 'false');
				}
			}).on('keydown.epgCalendar', function(event) {
				if (event.key === 'Escape') {
					popup.hide();
					nav.removeClass('epg-calendar-open');
					toggle.attr('aria-expanded', 'false').trigger('focus');
				}
			});
			loadCalendarDays(calendarYear, calendarMonth);
		})();

		if (config.mode === 1) {
			scope.find('.service').click(function() {
				var ref = jQuery(this).data('ref');
				if (ref != undefined) zapChannel(ref, '');
			});
		} else {
			scope.find('.epg__channel-col').click(function() {
				var ref = jQuery(this).closest('.epg__timeline-row').data('ref');
				if (ref != undefined) zapChannel(ref, '');
			});
		}
		scope.find('.plusclick').click(function() {
			var day = jQuery(this).data('day');
			var epgmode = config.epgmode;
			if (day != undefined) {
				if (day > 999) {
					var w = day - 1000;
					jQuery('#tvcontent').html(loadspinner).load('ajax/multiepg?bref=' + config.bref + '&day=' + config.day + '&epgmode=' + epgmode + '&week=' + w);
				} else if (day > 199) {
					var d = day - 200;
					var targetTime = d == 0 ? EpgTime.now() : Number(jQuery(this).data('time'));
					if (d == 0 && (config.day !== 0 || config.week !== 0 || EpgTime.dayStart(targetTime) !== EpgTime.dayStart(config.slotStart))) {
						jQuery('#tvcontent').html(loadspinner).load('ajax/multiepg?bref=' + config.bref + '&day=0&epgmode=' + epgmode + '&week=0', function(response, status) {
							if (status === 'success' || status === 'notmodified') jQuery('#pt4').click();
						});
						return;
					}
					if (config.mode === 1) {
						var slot = EpgTime.slot(targetTime, config.slotStart);
						var rows = jQuery('#tbl1body tr');
						if (slot.index >= 0 && slot.index < rows.length) {
							var container = jQuery('#fulltbl');
							var origin = jQuery('#tbl1body .epg__slot').first();
							if (!origin.length) return;
							var headerHeight = jQuery('.serviceheader').first().outerHeight() || 0;
							var top = origin.offset().top - container.offset().top + container.scrollTop() + guidePosition(targetTime) - headerHeight;
							if (d == 0) top -= Math.max(0, tableNode.clientHeight - headerHeight) / 3;
							container.animate({scrollTop: Math.max(0, top)}, 500);
						} else if (slot.index < 0) {
							jQuery('#fulltbl').animate({scrollTop: 0}, 500);
						}
					} else {
						var pos = timelinePosition(targetTime);
						var offset = 160;
						if (d == 0) {
							var channelWidth = jQuery('.epg__channel-col').first().outerWidth() || 0;
							offset = channelWidth + Math.max(0, tableNode.clientWidth - channelWidth) / 3;
						}
						jQuery('#fulltbl').animate({scrollLeft: clampTimelineScroll(pos - offset)}, 500);
					}
				} else if (day > 100) {
					var mode = day - 100;
					if (mode != config.mode) {
						jQuery.ajax({
							url: 'api/setwebconfig?mepgmode=' + mode,
							success: function(data) {
								if (alive()) jQuery('#tvcontent').html(loadspinner).load('ajax/multiepg?bref=' + config.bref + '&day=' + config.day + '&epgmode=' + epgmode + '&week=' + config.week);
							}
						});
					}
				} else {
					jQuery('#tvcontent').html(loadspinner).load('ajax/multiepg?bref=' + config.bref + '&day=' + day + '&epgmode=' + epgmode + '&week=' + config.week);
				}
			} else {
				var epgmode = jQuery(this).data('tvradio');
				if (epgmode != undefined) jQuery('#tvcontent').html(loadspinner).load('ajax/multiepg?day=' + config.day + '&epgmode=' + epgmode);
			}
		});

		if (jQuery('#header').is(':hidden')) {
			jQuery('#compressmepg').show();
			jQuery('#refreshmepg2').show();
		}
		if (mepgdirect == 1) {
			mepgdirect = 0;
			jQuery('#expandmepg').click();
		}

		var epgJumpNow = config.jumpNow;
		var epgJumpActiveService = config.jumpActiveService;
		var currentServiceRef = config.currentServiceRef;
		function autoJumpTvGuide() {
			if (epgJumpActiveService && currentServiceRef) {
				var normActive = currentServiceRef.trim().toLowerCase().replace(/%3a/g, ':');
				var targetCol = null;
				jQuery('#tbl2body td.serviceheader, .serviceheader').each(function() {
					var sref = (jQuery(this).data('sref') || jQuery(this).data('ref') || jQuery(this).attr('data-sref') || jQuery(this).attr('data-ref') || '').toString().trim().toLowerCase().replace(/%3a/g, ':');
					if (sref && (sref === normActive || normActive.indexOf(sref) === 0 || sref.indexOf(normActive) === 0)) {
						targetCol = jQuery(this);
						return false;
					}
				});
				if (targetCol && targetCol.length) {
					var scroller = jQuery('#fulltbl');
					var colPos = targetCol.position();
					if (colPos) {
						var targetX = scroller.scrollLeft() + colPos.left - (scroller.width() / 2) + (targetCol.outerWidth() / 2);
						scroller.scrollLeft(Math.max(0, targetX));
					}
				}
			}
			if (config.day === 0 && epgJumpNow) {
				var container = jQuery('#fulltbl');
				if (container.length) {
					var containerTop = container.offset().top;
					var containerScroll = container.scrollTop();
					var headerHeight = jQuery('.serviceheader').first().outerHeight() || 0;
					var slot = EpgTime.slot(EpgTime.now(), config.slotStart);
					if (slot.index >= 0 && slot.index < 12) {
						var origin = jQuery('#tbl1body .epg__slot').first();
						if (origin.length) {
							var targetY = origin.offset().top - containerTop + containerScroll + guidePosition(EpgTime.now()) - headerHeight - (container.height() - headerHeight) * 0.3;
							container.scrollTop(Math.max(0, targetY));
						}
					}
				}
			}
		}
		function autoJumpTimeline() {
			var targetRow = null;
			if (epgJumpActiveService && currentServiceRef) {
				var normActive = currentServiceRef.trim().toLowerCase().replace(/%3a/g, ':');
				jQuery('.epg__row').each(function() {
					var sref = (jQuery(this).data('sref') || jQuery(this).data('ref') || jQuery(this).attr('data-sref') || jQuery(this).attr('data-ref') || '').toString().trim().toLowerCase().replace(/%3a/g, ':');
					if (sref && (sref === normActive || normActive.indexOf(sref) === 0 || sref.indexOf(normActive) === 0)) {
						targetRow = jQuery(this);
						return false;
					}
				});
				if (targetRow && targetRow.length) {
					var container = jQuery('#fulltbl');
					var rowPos = targetRow.position();
					if (rowPos) {
						var targetY = container.scrollTop() + rowPos.top - (container.height() / 2) + (targetRow.outerHeight() / 2);
						container.scrollTop(Math.max(0, targetY));
					}
				}
			}
			if (config.day === 0 && epgJumpNow) {
				var container = jQuery('#fulltbl');
				var markerLeft = epgTimelineNowPosition();
				if (!isNaN(markerLeft)) {
					var channelWidth = jQuery('.epg__channel-col').first().outerWidth() || 0;
					container.scrollLeft(clampTimelineScroll(markerLeft - channelWidth - (container.width() - channelWidth) * 0.3));
				}
			}
		}
		jumpTimeout = setTimeout(function() {
			if (!alive()) return;
			if (config.mode === 1) autoJumpTvGuide();
			else autoJumpTimeline();
			updateEpgDateRange();
		}, 100);
	}
	root.ModernEpg = {init: init, initShell: initShell};
})(window);
