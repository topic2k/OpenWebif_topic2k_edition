# -*- coding: utf-8 -*-

from html import escape
from json import dumps
from time import localtime, strftime
from urllib.parse import quote
# from Plugins.Extensions.OpenWebif.controllers.i18n import tstrings


class renderEvtBlock:
	def __init__(self):
		self.template = """
		<article onclick="if (event.target.closest('.epg__timer-marker')) return; loadeventepg('%s', '%s'); return false;" class="epg__event event %s" tabindex="0" data-ref="%s" data-id="%s" data-begin="%s" data-end="%s" data-toggle="modal" data-target="#EventModal">
			<div class="epg__event-info">
			<time class="epg__time--start">%s</time>
			<span class="epg__title title">
				%s
			</span>
			%s
			</div>
			%s
		</article>
		"""

	def render(self, event, edit_timer_title='Edit Timer'):
		eventcssclass = ''
		timermarker = ''

		timer = event['timer']
		if timer:
			eventcssclass = eventcssclass + ' event--has-timer timer--' + timer['markerType']
			metadata = escape(dumps({'sref': quote(timer['sref']), 'begin': timer['begin'], 'end': timer['end']}, separators=(',', ':')), quote=True)
			timermarker = '<button type="button" class="epg__timer-marker" data-metadata="%s" data-toggle="modal" data-target="#TimerModal" onclick="event.stopPropagation(); jQuery(\'#TimerModal\').modal(\'show\', this); return false;" title="%s" aria-label="%s"></button>' % (metadata, escape(edit_timer_title, quote=True), escape(edit_timer_title, quote=True))
			if timer['isEnabled']:
				timereventsymbol = '<i class="material-icons material-icons-centered">alarm_on</i>'
			else:
				timereventsymbol = '<i class="material-icons material-icons-centered">alarm_off</i>'
			if timer['isAutoTimer']:
				timereventsymbol = timereventsymbol + '<i class="material-icons material-icons-centered">av_timer</i>'
		else:
			timereventsymbol = ''

		if event['title'] != event['shortdesc']:
			shortdesc = '<summary class="epg__desc desc"><span class="epg__timer-status">%s</span>%s</summary>' % (
				timereventsymbol,
				event['shortdesc']
			)
		else:
			shortdesc = ''

		sref = quote(event['ref'], safe=' ~@#$()*!+=:;,.?/\'')
		begints = event.get('begin_timestamp', 0)
		endts = begints + event.get('duration', 0)

		return self.template % (
			event['id'],
			sref,
			eventcssclass,
			sref,
			event['id'],
			begints,
			endts,
			strftime("%H:%M", localtime(event['begin_timestamp'])),
			escape(event['title'], quote=False),
			shortdesc,
			timermarker
		)
