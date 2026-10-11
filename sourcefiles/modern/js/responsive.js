var standby_status = -1;
var timerFormInitiated = - 1;
var timerTagChoices = null;
var timerTagOptions = [];
var listTagFilterSelections = {movies: [], timers: [], at: []};
var listTagFilterOutsideClickReady = false;

function tagFilterMatches(tags, selected) {
	return !selected.length || selected.some(tag => tags.includes(tag));
}

function closeListTagFilterOnOutsideClick(event) {
	document.querySelectorAll('.list-tag-filter-panel:not([hidden])').forEach(panel => {
		const host = panel.closest('.list-tag-filter');
		const toggle = document.querySelector('[data-tag-filter-toggle="' + host.dataset.list + '"]');
		if (!panel.contains(event.target) && (!toggle || !toggle.contains(event.target))) {
			panel.hidden = true;
			if (toggle) toggle.setAttribute('aria-expanded', 'false');
		}
	});
}

function initListTagFilter(kind) {
	const host = document.getElementById('tag-filter-' + kind);
	if (!host) return;
	if (!listTagFilterOutsideClickReady) {
		document.addEventListener('click', closeListTagFilterOnOutsideClick);
		listTagFilterOutsideClickReady = true;
	}
	const toggle = document.querySelector('[data-tag-filter-toggle="' + kind + '"]');
	const panel = host.querySelector('.list-tag-filter-panel');
	const options = host.querySelector('.list-tag-filter-options');
	const selection = host.querySelector('.list-tag-filter-selection');
	const chips = host.querySelector('.list-tag-filter-chips');
	const count = host.querySelector('.list-tag-filter-count');
	const selected = listTagFilterSelections[kind];
	const list = host.closest?.('.movies-card') || host.parentElement;
	let known = [];
	let used = [];

	function itemTags(item) {
		return (item.dataset.filterTags || '').split(/\s+/).filter(Boolean);
	}

	function render() {
		let matches = 0;
		list.querySelectorAll('.list-tag-filter-item').forEach(item => {
			const tags = itemTags(item);
			item.hidden = !tagFilterMatches(tags, selected);
			if (!item.hidden) matches++;
			const labels = item.querySelector('.list-tag-item-tags');
			if (labels) {
				labels.replaceChildren();
				tags.forEach(tag => {
					const badge = document.createElement('span');
					badge.className = 'list-tag-item-badge';
					badge.textContent = tag.replace(/_/g, ' ');
					labels.appendChild(badge);
				});
			}
		});
		chips.replaceChildren();
		selected.forEach(tag => {
			const chip = document.createElement('button');
			chip.type = 'button';
			chip.className = 'list-tag-filter-chip';
			chip.textContent = tag.replace(/_/g, ' ') + ' ×';
			chip.onclick = () => {
				selected.splice(selected.indexOf(tag), 1);
				render();
				renderOptions();
			};
			chips.appendChild(chip);
		});
		selection.hidden = !selected.length;
		count.textContent = host.dataset.matches.replace('%d', matches);
		toggle.classList.toggle('list-tag-filter-active', !!selected.length);
		toggle.querySelector('.list-tag-filter-icon--off')?.toggleAttribute('hidden', !!selected.length);
		toggle.querySelector('.list-tag-filter-icon--on')?.toggleAttribute('hidden', !selected.length);
	}

	function renderOptions() {
		options.replaceChildren();
		const localTags = [...new Set(Array.from(list.querySelectorAll('.list-tag-filter-item')).flatMap(itemTags))];
		const groups = [[host.dataset.known, known], [host.dataset.used, [...new Set(used.concat(localTags, selected))].filter(tag => !known.includes(tag)).sort()]];
		groups.forEach(([title, tags]) => {
			if (!tags.length) return;
			const heading = document.createElement('strong');
			heading.textContent = title;
			options.appendChild(heading);
			tags.forEach(tag => {
				const label = document.createElement('label');
				const checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.value = tag;
				checkbox.checked = selected.includes(tag);
				checkbox.onchange = () => {
					const index = selected.indexOf(tag);
					if (checkbox.checked && index === -1) selected.push(tag);
					if (!checkbox.checked && index !== -1) selected.splice(index, 1);
					render();
				};
				label.append(checkbox, document.createTextNode(' ' + tag.replace(/_/g, ' ')));
				options.appendChild(label);
			});
		});
	}

	toggle.onclick = async () => {
		panel.hidden = !panel.hidden;
		toggle.setAttribute('aria-expanded', String(!panel.hidden));
		if (panel.hidden) return;
		renderOptions();
		try {
			const response = await fetch(owifRequestUrl('/api/tagfiltertags'));
			if (!response.ok) throw new Error(response.status);
			const tags = await response.json();
			if (!host.isConnected || panel.hidden) return;
			known = tags.known || [];
			used = tags.used || [];
			renderOptions();
		} catch (error) {
			const message = document.createElement('p');
			message.textContent = host.dataset.error;
			options.prepend(message);
		}
	};
	host.querySelector('.list-tag-filter-clear').onclick = () => {
		selected.length = 0;
		render();
		renderOptions();
	};
	render();
}


$(function () {
	getStatusInfo();
	setInterval(getStatusInfo, 3000);

	if(!timeredit_initialized)
		$('#editTimerForm').load('ajax/edittimer');

	$('#navbar-collapse').on('show.bs.modal', function (e) {
		$('#navbar-collapse').removeAttr('style');
	});

	$('#navbar-collapse').on('hide.bs.modal', function (e) {
		$('#navbar-collapse').addAttr('style', 'width:100%');
	});

  // $('#TimerModal').modal('show')

	$('#TimerModal').on('show.bs.modal', function (e) {
		if (!$("#TimerModal").data('bs.modal').isShown){
			if (timerFormInitiated !== 1) {
				initTimerEditForm();
      }
      let epgEvent;
      try {
        let dataAttr = 'metadata';
		let meta = e.relatedTarget.closest('[data-' + dataAttr + ']');
        epgEvent = {};
		if (meta != null)
		{
			epgEvent = JSON.parse(e.relatedTarget.closest('[data-' + dataAttr + ']').dataset[dataAttr]);
		}
		else {
			epgEvent.sref = e.relatedTarget.dataset.ref;
			epgEvent.id = e.relatedTarget.dataset.evid;
		}
      } catch (ex) {
		console.log(ex);
        epgEvent = {};
      }
			if (!!epgEvent.sref && !!epgEvent.id) {
				addEditTimerEvent(epgEvent.sref, epgEvent.id);
			} else if (!!epgEvent.sref && !!epgEvent.begin && !!epgEvent.end) {
				editTimer(epgEvent.sref, epgEvent.begin, epgEvent.end);
			} else {
				addTimer();
			}
		
		}
	});

	$('#TimerModal').on('hidden.bs.modal', function (e) {
		resetTimerTagDropdown();
	});

	autosize($('textarea.auto-growth'));

	$.Tools.epgsearch.activate();
	$(document).keydown(function(e) {
		if ((e.ctrlKey || e.cmdKey) &&  e.keyCode === 70)  {
			e.preventDefault();
			$.Tools.epgsearch.showSearchBar();
		}
		if ((e.ctrlKey || e.cmdKey) &&  e.keyCode === 69)  {
			e.preventDefault();
			$.Tools.epgsearch.showSearchBar();
		}
		
	});

	/*
	activateNotificationAndTasksScroll();
	setSkinListHeightAndScroll(true);
	setSettingListHeightAndScroll(true);
	$(window).resize(function () {
		setSkinListHeightAndScroll(false);
		setSettingListHeightAndScroll(false);
	});
	*/
	WebConfig();
});

function initJsTranslationAddon(strings) {
	tstr_timer = strings.timer;
	tstr_loading = strings.loading;
	tstr_add_timer = strings.add_timer;
	tstr_cancel = strings.cancel;
	tstr_close = strings.close;
	tstr_rename = strings.rename;
	tstr_prompt_save_changes = strings.prompt_save_changes;
	tstr_oops = strings.oops;
	tstr_weekday = strings.at_filter_weekday;
	tstr_weekend = strings.at_filter_weekend;
	tstr_at_del = strings.at_del;
	tstr_at_filter_title = strings.at_filter_title;
	tstr_at_filter_short_desc = strings.at_filter_short_desc;
	tstr_at_filter_desc = strings.at_filter_desc;
	tstr_at_filter_day = strings.at_filter_day;
	tstr_at_filter_include = strings.at_filter_include;
	tstr_at_filter_exclude = strings.at_filter_exclude;
	tstrings_no_cancel = strings.no_cancel;
	tstrings_yes_delete = strings.yes_delete;
	tstrings_yes = strings.yes;
	tstrings_deleted = strings.deleted;
	tstrings_cancelled = strings.cancelled;
	tstrings_need_input = strings.need_input;
	tstrings_install_package = strings.install_package;
	tstrings_remove_package = strings.remove_package;
	tstrings_update_package = strings.update_package;
	tstrings_upload_package = strings.upload_package;
	tstrings_upload_error = strings.upload_error;
	tstr_bqe_add_url = strings.bqe_add_url;
	tstr_bqe_name_url = strings.bqe_name_url;
}

function toggleFullRemote() {
	$("#symbolRemoteView").toggle();
	$("#fullRemoteView").toggle();
}

function SetSpinner()
{
	/*jshint multistr: true */
	loadspinner = " \
	<div class='page-loader-wrapper'> \
		<div class='loader'> \
			<div class='preloader'> \
				<div class='spinner-layer pl--skinned'> \
					<div class='circle-clipper left'> \
						<div class='circle'></div> \
					</div> \
					<div class='circle-clipper right'> \
						<div class='circle'></div> \
					</div> \
				</div> \
			</div> \
			<p>" + tstr_loading + "...</p> \
		</div> \
	</div>";
}

function listTimers()
{
	$("#timerdlgcont").html(loadspinner).load('ajax/timers #timers');
}

function set_epg_modal_content(data) {
	$('#editTimerForm').load('ajax/edittimer');
	$("#epgmodalcontent").html($( data ).find( '#epgcards' ).html());
}

function open_epg_dialog(sRef,Name) {
	$("#epgmodalcontent").html(loadspinner);
	let url = "ajax/epgdialog?sref=" + encodeURIComponent(sRef);
	$.get(url, set_epg_modal_content);
}

function open_epg_similar_dialog(sRef, eventId) {
	$("#epgmodalcontent").html(loadspinner);
	let url = "ajax/epgdialog?sref=" + encodeURIComponent(sRef) + "&eventid=" + eventId;
	$.get(url, set_epg_modal_content);
}

function load_channelsepg(url) {
	$("#channel_epg_container").load(url);
	return false;
}

function load_subcontent(url) {
	$("[id^=sub_content_container]").load(url);
	return false;
}

function loadtvcontent(url) {
	$("[id^=tvcontent]").load(url);
	return false;
}

function load_maincontent(url) {
	if (lastcontenturl != url || ( url.indexOf('screenshot') > -1 ) || ( url.indexOf('boxinfo') > -1 )) {
		$("#content_container").load(url);
		lastcontenturl = url;
	}
	return false;
}

function load_maincontent_spin_force(url) {
	let sp = '<div id="content_main">'+loadspinner+'</div>';
	$("#content_container").html(sp).load(url);
	lastcontenturl = url;
	return false;
}

var SSHelperObj = function () {
	var self;
	var screenshotInterval = false;
	var ssr_i = 30;
	var ssr_hd = true;

	return {
		setup: function()
		{
			self = this;
			clearInterval(self.screenshotInterval);
			self.ssr_i = parseInt($('#ssr_i').val());
			self.ssr_hd = $('#ssr_hd').is(':checked');

			$("#dropdown").click(function() {testPipStatus();});
			$('#screenshotbutton0').click(function(){testPipStatus(); grabScreenshot('all');});
			$('#screenshotbutton1').click(function(){testPipStatus(); grabScreenshot('video');});
			$('#screenshotbutton2').click(function(){testPipStatus(); grabScreenshot('osd');});
			$('#screenshotbutton3').click(function(){testPipStatus(); grabScreenshot('pip');});
			$('#screenshotbutton4').click(function(){testPipStatus(); grabScreenshot('lcd');});
			$("button").click(function() {testPipStatus();});

			$('#ssr_i').val(self.ssr_i);
			$('#screenshotspinner').addClass(GetLSValue('spinner','fa-spinner'));
			$('#ssr_hd').change(function() {
				testPipStatus();
				self.ssr_hd = $('#ssr_hd').is(':checked');
				webapi_execute("/api/setwebconfig?screenshot_high_resolution=" + ( self.ssr_hd ? "true" : "false"));
				grabScreenshot('auto');
			});
			$('#ssr_i').change(function() {
				testPipStatus();
				let t = $('#ssr_i').val();
				webapi_execute("/api/setwebconfig?screenshot_refresh_time=" + t);
				self.ssr_i = parseInt(t);
				if($('#ssr_s').is(':checked'))
				{
					clearInterval(self.screenshotInterval);
					self.setSInterval();
				}
			});
			$('#ssr_s').change(function() {
				testPipStatus();
				let v = $('#ssr_s').is(':checked');
				if (v) {
					self.setSInterval();
				} else {
					clearInterval(self.screenshotInterval); 
				}
				webapi_execute("/api/setwebconfig?screenshot_refresh_auto=" + (v ? "true":"false"));
			});
		
			screenshotMode = 'all'; // reset on page reload
			grabScreenshot(screenshotMode);

			if($('#ssr_s').is(':checked')) {
				self.setSInterval();
			}

		},setSInterval: function()
		{
			self.screenshotInterval = setInterval( function() {testPipStatus(); grabScreenshot('auto');}, (self.ssr_i+1)*1000);
		}
	};
};

var SSHelper = new SSHelperObj();


function load_reboot_dialog(data,title){
	let sp = loadspinner.replace("<div class='loader'>", "<div class='loader card'>")
		.replace("<p>" + tstr_loading + "...</p>","<p>" + tstr_loading + "...</p><p>" + title + "</p>");
	$("#responsivespinner").html(sp);
}


function toggleLeftSideBar() {
	let $body = $('body');
	let height = $body.height();
	let $maincontent = $('#fullmaincontent');
	
	if ($('body').hasClass('ls-closed-manual')) {
		$maincontent.addClass('content');
		$maincontent.removeClass('contentfull');
		$body.removeClass('ls-closed-manual');
		$("#epgcard").height(($("#leftsidemenu").height() - 30) + "px");
		$('#topmenuheader,#mainfooter').show();
		$('#togglefullscreen').html('fullscreen');
		setTimeout(function(){load_tvcontent('ajax/multiepg?epgmode=tv');}, 500);
	} else {
		$body.addClass('ls-closed-manual');
		$maincontent.removeClass('content');
		$maincontent.addClass('contentfull');
		$('#epgcard').height(height + "px");
		$('#topmenuheader,#mainfooter').hide();
		$('#togglefullscreen').html('fullscreen_exit');
		setTimeout(function(){load_tvcontent('ajax/multiepg?epgmode=tv');}, 500);
	}
}

function grabScreenshot(mode) {
	$('#screenshotimage').load(function(){
	  $('#responsivespinnerscreenshot').hide();
	});
	if (mode != "auto") {
		screenshotMode = mode;
	} else {
		mode = screenshotMode;
	}
	timestamp = new Date().getTime();
	if (SSHelper.ssr_hd){
		$('#screenshotimage').attr("src",'/grab?format=jpg&mode=' + mode + '&t=' + timestamp);
	} else {
		$('#screenshotimage').attr("src",'/grab?format=jpg&r=720&mode=' + mode + '&t=' + timestamp);
	}
	$('#screenshotimage').attr("style",'max-height:60vh;');
	if (mode == "lcd") {
		$('#screenshotimage').attr("class",'img-responsive center-block');
	}
	else{
		$('#screenshotimage').attr("class",'img-responsive img-rounded center-block');
	}
}

getStatusInfo = function(){
  // redefine classic version of same function
	owif.api.getStatusInfo().then(function(statusinfo) {
		$("#osd__connection").hide();
		let responsive_mute_status = '';
		if (statusinfo['muted'] == true) {
			mutestatus = 1;
			responsive_mute_status = "<a href='#' onclick='toggleMute(); return false;'><i class='material-icons'>volume_off</i></a>";
		} else {
			mutestatus = 0;
			responsive_mute_status = "<a href='#' onclick='toggleMute(); return false;'><i class='material-icons'>volume_up</i></a>";
		}
		$("#responsive_mute_status").html(responsive_mute_status);
		
		setOSD(statusinfo);
		
		if (statusinfo['isRecording'] == 'true') {
			let recs = statusinfo['Recording_list'];
			let rec_array = recs.split("\n");
			let recordingCount = 0;
			let tmp = '';
			for (let rec in rec_array) {
				if (rec_array[rec] != '') {
					recordingCount += 1;
					tmp += "<li> <a href='/#timers' onclick='load_maincontent(\"ajax/timers\");' data-dismiss='modal'>" + rec_array[rec] + "</a></li><hr />";
					
				}
			}
			$("#recmodalcontent").html(tmp);
			$("#osd__active-recordings .label-count").text(recordingCount).parent().show();
		} else {
			$("#osd__active-recordings").hide();
		}
		
		if (statusinfo['isStreaming'] == 'true') {
			let streams = statusinfo['Streaming_list'];
			let stream_array = streams.split("\n");
			let streamCount = 0;
			let tmp = '';
			for (let stream in stream_array) {
				if (stream_array[stream] != '') {
					streamCount += 1;
					tmp += "<li>" + stream_array[stream] + "</li><hr/>";
				}
			}
			$("#streammodalcontent").html(tmp);
			$("#osd__active-streams .label-count").text(streamCount).parent().show();
		} else {
			$("#osd__active-streams").hide();
		}

		$('body').toggleClass('standby-mode', statusinfo['inStandby'] === 'true');
	}).catch(function() {
		$("#osd__connection").show();
	});
}

function setOSD( statusinfo )
{
	let sref = current_ref = statusinfo['currservice_serviceref'];
	let station = current_name = statusinfo['currservice_station'];
	let streamtitle = tstr_stream + ": " + station + "'><i class='material-icons'>ondemand_video</i></a>";
	let streamtitletrans = tstr_stream + " (" + tstr_transcoded + "): " + station + "'><i class='material-icons'>phone_android</i></a>";
	let responsive_osd_transcoding = '';
	let responsive_osd_stream = '';
	let responsive_osd_current = '';
	let responsive_osd_cur_event = '';

	if (station) {
		if (sref.startsWith('1:0:') || sref.startsWith('1:134:') || sref.startsWith('4097:0:') || sref.startsWith('5002:0:')) {
			$('#osd__current-event__name').html(statusinfo['currservice_name']);
			if (!sref.startsWith('1:0:0')) {
				$('#osd__current-event__time__start').html(statusinfo['currservice_begin'] || '');
				$('#osd__current-event__time__end').html(statusinfo['currservice_end'] || '');
				$('#osd__current-service').html(station);
				$('#osd__current-event__epg').off("click").click(function() {
					open_epg_dialog(sref, station);
				});
				$('#osd__current-event').off("click").click(function() {
					loadeventepg(statusinfo['currservice_id'], sref, '/images/default_picon.png');
				});
			} else {
				$('#osd__current-service').html('[ Movies ]');
			}
			if ( statusinfo['transcoding'] && (sref.startsWith('1:0:1') || sref.startsWith('1:134:1')) ) {
				responsive_osd_transcoding = "<a href='#' onclick=\"jumper8002('" + sref + "', '" + station + "')\"; title='" + streamtitletrans;
			}
		}
		if (sref.startsWith('1:0:0') || sref.startsWith('4097:0:')) {
			if (statusinfo['currservice_filename'] === '') {
				streamtitle = tstr_stream + ": " + station + "'>" + station + "</a>";
				responsive_osd_stream = "<a href='#' title='" + streamtitle;
			} else {
				let fn = statusinfo['currservice_filename'].replaceAll("'","%27").replaceAll("\"","%22");
				streamtitle = tstr_stream + ": " + station + "'><i class='material-icons'>movie</i></a>";
				responsive_osd_stream = "<a href='/web/ts.m3u?file=" + fn + "' target='_blank' title='" + streamtitle;
				responsive_osd_current = "<a href='/#movies' onclick='load_maincontent(\"ajax/movies\");'><b>" + station + "&nbsp;&nbsp;</b></a>";
				if (statusinfo['transcoding']) {
					responsive_osd_transcoding = "<a href='#' onclick=\"jumper8003('" + fn + "')\"; title='" + streamtitletrans;
				}
			}
		}
	}
	$("#osd__current-event__stream").attr("href", "/web/stream.m3u?ref=" + sref +"&name=" + encodeURIComponent(station));
	$("#volume-slider, #osd__current-volume").val(statusinfo['volume']);
	$("#responsive_osd_transcoding").html(responsive_osd_transcoding);
	$("#responsive_osd_stream").html(responsive_osd_stream);
	$("#responsive_osd_current").html(responsive_osd_current);
	$("#responsive_osd_cur_event").html(responsive_osd_cur_event);
	// highlight current channel in now/next view
	try {
		$(".channel-list__channel").removeClass("channel--active");
		$("#sref-" + sref.replace(/:/g, '_')).addClass("channel--active");
	} catch(e){}
}


function loadeventepg(id, ref, picon) {
	if (typeof picon !== 'undefined') {
		channelpicon = picon;
	} else {
		channelpicon = null;
	}
	let url = 'ajax/event?idev=' + id + '&sref=' + encodeURIComponent(ref);
	$("#eventdescriptionII").load(url);
}

function loadtimeredit(id, ref) {
	let url = 'ajax/event?idev=' + id + '&sref=' + encodeURIComponent(ref);
	$("#eventdescriptionII").load(url);
}

function positionTimerTagDropdown() {
	let modal = document.getElementById('TimerModal');
	if (!modal.classList.contains('timer-tags-open')) return;
	let choices = document.querySelector('#editTimerForm .choices');
	let dropdown = document.querySelector('#timer-tag-overlay .choices__list--dropdown');
	let list = dropdown.querySelector('.choices__list');
	let rect = choices.getBoundingClientRect();
	let limit = Math.floor(window.innerHeight * 0.9);
	let below = Math.max(0, limit - rect.bottom);
	let above = Math.max(0, rect.top - Math.floor(window.innerHeight * 0.1));
	let openAbove = rect.top < limit && below < 120 && above > below;
	let available = Math.min(list.scrollHeight, openAbove ? above : below);
	dropdown.style.top = (openAbove ? rect.top - available : rect.bottom) + 'px';
	dropdown.style.left = rect.left + 'px';
	dropdown.style.width = rect.width + 'px';
	dropdown.style.maxHeight = available + 'px';
	list.style.maxHeight = available + 'px';
	dropdown.classList.add('timer-tags-positioned');
}

function resetTimerTagDropdown() {
	let modal = document.getElementById('TimerModal');
	modal.classList.remove('timer-tags-open');
	let dropdown = document.querySelector('#timer-tag-overlay .choices__list--dropdown');
	if (!dropdown) return;
	dropdown.classList.remove('timer-tags-positioned');
	for (let property of ['top', 'left', 'width', 'maxHeight']) dropdown.style[property] = '';
	dropdown.querySelector('.choices__list').style.maxHeight = '';
}

function initTimerTags(tags) {
	if (!timerTagChoices) {
		let tagElement = document.getElementById('tagsnew');
		timerTagChoices = new Choices(tagElement, Object.assign({}, owif.gui.choicesConfig, {
			addChoices: true,
			position: 'bottom',
			shouldSort: true
		}));
		let dropdown = document.querySelector('#editTimerForm .choices__list--dropdown');
		document.getElementById('timer-tag-overlay').appendChild(dropdown);
		dropdown.addEventListener('mousedown', function(event) {
			timerTagChoices._onMouseDown(event);
		}, true);
		dropdown.addEventListener('click', function(event) {
			event.stopPropagation();
		});
		tagElement.addEventListener('showDropdown', function() {
			document.getElementById('TimerModal').classList.add('timer-tags-open');
			positionTimerTagDropdown();
		});
		tagElement.addEventListener('hideDropdown', resetTimerTagDropdown);
		tagElement.addEventListener('search', function() {
			requestAnimationFrame(positionTimerTagDropdown);
		});
		document.querySelector('#TimerModal .modal-body').addEventListener('scroll', positionTimerTagDropdown);
		document.getElementById('TimerModal').addEventListener('scroll', positionTimerTagDropdown);
		window.addEventListener('resize', positionTimerTagDropdown);
		let tagInput = document.querySelector('#editTimerForm .choices__input--cloned');
		document.addEventListener('keydown', function(event) {
			if (event.target !== tagInput || event.key !== 'Enter') return;
			let tag = tagInput.value.trim().replace(/\s+/g, '_');
			if (!tag || timerTagOptions.includes(tag)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			timerTagChoices.setChoices([{value: tag, label: tag}], 'value', 'label', false);
			timerTagChoices.setChoiceByValue(tag);
			timerTagOptions.push(tag);
			tagInput.value = '';
			tagInput.dispatchEvent(new Event('input', {bubbles: true}));
		}, true);
	}
	let selected = (tags || '').trim().split(/\s+/).filter(Boolean);
	let available = [...new Set(_tags.concat(selected))];
	timerTagOptions = available;
	timerTagChoices.removeActiveItems();
	timerTagChoices.setChoices(available.map(tag => ({value: tag, label: tag})), 'value', 'label', true);
	timerTagChoices.setChoiceByValue(selected);
}

function initTimerEdit(radio, callback) {
	
	let bottomhalf = function() {
	$('#dirname').find('option').remove().end();
	$('#dirname').append($("<option></option>").attr("value", "None").text("Default"));
	for (let id in _locations) {
		let loc = _locations[id];
		$('#dirname').append($("<option></option>").attr("value", loc).text(loc));
	}
	$("#dirname").selectpicker("refresh");
	
	timeredit_initialized = true;
		callback();
	}

	initTimerBQ(radio, bottomhalf);
}

function initTimerEditBegin()
{
	
	$('#timerbegin').datetimepicker({
		format: "dd.mm.yy hh:ii",
		autoclose: true,
		todayHighlight: true,
		todayBtn: 'linked',
		minuteStep: 2,
		language: 'de', // TODO: fix date
	});
	$('#timerbegin').datetimepicker().on('changeDate', function(dateText, inst){
		if ($('#timerend').val() != '' &&
			$(this).datetimepicker('getDate') > $('#timerend').datetimepicker('getDate')) {
				showErrorMain(tstr_start_after_end);
		}
	});
}

function TimerConflict(conflicts, sRef, eventId, justplay)
{
  let SplitText = '';
  conflicts.sort( function(a, b) {
    return (a.begin - b.begin);
  });
  conflicts.forEach(function(entry) {
		SplitText += "<div class='row clearfix conflicting-timer'><div class='col-xs-12'> \
			<div class='card'> \
				<div class='header' style='padding: 10px 20px;'> \
					<div class='row clearfix'> \
						<div class='col-xs-12'> \
              <h2> \
                <span role='button'> \
                  <a href='javascript:void(0);' onclick='toggleTimerStatus(\"" + entry.serviceref + "\", \"" + entry.begin + "\", \"" + entry.end + "\"); this.closest(\".conflicting-timer\").classList.add(\"fade\");' class=\"link--skinned\" title='Disable Timer'> \
                    <i class='material-icons material-icons-centered material-icons-mg-right'>alarm_off</i> \
                  </a> \
                </span> \
							  " +  entry.name + " \
                <span style='opacity: 0.4;'> - " + entry.servicename + "</span> \
              </h2> \
						</div> \
					</div> \
				</div> \
				<div class='body'> \
						<div class='row clearfix'> \
							<div class='col-xs-12' style='margin: 10px 0 0;'> \
                <p>" + entry.realbegin + " - " + entry.realend + "</p> \
              </div> \
						</div> \
					</div> \
				</div> \
			</div> \
		</div></div> \
		"
	});
	$('.modal').modal('hide');
	$('#timerconflictmodal').html(SplitText);
	$('#TimerConflictModal').modal('show');
}

function cbAddTimerEvent(state) {
	if (state.state) {
		$('.event[data-id='+state.eventId+'][data-ref="'+state.sRef+'"] .timer').remove();
		$('.event[data-id='+state.eventId+'][data-ref="'+state.sRef+'"] div:first').append('<div class="timer">'+tstr_timer+'</div>');
		showErrorMain(tstr_timer_added, true);
	}
}

function addTimerEvent(sRef, eventId, justplay, callback) {

	let url = "/api/timeraddbyeventid?sRef=" + sRef + "&eventid=" + eventId;
	if(justplay)
		url += "&eit=0&disabled=0&justplay=1&afterevent=3";

	webapi_execute_result(url,
		function(state,txt,conflicts) {
			if (state) {
				refreshEpgTimers();
				if ($('#EventModal').hasClass('in'))
					loadeventepg(eventId, sRef);
			}
			if (!state && conflicts) {
				TimerConflict(conflicts,sRef,eventId,justplay);
			} else if (typeof callback !== 'undefined') {
				callback({
					sRef: sRef, 
					eventId: eventId, 
					justplay: justplay,
					state: state,
					txt: txt
				});
			} else {
				showErrorMain(state ? tstr_timer_added : txt, true);
			}
		}
	);
}

function refreshEpgTimers() {
	let epg = $('#fulltbl');
	let url = epg.data('refreshUrl');
	if (!url) return;

	$.get(url, function(html) {
		if (!epg.closest('body').length) return;
		let refreshed = $('<div>').append($.parseHTML(html));
		let updated = new Map();
		refreshed.find('#fulltbl .event[data-id][data-ref]').each(function() {
			updated.set(this.getAttribute('data-ref') + '|' + this.getAttribute('data-id'), this);
		});
		epg.find('.event[data-id][data-ref]').each(function() {
			let replacement = updated.get(this.getAttribute('data-ref') + '|' + this.getAttribute('data-id'));
			if (replacement) $(this).replaceWith($(replacement).clone());
		});
	});
}

function addTimer(evt,chsref,chname,top) {
	current_serviceref = '';
	current_begin = -1;
	current_end = -1;
	servicename = '';

	let begin = -1;
	let end = -1;
	let serviceref = '';
	let title = '';
	let desc = '';
	let margin_before = 0;
	let margin_after = 0;

	let radio = isRadio(chsref);

	if (typeof evt !== 'undefined' && evt != '') {
		begin = evt.begin;
		end = evt.begin+evt.duration;
		serviceref = evt.sref;
		servicename = evt.channel;
		title = unEscape(evt.title);
		desc = unEscape(evt.shortdesc);
		margin_before = evt.recording_margin_before;
		margin_after = evt.recording_margin_after;
		radio = isRadio(serviceref);
	}

	let lch=$('#bouquet_select > optgroup').length;

	$('#cbtv').prop('checked',!radio);
	$('#cbradio').prop('checked',radio);

	let bottomhalf = function() {
	if (typeof chsref !== 'undefined' && typeof chname !== 'undefined') {
		serviceref = chsref;
		title = chname;
		if ($('#bouquet_select').val(chsref) === 'undefined') {
			$('#bouquet_select').append($("<option></option>").attr("value", serviceref).text(chname));
		}
	}

	$('#timername').val(title);
	$('#description').val(desc);
	$('#dirname').val("None");
	$('#enabled').prop("checked", true);
	$('#allow_duplicate').prop("checked", true);
	$('#justplay').prop("checked", false);
	$('#afterevent').val(3);

	for (let i=0; i<7; i++) {
		$('#day'+i).prop('checked', false);
	}
	
	initTimerTags('');

	let begindate = begin !== -1 ? new Date( (Math.round(begin) - margin_before*60) * 1000) : new Date();
	$('#timerbegin').datetimepicker('setDate', begindate);
	let enddate = end !== -1 ? new Date( (Math.round(end) + margin_after*60) * 1000) : new Date(begindate.getTime() + (60*60*1000));
	$('#timerend').datetimepicker('setDate', enddate);

	$('#bouquet_select').val(serviceref);
	$('#bouquet_select').trigger("chosen:updated");
	
	// TODO :check if needed
	/*
	 if (serviceref !== $('#bouquet_select').val() && typeof servicename !== 'undefined' && servicename != '') {
		$('#bouquet_select').append($("<option></option>").attr("value", serviceref).text(servicename));
		$('#bouquet_select').val(serviceref);
	}
	*/

	setTimerEditFormTitle(tstr_add_timer);
	};
	
	if (!timeredit_initialized || lch < 2) {
		initTimerEdit(radio, bottomhalf);
	}
	else
	{
		let _chsref=$("#bouquet_select option:last").val();
		if(radio != isRadio(_chsref)){
			initTimerEdit(radio, bottomhalf);
		} else {
			bottomhalf();
		}
	}

}

function editTimer(serviceref, begin, end, evtid) {
	serviceref = decodeURIComponent(serviceref);
	current_serviceref = serviceref;
	current_begin = begin;
	current_end = end;
	evtid = evtid || -1

	let radio = isRadio(serviceref);
	
	$('#cbtv').prop('checked',!radio);
	$('#cbradio').prop('checked',radio);
	
	let bottomhalf = function() {
	initTimerTags('');
	
	if (timeredit_begindestroy) {
		initTimerEditBegin();
		timeredit_begindestroy=false;
	}

	$.ajax({
		url: "/api/timerlist",
		dataType: "json",
		success: function(timers) {
			if (timers.result) {
				for (let id in timers.timers) {
					timer = timers.timers[id];
					if (timer.serviceref == serviceref &&
						( Math.round(timer.begin) == Math.round(begin) &&
						  Math.round(timer.end) == Math.round(end) ||
						  timer.eit == evtid
						)
					) {
							$('#timername').val(timer.name);
							$('#description').val(timer.description);
							$('#bouquet_select').val(timer.serviceref);
							$('#bouquet_select').trigger("chosen:updated");
							if(timer.serviceref !== $('#bouquet_select').val()) {
								$('#bouquet_select').append($("<option></option>").attr("value", timer.serviceref).text(timer.servicename));
								$('#bouquet_select').val(timer.serviceref);
							}
							$('#dirname').val(timer.dirname);
							if(timer.dirname !== $('#dirname').val()) {
								let current_location = "<option value='" + timer.dirname + "'>" + timer.dirname + "</option>";
								$('#dirname').append(current_location);
								$('#dirname').val(timer.dirname);
							}
							$('#enabled').prop("checked", timer.disabled == 0);
							$('#allow_duplicate').prop("checked", timer.allow_duplicate);
							$('#justplay').prop("checked", timer.justplay);
							$('#afterevent').val(timer.afterevent);
							let flags=timer.repeated;
							for (let i=0; i<7; i++) {
								$('#day'+i).prop('checked', ((flags & 1)==1));
								//$('#day'+i).prop('checked', ((flags & 1)==1)).checkboxradio("refresh");
								flags >>= 1;
							}
							
							initTimerTags(timer.tags);
							
							$('#timerbegin').datetimepicker('setDate', (new Date(Math.round(timer.begin) * 1000)));
							$('#timerend').datetimepicker('setDate', (new Date(Math.round(timer.end) * 1000)));
							
							let r = (timer.state === 2);
							// don't allow edit some fields if running
							if(r) {
								$('#timerbegin').datetimepicker('destroy');
								timeredit_begindestroy=true;
								$('#timerbegin').addClass('ui-state-disabled');
								$('#timername').addClass('ui-state-disabled');
								$("#dirname option").not(":selected").attr("disabled", "disabled");
								$("#bouquet_select option").not(":selected").attr("disabled", "disabled");
							} else {
								$('#timername').removeClass('ui-state-disabled');
								$('#timerbegin').removeClass('ui-state-disabled');
								$("#dirname option").removeAttr('disabled');
								$("#bouquet_select option").removeAttr('disabled');
							}
							$('#timerbegin').prop('readonly', r);
							$('#timername').prop('readonly',r);
							
							if (typeof timer.vpsplugin_enabled !== 'undefined' && (!typeof timer.vpsplugin_enabled))
							{
								console.debug(timer.vpsplugin_enabled);
								$('#vpsplugin_enabled').prop("checked", timer.vpsplugin_enabled);
								$('#vpsplugin_safemode').prop("checked", !timer.vpsplugin_overwrite);
								$('#has_vpsplugin1').show();
								checkVPS();
							}
							else {
								$('#has_vpsplugin1').hide();
							}
							
							if (typeof timer.always_zap !== 'undefined')
							{
								$('#always_zap1').show();
								$('#always_zap').prop("checked", timer.always_zap==1);
								$('#justplay').prop("disabled",timer.always_zap==1);
							} else {
								$('#always_zap1').hide();
							}
							
							setTimerEditFormTitle(tstr_edit_timer + " - " + timer.name);
							
							break;
						}
				}
			}
		}
	});
	};
	
	if (!timeredit_initialized) {
		initTimerEdit(radio, bottomhalf);
	}
	else
	{
		let _chsref=$("#bouquet_select option:last").val();
		if(radio != isRadio(_chsref)){
			initTimerEdit(radio, bottomhalf);
		} else {
			bottomhalf();
		} 
	}
	
}

function moviesViewUrl(directory, listView, search)
{
	const params = new URLSearchParams();
	if (directory) params.set('dirname', directory);
	if (listView) params.set('recursive', '1');
	if (search) params.set('find', search);
	const query = params.toString();
	return (search ? 'ajax/moviesearch' : 'ajax/movies') + (query ? '?' + query : '');
}

function searchMovies(form)
{
	load_maincontent_spin_force(moviesViewUrl(form.dataset.directory, form.dataset.view === 'list', form.elements['find'].value.trim()));
}

function clearMoviesSearch()
{
	const form = document.querySelector('#movie-search-form');
	if (form) load_maincontent_spin_force(moviesViewUrl(form.dataset.directory, form.dataset.view === 'list'));
}

function toggleMoviesView()
{
	const button = document.querySelector('.movies-view-toggle');
	if (button) load_maincontent_spin(moviesViewUrl(button.dataset.directory, button.dataset.view !== 'list'));
}

function openMoviesDirectory(directory)
{
	const button = document.querySelector('.movies-view-toggle');
	if (button) load_maincontent_spin(moviesViewUrl(directory, button.dataset.view === 'list'));
}

function refreshMoviesView()
{
	const button = document.querySelector('#movie-search-form') || document.querySelector('.movies-view-toggle');
	if (button) load_maincontent_spin_force(moviesViewUrl(button.dataset.directory, button.dataset.view === 'list', button.dataset.search));
}

function changeMoviesort(sort)
{
	MLHelper.SortMovies(sort);
	MLHelper.ChangeSort(sort);
	MLHelper.ReadMovies();
	refreshMoviesView();
}

function changeMoviesortSearch(sort)
{
	changeMoviesort(sort);
}

function initTimerEditForm()
{
	if (timerFormInitiated !== 1) {
		timerFormInitiated = 1;
		addTimer();
		element = document.getElementById('editTimerForm');
		$("#timereditmodal").html(element)
	}
}

function setTimerEditFormTitle(title)
{
	$("#timerEditTitle").html(title);
}

function setVolume(value) {
	$.ajax("web/vol?set=set" + value);
	getStatusInfo();
}

function toggleMute() {
	$.ajax("web/vol?set=mute");
	getStatusInfo();
}

function CallEPGResponsive(url)
{
	load_tvcontent_spin(url);
}

function CallEPG()
{
	$('#myepgbtn2').click(function(){
		$("#tvcontent").load("ajax/multiepg?epgmode=radio");
	});
	
	$('#myepgbtn3').click(function(){
		$("#tvcontent").load("ajax/multiepg?epgmode=tv");
	});
	
	$("#tvbutton").buttonset();
	
	$("#tvcontent").load("ajax/multiepg?epgmode=tv");

}

function myEPGSearch() {
	let spar = $("#epgSearchTVRadio").val();
	let full = $("#myepgbtn0").is(":checked") ? '&full=1' : ''
	let bouquetsonly = $("#myepgbtn1").is(":checked") ? '&bouquetsonly=1' : ''
	let url = "ajax/epgdialog?sstr=" + encodeURIComponent(spar) + full + bouquetsonly;
	
	let w = $(window).width() -100;
	let h = $(window).height() -100;
	
	let buttons = {}
	buttons[tstr_close] = function() { $(this).dialog("close");};
	buttons[tstr_open_in_new_window] = function() { $(this).dialog("close"); open_epg_search_pop(spar,full);};
	
	load_dm_spinner(url,tstr_epgsearch,w,h,buttons);
}

$.Tools = {};

var $searchBar = $('.search-bar-epg');
var $searchBarMovie = $('.search-bar-movie');
$.Tools.epgsearch = {
	activate: function () {
		let _this = this;

		$('.js-search-epg').on('click', function () {
			_this.showSearchBar();
		});

		$searchBar.find('.close-search').on('click', function () {
			_this.hideSearchBar();
		});

		$searchBar.find('.start-search').on('click', function () {
			_this.startSearch();
		});

		$searchBar.find('input[type="text"]').on('keyup', function (e) {
			if (e.keyCode == 27) {
				_this.hideSearchBar();
			} else if (e.keyCode == 13) {
				_this.startSearch();
			}
		});
    },
	showSearchBar: function () {
		$searchBar.addClass('open');
		$searchBar.find('input[type="text"]').focus();
	},
	hideSearchBar: function () {
		$searchBar.removeClass('open');
		$searchBar.find('input[type="text"]').val('');
	},
	startSearch: function() {
		if ($('body').hasClass('ls-closed-manual')) {
			toggleLeftSideBar();
		}
		gotEPGSearch();
		this.hideSearchBar();
	}
}


function gotEPGSearch() {
	let searchstr = $("#epgsearchtext").val();
	let full = $("#myepgbtn0").is(":checked") ? '&full=1' : ''
	

	let bouquetsonly = $("#myepgbtn1").is(":checked") ? '&bouquetsonly=1' : ''
	let url = "ajax/epgdialog?sstr=" + encodeURIComponent(searchstr) + full + bouquetsonly;
	$("#epgSearch").val("");
	load_maincontent(url);
	lastcontenturl = '';
}


function closeMessageModal() {
	$('#messageSentResponse').html('');
}

function sendModalMessage() {
	let text = $('#messageText').val();
	let type = $('#messageType').val();
	let timeout = $('#messageTimeout').val();
	$.ajax({
		url: '/api/message?text=' + text + '&type=' + type + '&timeout=' + timeout,
		dataType: "json",
		cache: false,
		success: function(result) { 
			$('#messageSentResponse').html('<div class="alert alert-info">' + result['message']+ '</div>');
			if(type==0)
			{
				MessageAnswerCounter=timeout;
				setTimeout(countdowngetMessage, 1000);
			}
		}
	});
	$('#messageText').val('');
	$('#messageType').val(1);
	$('#messageType').selectpicker('refresh');
	$('#messageTimeout').val('30');
	$('#messageTimeout').removeClass('active');
	$('#messageText').addClass('active');
}

function btn_saveTimer() {
				let enddate = moment($('#timerend').val(), "DD.MM.YYYY hh:mm").unix();
				let repeated = 0;
				$('[name="repeated"]:checked').each(function() {
					repeated += parseInt($(this).val());
				});
				let selectedTags = timerTagChoices.getValue(true);
				let tags = selectedTags.join(' ');
				let urldata = { sRef: $('#bouquet_select').val(),
					end: enddate,
					name: $('#timername').val(),
					description: $('#description').val(),
					disabled: ($('#enabled').is(':checked')?"0":"1"),
					allow_duplicate: ($('#allow_duplicate').is(':checked')?"1":"0"),
					afterevent: $('#afterevent').val(),
					tags: tags,
					repeated: repeated };
				
				if($('#always_zap').is(':checked')) {
					urldata["always_zap"] = "1";
					urldata["justplay"] = "0";
				}
				else
					urldata["justplay"] = $('#justplay').is(':checked')?"1":"0";
				
				if ($('#dirname').val() != 'None')
					urldata["dirname"] = $('#dirname').val();
				if (!$('#has_vpsplugin1').is(':hidden'))
				{
					urldata["vpsplugin_enabled"] = ($('#vpsplugin_enabled').is(':checked')?"1":"0");
					urldata["vpsplugin_overwrite"] = ($('#vpsplugin_safemode').is(':checked')?"0":"1");
				}
				if (!timeredit_begindestroy) {
					let begindate = moment($('#timerbegin').val(), "DD.MM.YYYY hh:mm").unix();
					urldata["begin"] = begindate;
				}
				else
					urldata["begin"] = Math.round(current_begin);
				
				let canclose = false;
				if (current_serviceref == "") {
					$.ajax({
						async: false,
			            dataType: "json",
			            cache: false,
						url: "/api/timeradd?",
						data: urldata,
						success: function(result) {
							if (result.result) {
								canclose = true;
							}
							else {
								if(result.conflicts)
								{
									let conftext='Timer Conflicts:<br>';
									result.conflicts.forEach(function(entry) {
										conftext += entry.name+" / "+entry.servicename+" / "+entry.realbegin+" - "+entry.realend+"<br>";
									});
									showErrorMain(conftext);
								} else {
									showErrorMain(result.message);
								}
							}
						}
					});
				}
				else {
					urldata['channelOld'] = current_serviceref;
					urldata['beginOld'] = Math.round(current_begin);
					urldata['endOld'] = Math.round(current_end);
					$.ajax({
						async: false,
			            dataType: "json",
			            cache: false,
						url: "api/timerchange?",
						data: urldata,
						success: function(result) {
							if (result.result) {
								canclose = true;
							}
							else {
								if(result.conflicts)
								{
									let conftext='Timer Conflicts:<br>';
									result.conflicts.forEach(function(entry) {
										conftext += entry.name+" / "+entry.servicename+" / "+entry.realbegin+" - "+entry.realend+"<br>";
									});
									$("#error").text(conftext);
								} else {
									$("#error").text(result.message);
								}
							}
						}
					});
				}
				
				if (canclose) {
					selectedTags.forEach(tag => {
						if (!_tags.includes(tag)) _tags.push(tag);
					});
					refreshEpgTimers();
					if (reloadTimers) {
							if ( lastcontenturl.startsWith('ajax/timers') ) {
								lastcontenturl = '';
								setTimeout(function(){load_maincontent("ajax/timers")}, 500);
							}
					}
				}
			}

function WebConfig() {
	
	$('#myepgbtn0').change(function () {
		let fullsearch = $("#myepgbtn0").is(":checked") ? '1' : '0'
		$.get('api/setwebconfig?epgsearch_full=' + fullsearch);
	});
	
	$('#myepgbtn1').change(function () {
		let bqonly = $("#myepgbtn1").is(":checked") ? '1' : '0'
		$.get('api/setwebconfig?epgsearch_only_bq=' + bqonly);
	});
	
	$('#remotegrabscreen1').change(function () {
		let val = $(this).is(":checked") ? '1' : '0'
		$.get('api/setwebconfig?rcu_screenshot=' + val);
	});

	$('#remotecontrolview').change(function () {
		let val = $(this).is(":checked") ? '1' : '0'
		$.get('api/setwebconfig?rcu_full_view=' + val);
		toggleFullRemote();
	});

	$('#minmovielist').change(function () {
		let val = $(this).is(":checked") ? '1' : '0'
		$.get('api/setwebconfig?minmovielist=' + val, function(result) {
			if (result.result && /^ajax\/movies(?:earch)?(?:\?|$)/.test(lastcontenturl)) {
				load_maincontent_spin_force(lastcontenturl);
			}
		});
	});
	$('#mintimerlist').change(function () {
		let val = $(this).is(":checked") ? '1' : '0'
		$.get('api/setwebconfig?mintimerlist=' + val, function(result) {
			if (result.result && /^ajax\/timers(?:\?|$)/.test(lastcontenturl)) {
				load_maincontent_spin_force(lastcontenturl);
			}
		});
	});
	$('#minepglist').change(function () {
		let val = $(this).is(":checked") ? '1' : '0'
		$.get('api/setwebconfig?minepglist=' + val);
	});
	$('#epg_jump_now').change(function () {
		let val = $(this).is(":checked") ? '1' : '0'
		$.get('api/setwebconfig?epg_jump_now=' + val);
	});
	$('#epg_jump_active_service').change(function () {
		let val = $(this).is(":checked") ? '1' : '0'
		$.get('api/setwebconfig?epg_jump_active_service=' + val);
	});
	$('#epg_hourly_lines, #epg_channel_lines').change(function () {
		let key = this.id;
		let enabled = $(this).is(":checked");
		$.get('api/setwebconfig?' + key + '=' + (enabled ? '1' : '0'), function(result) {
			if (result.result) {
				$(window).trigger('epgGridSettings', [{[key === 'epg_hourly_lines' ? 'hourlyLines' : 'channelLines']: enabled}]);
			}
		});
	});
	$('#zapstream').change(function () {
		let val = $(this).is(":checked") ? '1' : '0'
		$.get('api/setwebconfig?zapstream=' + val);
	});
	$('#showpicons').change(function () {
		let val = $(this).is(":checked") ? '1' : '0'
		$.get('api/setwebconfig?showpicons=' + val);
		$('#showpiconbackground').prop('disabled', !val);
	});
	$('#showpiconbackground').change(function () {
		let val = $(this).is(":checked") ? '1' : '0'
		$.get('api/setwebconfig?showpiconbackground=' + val);
	});
	$('#showiptvchannelsinselection').change(function () {
		let val = $(this).is(":checked") ? '1' : '0'
		$.get('api/setwebconfig?showiptvchannelsinselection=' + val);
	});

	$('#screenshotchannelname').change(function () {
		let val = $(this).is(":checked") ? '1' : '0'
		$.get('api/setwebconfig?screenshotchannelname=' + val);
	});

	$('#thememodebtn').change(function () {
		let themeMode = $(this).is(":checked") ? $(this).val() : 'supabright';
		$('body').removeClass(function (index, className) {
			return (className.match(/(^|\s)theme--\S+/g) || []).join(' ');
		});
		if ($(this).is(":checked")) {
			$('body').addClass('theme--' + themeMode);
		} else {
			$('body').addClass('theme--' + 'supabright');
		}
		$.get('api/setthememode?themeMode=' + themeMode);
	});
	$('#nownext_columns').change(function () {
		let val = $(this).is(":checked") ? '1' : '0'
		$.get('api/setwebconfig?nownext_columns=' + val);
	});

}
/*
//Skin tab content set height and show scroll
function setSkinListHeightAndScroll(isFirstTime) {
	var height = $(window).height() - ($('.navbar').innerHeight() + $('.right-sidebar .nav-tabs').outerHeight());
	var $el = $('.skin-switcher');

	if (!isFirstTime){
		$el.slimScroll({ destroy: true }).height('auto');
		$el.parent().find('.slimScrollBar, .slimScrollRail').remove();
	}

	$el.slimscroll({
		height: height + 'px',
		color: 'rgba(0,0,0,0.5)',
		size: '6px',
		alwaysVisible: false,
		borderRadius: '0',
		railBorderRadius: '0'
	});
}

//Setting tab content set height and show scroll
function setSettingListHeightAndScroll(isFirstTime) {
	var height = $(window).height() - ($('.navbar').innerHeight() + $('.right-sidebar .nav-tabs').outerHeight());
	var $el = $('.right-sidebar .demo-settings');

	if (!isFirstTime){
		$el.slimScroll({ destroy: true }).height('auto');
		$el.parent().find('.slimScrollBar, .slimScrollRail').remove();
	}

	$el.slimscroll({
		height: height + 'px',
		color: 'rgba(0,0,0,0.5)',
		size: '6px',
		alwaysVisible: false,
		borderRadius: '0',
		railBorderRadius: '0'
	});
}

//Activate notification and task dropdown on top right menu
function activateNotificationAndTasksScroll() {
	$('.navbar-right .dropdown-menu .body .menu').slimscroll({
		height: '254px',
		color: 'rgba(0,0,0,0.5)',
		size: '4px',
		alwaysVisible: false,
		borderRadius: '0',
		railBorderRadius: '0'
	});
}
*/
function showErrorMain(txt,st)
{
	st = typeof st !== 'undefined' ? st : "False";
	let infotype = "error";
	if (st === true || st === 'True' || st === 'true') {
		infotype = "success";
	}
	
	if (txt !== '') {
		swal("", txt, infotype);
	} else {
		$('#statuscont').hide();
	}
	
}

function startInstantRecord() {
	let button = document.getElementById('osd__current-event__record');
	if (!button || button.disabled) return;
	button.disabled = true;
	return owif.stb.instantRecord().then(function(response) {
		let success = response && (response.result === true || response.result === 'true' || response.result === 'True');
		showErrorMain(response && response.message || tstr_oops, success);
		if (success) getStatusInfo();
	}).catch(function(error) {
		showErrorMain(error.message || tstr_oops, false);
	}).finally(function() {
		button.disabled = false;
	});
}

function deleteTimer(sRef, begin, end, title, callback) {
	let t = decodeURIComponent(title);
	swal({
		title: tstr_del_timer,
		text: t,
		type: "warning",
		showCancelButton: true,
		confirmButtonColor: "#DD6B55",
		confirmButtonText: tstrings_yes_delete,
		cancelButtonText: tstrings_no_cancel,
		animation: "none"
	}, function (isConfirm) {
		if (isConfirm) {
			webapi_execute_result("/api/timerdelete?sRef=" + sRef + "&begin=" + begin + "&end=" + end,
			function(state, txt) {
				if (state) {
					$('#'+begin+'-'+end).remove();
					if (typeof callback === 'function') callback();
				} else {
					showErrorMain(txt);
				}
			});
		}
	});
}

function deleteMovie(sRef, divid, title) {
	
	swal({
		title: tstr_del_recording,
		text: title,
		type: "warning",
		showCancelButton: true,
		confirmButtonColor: "#DD6B55",
		confirmButtonText: tstrings_yes_delete,
		cancelButtonText: tstrings_no_cancel,
		closeOnConfirm: false,
		animation: "none"
	}, function (isConfirm) {
		if (isConfirm) {
			webapi_execute_movie("/api/moviedelete?sRef=" + sRef,
				function (state) {
					if(state){ 
						swal(tstrings_deleted, title, "success");
						$('#' + divid).remove();
					}
				}
			);
		}
	});
}

function renameMovie(sRef, title) {
	swal({
		title: tstr_ren_recording,
		text: title,
		type: "input",
		showCancelButton: true,
		closeOnConfirm: false,
		animation: "none",
		inputPlaceholder: title,
		inputValue: title,
		input: "text"
	}, function (newname) {
		if ( (newname === false) || (newname === title) ) return false;
		if (newname === "") {
			swal.showInputError(tstrings_need_input); return false
		}
		webapi_execute_movie("/api/movierename?sRef=" + sRef+"&newname="+newname);
		showErrorMain(newname, true);
	});
}

function closeSideBar() {
	let $body = $('body');
	let width = $body.width();
	if (width < $.AdminBSB.options.leftSideBar.breakpointWidth) {
		let $openCloseBar = $('#leftsidebarin');
		$body.addClass('ls-closed');
		$openCloseBar.fadeIn();
	} else {
		$body.removeClass('ls-closed');
        //$('.sidebar').hide();
  }
}


function CallEPG()
{
	$('#myepgbtn2').click(function(){
		$("#tvcontent").load("ajax/multiepg?epgmode=radio");
	});
	
	$('#myepgbtn3').click(function(){
		$("#tvcontent").load("ajax/multiepg?epgmode=tv");
	});
	
	$("#tvbutton").buttonset();
	
	$("#tvcontent").load("ajax/multiepg?epgmode=tv");
	
	if (theme == 'pepper-grinder')
		$("#tvcontent").addClass('ui-state-active');
	
}

function myEPGSearch() {
	let spar = $("#epgSearchTVRadio").val();
	let full = $("#myepgbtn0").is(":checked") ? '&full=1' : '';
	let bouquetsonly = $("#myepgbtn1").is(":checked") ? '&bouquetsonly=1' : '';
	let url = "ajax/epgdialog?sstr=" + encodeURIComponent(spar) + full + bouquetsonly;
	
	let w = $(window).width() -100;
	let h = $(window).height() -100;
	
	let buttons = {};
	buttons[tstr_close] = function() { $(this).dialog("close");};
	buttons[tstr_open_in_new_window] = function() { $(this).dialog("close"); open_epg_search_pop(spar,full);};
	
	load_dm_spinner(url,tstr_epgsearch,w,h,buttons);
}
