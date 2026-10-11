import ast
from collections import defaultdict, OrderedDict
from html import escape
from html.parser import HTMLParser
import importlib.util
import json
from pathlib import Path
import time
from types import ModuleType, SimpleNamespace
from urllib.parse import quote, unquote
import unittest
from unittest.mock import patch

from Cheetah.Template import Template


ROOT = Path(__file__).resolve().parents[1]
SERVICES = ROOT / 'plugin/controllers/models/services.py'
VIEWS = ROOT / 'plugin/controllers/views/responsive/ajax'
REFS = ('1:0:1:20:1:1:0:0:0:0:', '1:0:1:10:1:1:0:0:0:0:')
CHANNEL_NAME = 'News & Info <HD>'


class EpgChannelParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.elements = []
        self.text = []

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))

    def handle_data(self, data):
        self.text.append(data)


class ModernEpgChannelIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = ast.parse(SERVICES.read_text(encoding='utf-8'))
        multi_epg = next(node for node in source.body
                         if isinstance(node, ast.FunctionDef) and node.name == 'getMultiEpg')
        cls.multi_epg_code = compile(ast.Module(body=[multi_epg], type_ignores=[]), str(SERVICES), 'exec')
        translations = ModuleType('Plugins.Extensions.OpenWebif.controllers.i18n')
        translations.tstrings = defaultdict(str, edit_timer='Edit Timer', timer='Timer')
        modules = {translations.__name__: translations}
        for name in ('epgdaterange', 'renderevtblock'):
            module_name = 'Plugins.Extensions.OpenWebif.controllers.views.responsive.ajax.' + name
            spec = importlib.util.spec_from_file_location(module_name, VIEWS / (name + '.py'))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            modules[module_name] = module
        with patch.dict('sys.modules', modules):
            cls.template = Template.compile(source=(VIEWS / 'multiepg.tmpl').read_text(encoding='utf-8'))

    def setUp(self):
        self.start = int(time.mktime((2026, 10, 4, 0, 0, 0, -1, -1, -1)))
        self.events = [
            (10, self.start, 'First', 'Description', REFS[0], CHANNEL_NAME, 3600),
            (11, self.start, 'Second', 'Description', REFS[1], CHANNEL_NAME, 3600),
            (12, self.start + 7200, 'Later', 'Description', REFS[0], CHANNEL_NAME, 3600),
        ]

    def get_epg(self, mode, modern=None, timers=()):
        namespace = {
            'OrderedDict': OrderedDict,
            'eServiceCenter': SimpleNamespace(getInstance=lambda: SimpleNamespace(
                list=lambda _: SimpleNamespace(getContent=lambda _: list(REFS)))),
            'eServiceReference': lambda value: value,
            'EPG': lambda: SimpleNamespace(getMultiChannelEvents=lambda *_: self.events),
            'localtime': time.localtime,
            'mktime': time.mktime,
            'filterName': escape,
            'convertDesc': escape,
            'getPicon': lambda ref: '/picon/' + quote(ref, safe='') + '.png',
        }
        exec(self.multi_epg_code, namespace)
        record_timer = SimpleNamespace(timer_list=list(timers), processed_timers=[])
        controller = SimpleNamespace(session=SimpleNamespace(nav=SimpleNamespace(RecordTimer=record_timer)))
        kwargs = {} if modern is None else {'modern': modern}
        return namespace['getMultiEpg'](controller, 'bouquet', self.start, None, mode, **kwargs)

    def test_equal_names_keep_separate_events_references_and_picons_in_both_views(self):
        for mode in (1, 2):
            with self.subTest(mode=mode):
                result = self.get_epg(mode, modern=True)
                self.assertTrue(result['result'])
                for field in ('events', 'channelnames', 'channelrefs', 'picons'):
                    self.assertEqual(list(result[field]), list(REFS))
                self.assertEqual(result['channelnames'], dict.fromkeys(REFS, escape(CHANNEL_NAME)))
                self.assertEqual(result['channelrefs'], {ref: ref for ref in REFS})
                self.assertEqual(result['picons'], {ref: '/picon/' + quote(ref, safe='') + '.png' for ref in REFS})
                for ref, expected_ids in zip(REFS, ([10, 12], [11])):
                    slots = result['events'][ref]
                    self.assertEqual(len(slots), 12 if mode == 1 else 1)
                    events = [event for slot in slots for event in slot]
                    self.assertEqual([event['id'] for event in events], expected_ids)
                    self.assertTrue(all(event['ref'] == ref for event in events))
                if mode == 1:
                    self.assertEqual(result['events'][REFS[0]][1][0]['id'], 12)

    def test_same_reference_stays_one_channel_when_label_changes(self):
        self.events[2] = (*self.events[2][:5], 'Renamed channel', self.events[2][6])
        for mode in (1, 2):
            with self.subTest(mode=mode):
                result = self.get_epg(mode, modern=True)
                self.assertEqual(list(result['events']), list(REFS))
                self.assertEqual(result['channelnames'][REFS[0]], escape(CHANNEL_NAME))
                self.assertEqual([event['id'] for slot in result['events'][REFS[0]] for event in slot], [10, 12])

    def test_iptv_references_with_different_stream_urls_remain_separate(self):
        refs = ['4097:0:1:0:0:0:0:0:0:0:http%3a//example.com/' + name for name in ('first', 'second')]
        self.events = [(*event[:4], refs[index], *event[5:]) for index, event in enumerate(self.events[:2])]
        for mode in (1, 2):
            with self.subTest(mode=mode):
                result = self.get_epg(mode, modern=True)
                self.assertEqual(list(result['events']), refs)
                self.assertEqual(result['channelrefs'], {ref: ref for ref in refs})

    def test_timer_does_not_mark_another_channel_with_the_same_name(self):
        timer = SimpleNamespace(service_ref=REFS[0], begin=self.start, end=self.start + 3600,
                                disabled=0, justplay=0)
        for mode in (1, 2):
            with self.subTest(mode=mode):
                result = self.get_epg(mode, modern=True, timers=[timer])
                self.assertEqual(result['events'][REFS[0]][0][0]['timer']['sref'], REFS[0])
                self.assertIsNone(result['events'][REFS[1]][0][0]['timer'])

    def test_classic_epg_keeps_name_based_grouping_by_default_and_explicitly(self):
        for mode in (1, 2):
            for modern in (None, False):
                with self.subTest(mode=mode, modern=modern):
                    result = self.get_epg(mode, modern=modern)
                    name = escape(CHANNEL_NAME)
                    self.assertEqual(list(result['events']), [name])
                    self.assertEqual(result['channelnames'], {name: name})
                    self.assertEqual(result['channelrefs'], {name: REFS[0]})
                    self.assertEqual(result['picons'], {name: '/picon/' + quote(REFS[0], safe='') + '.png'})
                    self.assertEqual([event['id'] for slot in result['events'][name] for event in slot], [10, 11, 12])

    def test_rendered_views_show_two_channels_with_their_own_metadata(self):
        for mode in (1, 2):
            with self.subTest(mode=mode):
                context = self.get_epg(mode, modern=True)
                context.update({
                    'mode': mode, 'day': 0, 'week': 0, 'epgmode': 'tv', 'bref': 'bouquet',
                    'time': time, 'bouquets': [], 'epg_jump_now': 0,
                    'epg_jump_active_service': 0, 'current_service_ref': REFS[1],
                })
                markup = str(self.template(searchList=[context]))
                parser = EpgChannelParser()
                parser.feed(markup)
                channel_class = 'serviceheader' if mode == 1 else 'epg__timeline-row'
                channels = [attrs for _, attrs in parser.elements
                            if channel_class in attrs.get('class', '').split()]
                self.assertEqual([attrs['data-sref'] for attrs in channels], list(REFS))
                self.assertEqual([unquote(attrs['data-ref']) for attrs in channels], list(REFS))
                picons = [attrs['src'] for tag, attrs in parser.elements
                          if tag == 'img' and attrs.get('src', '').startswith('/picon/')]
                self.assertEqual(picons, list(context['picons'].values()))
                self.assertEqual(parser.text.count(CHANNEL_NAME), 2)
                events = {int(attrs['data-id']): unquote(attrs['data-ref'])
                          for _, attrs in parser.elements if 'data-id' in attrs}
                self.assertEqual(events, {10: REFS[0], 11: REFS[1], 12: REFS[0]})

    def test_rendered_views_pass_safe_config_and_server_time_context_to_external_module(self):
        bouquet = 'bouquet & "quoted" <value> \'single\' + ä'
        for mode in (1, 2):
            with self.subTest(mode=mode):
                context = self.get_epg(mode, modern=True)
                context.update({
                    'mode': mode, 'day': 2, 'week': 1, 'epgmode': 'radio', 'bref': bouquet,
                    'time': time, 'bouquets': [], 'epg_jump_now': 1,
                    'epg_jump_active_service': 1, 'current_service_ref': REFS[1],
                })
                markup = str(self.template(searchList=[context]))
                parser = EpgChannelParser()
                parser.feed(markup)
                root = next(attrs for _, attrs in parser.elements if attrs.get('id') == 'modern-epg')
                config = json.loads(root['data-epg-config'])
                self.assertIn('modern-epg', root['class'].split())
                self.assertEqual('modern-epg--timeline' in root['class'].split(), mode == 2)
                self.assertEqual(config, {
                    'mode': mode, 'day': 2, 'week': 1, 'epgmode': 'radio',
                    'bref': quote(bouquet), 'slotStart': self.start, 'first': self.start,
                    'dateLabels': {'weekdays': [''] * 7, 'months': [''] * 12},
                    'jumpNow': 1, 'jumpActiveService': 1, 'currentServiceRef': REFS[1],
                    'hourlyLines': True, 'channelLines': True,
                    **({'timelineEnd': self.start + 10800} if mode == 2 else {}),
                })
                prime_times = [int(attrs['data-time']) for _, attrs in parser.elements
                               if attrs.get('data-day') in ('201', '202', '203')]
                expected = [int(time.mktime((2026, 10, 4, hour, 0, 0, -1, -1, -1)))
                            for hour in (6, 12, 20)]
                self.assertEqual(prime_times, expected)
                table = next(attrs for _, attrs in parser.elements if attrs.get('id') == 'fulltbl')
                self.assertIn('epg__tv-guide' if mode == 1 else 'epg__timeline', table['class'].split())
                if mode == 2:
                    self.assertEqual(int(table['data-first']), config['first'])
                self.assertIn("ModernEpg.init(JSON.parse(document.getElementById('modern-epg').getAttribute('data-epg-config')))", markup)
                self.assertNotIn('<style', markup)
                self.assertNotIn('function ', markup)


if __name__ == '__main__':
    unittest.main()
