import ast
import importlib.util
import json
from collections import OrderedDict
from datetime import datetime, timedelta
from html import unescape
from pathlib import Path
from time import localtime, mktime
from types import SimpleNamespace
from urllib.parse import unquote
import unittest


ROOT = Path(__file__).resolve().parents[1]
SERVICES = ROOT / 'plugin/controllers/models/services.py'
AJAX = ROOT / 'plugin/controllers/ajax.py'
RENDERER = ROOT / 'plugin/controllers/views/responsive/ajax/renderevtblock.py'
TEMPLATE = ROOT / 'plugin/controllers/views/responsive/ajax/multiepg.tmpl'
EPG_CSS = ROOT / 'sourcefiles/modern/css/multiepg.css'


class EpgTimerMarkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = ast.parse(SERVICES.read_text(encoding='utf-8'))
        multi_epg = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'getMultiEpg')
        details = next(node for node in multi_epg.body if isinstance(node, ast.FunctionDef) and node.name == 'getTimerDetails')
        namespace = {}
        exec(compile(ast.Module(body=[details], type_ignores=[]), str(SERVICES), 'exec'), namespace)
        cls.get_timer_details = staticmethod(namespace['getTimerDetails'])
        cls.multi_epg_code = compile(ast.Module(body=[multi_epg], type_ignores=[]), str(SERVICES), 'exec')

        spec = importlib.util.spec_from_file_location('responsive_epg_renderer', RENDERER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        cls.renderer = module.renderEvtBlock()
        cls.template = TEMPLATE.read_text(encoding='utf-8')

    def event(self, timer):
        return {'id': 1, 'ref': '1:0:1:', 'begin_timestamp': 1000, 'duration': 3600,
                'title': 'Test', 'shortdesc': 'Description', 'timer': timer}

    def epg_events(self, timers, mode, modern=True, begin_time=None, events=None):
        start = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        ref = '1:0:1:'
        if events is None:
            events = [(10 + i, start + i * 3600, 'Event', 'Description', ref, 'Channel', 3600)
                      for i in range(3)]
        namespace = {
            'OrderedDict': OrderedDict,
            'datetime': datetime,
            'timedelta': timedelta,
            'eServiceCenter': SimpleNamespace(getInstance=lambda: SimpleNamespace(
                list=lambda _: SimpleNamespace(getContent=lambda _: [ref]))),
            'eServiceReference': lambda value: value,
            'EPG': lambda: SimpleNamespace(getMultiChannelEvents=lambda *_: events),
            'localtime': localtime,
            'mktime': mktime,
            'getPicon': lambda _: '/picon',
            'filterName': lambda value: value,
            'convertDesc': lambda value: value,
        }
        exec(self.multi_epg_code, namespace)
        record_timer = SimpleNamespace(timer_list=timers, processed_timers=[])
        controller = SimpleNamespace(session=SimpleNamespace(nav=SimpleNamespace(RecordTimer=record_timer)))
        result = namespace['getMultiEpg'](controller, 'bouquet',
                                          start + 3630 if begin_time is None else begin_time,
                                          None, mode, modern=modern)
        return [event for slot in result['events'][ref if modern else 'Channel'] for event in slot]

    def test_short_zap_timer_is_assigned_to_its_event_in_both_views(self):
        start = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        for mode in (1, 2):
            for flags, marker_type in (({'justplay': 1}, 'zap'),
                                       ({'justplay': 1, 'always_zap': 1}, 'record-zap')):
                with self.subTest(mode=mode, marker_type=marker_type):
                    timer = SimpleNamespace(service_ref='1:0:1:', begin=start + 3600,
                                            end=start + 3601, eit=11, disabled=0, **flags)
                    events = self.epg_events([timer], mode)
                    self.assertEqual([event['timer']['markerType'] if event['timer'] else None
                                      for event in events], [None, marker_type, None])

    def test_zap_timer_without_eit_matches_event_start(self):
        start = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        timer = SimpleNamespace(service_ref='1:0:1:', begin=start + 3600,
                                end=start + 3601, eit=0, disabled=0, justplay=1)
        events = self.epg_events([timer], 1)
        self.assertEqual([event['timer']['markerType'] if event['timer'] else None
                          for event in events], [None, 'zap', None])

    def test_zap_timer_with_early_start_and_no_end_time(self):
        start = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        timer = SimpleNamespace(service_ref='1:0:1:', begin=start + 3300,
                                end=start + 3300, eit=11, disabled=0, justplay=1)
        for mode in (1, 2):
            with self.subTest(mode=mode):
                events = self.epg_events([timer], mode)
                self.assertEqual([event['timer']['markerType'] if event['timer'] else None
                                  for event in events], [None, 'zap', None])

    def test_zap_timer_before_day_start_matches_original_event(self):
        start = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        timer = SimpleNamespace(service_ref='1:0:1:', begin=start - 300, end=start - 300,
                                eventBegin=start, eit=10, disabled=0, justplay=1)
        for mode in (1, 2):
            with self.subTest(mode=mode):
                events = self.epg_events([timer], mode, begin_time=start)
                self.assertEqual([event['timer']['markerType'] if event['timer'] else None
                                  for event in events], ['zap', None, None])

    def test_recording_coverage_and_wrong_zap_eit(self):
        start = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        for mode in (1, 2):
            for flags, expected in (({'justplay': 0}, 'record'),
                                    ({'justplay': 0, 'always_zap': 1}, 'record-zap')):
                with self.subTest(mode=mode, expected=expected):
                    timer = SimpleNamespace(service_ref='1:0:1:', begin=start + 3540,
                                            end=start + 7260, disabled=0, **flags)
                    events = self.epg_events([timer], mode)
                    self.assertEqual([event['timer']['markerType'] if event['timer'] else None
                                      for event in events], [None, expected, None])

            wrong_eit = SimpleNamespace(service_ref='1:0:1:', begin=start + 3600,
                                        end=start + 3601, eit=42, disabled=0, justplay=1)
            with self.subTest(mode=mode, expected=None):
                self.assertTrue(all(event['timer'] is None for event in self.epg_events([wrong_eit], mode)))

    def test_repeated_recording_marks_selected_weekdays_not_other_broadcasts(self):
        monday = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        timer = SimpleNamespace(service_ref='1:0:1:', begin=monday + 3540,
                                end=monday + 7260, repeated=1 | 2,
                                disabled=0, justplay=0)
        for mode in (1, 2):
            for day, marked in ((28, True), (29, True), (30, False), (5, True)):
                month = 9 if day >= 28 else 10
                day_start = int(mktime((2026, month, day, 0, 0, 0, -1, -1, -1)))
                events = [(day, day_start + hour * 3600, 'Galileo', 'Description',
                           '1:0:1:', 'Channel', 3600) for hour in (1, 3)]
                with self.subTest(mode=mode, day=day):
                    result = self.epg_events([timer], mode, begin_time=day_start + 3630, events=events)
                    self.assertEqual([bool(event['timer']) for event in result], [marked, False])
                    if marked:
                        self.assertEqual((result[0]['timer']['begin'], result[0]['timer']['end']),
                                         (timer.begin, timer.end))

        tuesday = int(mktime((2026, 9, 29, 0, 0, 0, -1, -1, -1)))
        event = [(20, tuesday + 3600, 'Galileo', 'Description', '1:0:1:', 'Channel', 3600)]
        for mode in (1, 2):
            with self.subTest(mode=mode, modern=False):
                self.assertIsNone(self.epg_events([timer], mode, modern=False,
                                                   begin_time=tuesday, events=event)[0]['timer'])

    def test_repeated_overnight_recording_uses_start_weekday(self):
        monday = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        timer = SimpleNamespace(service_ref='1:0:1:', begin=monday + 23 * 3600 + 29 * 60,
                                end=int(mktime((2026, 9, 29, 0, 32, 0, -1, -1, -1))),
                                repeated=1, disabled=0, justplay=0)
        for mode in (1, 2):
            for day, expected in ((29, True), (5, False), (6, True)):
                month = 9 if day == 29 else 10
                event_start = int(mktime((2026, month, day, 0, 0, 0, -1, -1, -1)))
                events = [(day, event_start, 'After midnight', 'Description',
                           '1:0:1:', 'Channel', 1800)]
                with self.subTest(mode=mode, day=day):
                    result = self.epg_events([timer], mode, begin_time=event_start, events=events)
                    self.assertEqual(bool(result[0]['timer']), expected)

    def test_repeated_zap_matches_event_time_even_when_eit_changes(self):
        monday = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        tuesday = int(mktime((2026, 9, 29, 0, 0, 0, -1, -1, -1)))
        events = [(20 if hour == 1 else 10, tuesday + hour * 3600, 'Galileo', 'Description',
                   '1:0:1:', 'Channel', 3600) for hour in (1, 3)]
        for event_begin, timer_begin in ((None, monday + 3600), (monday + 3600, monday + 3300)):
            timer = SimpleNamespace(service_ref='1:0:1:', begin=timer_begin,
                                    end=timer_begin + 1, eventBegin=event_begin, eit=10,
                                    repeated=3, disabled=0, justplay=1)
            for mode in (1, 2):
                with self.subTest(mode=mode, event_begin=event_begin):
                    result = self.epg_events([timer], mode, begin_time=tuesday, events=events)
                    self.assertEqual([bool(event['timer']) for event in result], [True, False])
                    self.assertEqual((result[0]['timer']['begin'], result[0]['timer']['end']),
                                     (timer.begin, timer.end))

    def test_repeated_timer_remains_available_after_other_timer_matches(self):
        monday = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        repeated = SimpleNamespace(service_ref='1:0:1:', begin=monday + 5 * 3600,
                                   end=monday + 6 * 3600, repeated=3, disabled=0, justplay=0)
        once = SimpleNamespace(service_ref='1:0:1:', begin=monday + 3 * 3600,
                               end=monday + 4 * 3600, disabled=0, justplay=0)
        events = [(10, monday + hour * 3600, 'Event', 'Description',
                   '1:0:1:', 'Channel', 3600) for hour in (3, 5)]
        for mode in (1, 2):
            with self.subTest(mode=mode):
                result = self.epg_events([repeated, once], mode, begin_time=monday, events=events)
                self.assertEqual([event['timer']['begin'] for event in result], [once.begin, repeated.begin])

    def test_classic_epg_keeps_existing_short_timer_behavior(self):
        start = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        timer = SimpleNamespace(service_ref='1:0:1:', begin=start + 3600,
                                end=start + 3601, eit=11, disabled=0, justplay=1)
        for mode in (1, 2):
            with self.subTest(mode=mode):
                self.assertTrue(all(event['timer'] is None
                                    for event in self.epg_events([timer], mode, modern=False)))

    def test_controller_enables_short_zaps_only_for_responsive_template(self):
        source = ast.parse(AJAX.read_text(encoding='utf-8'))
        controller = next(node for node in source.body if isinstance(node, ast.ClassDef)
                          and node.name == 'AjaxController')
        handler = next(node for node in controller.body if isinstance(node, ast.FunctionDef)
                       and node.name == 'P_multiepg')
        for view, modern in (('responsive', True), ('ajax', False)):
            with self.subTest(view=view):
                path = '/views/responsive/ajax/multiepg.tmpl' if modern else '/views/ajax/multiepg.tmpl'
                namespace = {
                    'getUrlArg': lambda request, name, default=None: default,
                    'getBouquets': lambda mode: {'bouquets': [('bouquet', 'Favorite')]},
                    'getViewsPath': lambda name: path,
                    'VIEWS_PATH': '/views',
                    'getMultiEpg': lambda *args, **kwargs: {'modern': kwargs['modern']},
                    'config': SimpleNamespace(OpenWebif=SimpleNamespace(webcache=SimpleNamespace(
                        mepgmode=SimpleNamespace(value=0), epg_jump_now=SimpleNamespace(value=0),
                        epg_jump_active_service=SimpleNamespace(value=0), epg_hourly_lines=SimpleNamespace(value=True),
                        epg_channel_lines=SimpleNamespace(value=True)))),
                    'NavigationInstance': SimpleNamespace(instance=None),
                }
                exec(compile(ast.Module(body=[handler], type_ignores=[]), str(AJAX), 'exec'), namespace)
                result = namespace['P_multiepg'](SimpleNamespace(), None)
                self.assertIs(result['modern'], modern)

    def test_marker_type_in_both_views(self):
        cases = (
            ('record', {'justplay': 0}, 'record'),
            ('zap', {'justplay': 1}, 'zap'),
            ('record and zap', {'justplay': 0, 'always_zap': 1}, 'record-zap'),
            ('record and zap with justplay flag', {'justplay': 1, 'always_zap': 1}, 'record-zap'),
            ('record and zap on older boxes', {'justplay': 0, 'zapbeforerecord': 1}, 'record-zap'),
            ('disabled zap', {'justplay': 1, 'disabled': 1}, 'zap'),
            ('AutoTimer recording', {'justplay': 0, 'isAutoTimer': 1}, 'record'),
        )
        for name, attributes, expected in cases:
            with self.subTest(name=name):
                timer = SimpleNamespace(disabled=0, justplay=0, always_zap=0, isAutoTimer=0)
                for key, value in attributes.items():
                    setattr(timer, key, value)
                details = self.get_timer_details(timer)
                details.update({'sref': '1:0:1:', 'begin': 1000, 'end': 4600})
                self.assertEqual(details['markerType'], expected)
                self.assertIn('event--has-timer timer--' + expected, self.renderer.render(self.event(details)))
                self.assertIn("$event['timer']['markerType']", self.template)
                self.assertIn('class="event$timerClass$iscurr"', self.template)

    def test_zap_timer_without_always_zap(self):
        timer = SimpleNamespace(disabled=0, justplay=1)
        self.assertEqual(self.get_timer_details(timer)['markerType'], 'zap')

    def test_events_without_timers_have_no_marker(self):
        self.assertNotIn('event--has-timer', self.renderer.render(self.event(None)))
        self.assertIn("#if $event['timer']", self.template)

    def test_marker_identifies_matching_timer_not_event_in_both_views(self):
        start = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        timer = SimpleNamespace(service_ref='1:0:1:', begin=start + 3300,
                                end=start + 3301, eit=11, disabled=0, justplay=1)
        for mode in (1, 2):
            with self.subTest(mode=mode):
                events = self.epg_events([timer], mode)
                self.assertEqual(events[1]['timer']['sref'], '1:0:1:')
                self.assertEqual(events[1]['timer']['begin'], timer.begin)
                self.assertEqual(events[1]['timer']['end'], timer.end)
                self.assertNotEqual(events[1]['begin_timestamp'], timer.begin)
        recording = SimpleNamespace(service_ref='1:0:1:', begin=start + 3600,
                                    end=start + 7200, disabled=0, justplay=0)
        classic = self.epg_events([recording], 1, modern=False)
        self.assertIsNotNone(classic[1]['timer'])
        self.assertNotIn('begin', classic[1]['timer'])

    def test_timer_marker_opens_edit_modal_without_opening_event(self):
        details = {'markerType': 'zap', 'isEnabled': 1, 'isAutoTimer': 0,
                   'sref': '1:0:1:', 'begin': 1005, 'end': 1006}
        markup = self.renderer.render(self.event(details))
        self.assertIn('class="epg__timer-marker"', markup)
        self.assertIn('data-target="#TimerModal"', markup)
        self.assertIn('&quot;begin&quot;:1005', markup)
        self.assertIn('&quot;end&quot;:1006', markup)
        self.assertIn('epg__timer-marker', self.template)
        self.assertIn('data-target="#TimerModal"', self.template)
        self.assertIn("$event['timer']['begin']", self.template)
        self.assertIn("$event['timer']['end']", self.template)
        self.assertIn("closest('.epg__timer-marker')", markup)
        self.assertIn("closest('.epg__timer-marker')", self.template)
        self.assertIn("event.stopPropagation(); jQuery('#TimerModal').modal('show', this)", markup)
        self.assertIn("event.stopPropagation(); jQuery('#TimerModal').modal('show', this)", self.template)
        self.assertNotIn('class="epg__timer-marker"', self.renderer.render(self.event(None)))

    def test_marker_metadata_encodes_service_reference_for_timer_dialog(self):
        details = {'markerType': 'record', 'isEnabled': 1, 'isAutoTimer': 0,
                   'sref': '1:0:1:http%3a//box.example/a?x=1&y=2', 'begin': 1005, 'end': 5000}
        markup = self.renderer.render(self.event(details))
        metadata = markup.split('data-metadata="', 1)[1].split('"', 1)[0]
        identity = json.loads(unescape(metadata))
        self.assertEqual(unquote(identity['sref']), details['sref'])
        self.assertEqual((identity['begin'], identity['end']), (1005, 5000))
        self.assertNotIn('id', identity)

    def test_marker_colors_are_shared_between_views(self):
        css = EPG_CSS.read_text(encoding='utf-8')
        self.assertIn('.modern-epg .epg__event.event--has-timer::after', css)
        self.assertIn('.modern-epg--timeline .event.event--has-timer::before', css)
        self.assertIn('background: var(--epg-timer-marker)', css)
        for timer_type, color in (('record', '#e53935'), ('zap', '#1e88e5')):
            self.assertIn('.modern-epg .timer--' + timer_type + ' { --epg-timer-marker: ' + color, css)
        self.assertIn('.modern-epg .timer--record-zap { --epg-timer-marker: linear-gradient(to bottom, #e53935 50%, #1e88e5 50%)', css)


if __name__ == '__main__':
    unittest.main()
