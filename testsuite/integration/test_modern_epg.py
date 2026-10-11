from calendar import timegm
from collections import defaultdict
from html import escape
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import time
from types import ModuleType
import unittest
from unittest.mock import patch

from Cheetah.Template import Template


ROOT = Path(__file__).resolve().parents[2]
VIEWS = ROOT / 'plugin/controllers/views/responsive/ajax'
MIDNIGHT = timegm((2026, 9, 28, 0, 0, 0))
NOW = MIDNIGHT + 20 * 3600 + 47 * 60
BOUQUET = '1:7:1:0:0:0:0:0:0:0:FROM BOUQUET "userbouquet.test.tv" ORDER BY bouquet'
OTHER_BOUQUET = BOUQUET.replace('test.tv', 'other.tv')
CONFIG_PROBE = '"><script>window.configInjected=true</script>&\'\\'


class RenderedModernEpgTests(unittest.TestCase):
    def test_browser_interactions_with_complete_rendered_templates(self):
        translations = ModuleType('Plugins.Extensions.OpenWebif.controllers.i18n')
        translations.tstrings = defaultdict(str, tv_guide='Zeitschrift', timeline='Zeitstrahl',
                                             date='Datum', now='Jetzt', edit_timer='Timer bearbeiten')
        for index, label in enumerate(('So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa')):
            translations.tstrings['day_%d' % index] = label
        for index, label in enumerate(('Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
                                      'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'), 1):
            translations.tstrings['month_%02d' % index] = label
        modules = {translations.__name__: translations}
        for name in ('epgdaterange', 'renderevtblock'):
            module_name = 'Plugins.Extensions.OpenWebif.controllers.views.responsive.ajax.' + name
            spec = importlib.util.spec_from_file_location(module_name, VIEWS / (name + '.py'))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            modules[module_name] = module

        fixtures = {}
        with patch.dict('sys.modules', modules), \
             patch.object(time, 'time', lambda: NOW), \
             patch.object(time, 'localtime', lambda value=None: time.gmtime(NOW if value is None else value)), \
             patch.object(time, 'mktime', timegm):
            template = Template.compile(source=(VIEWS / 'multiepg.tmpl').read_text(encoding='utf-8'))
            shell = str(Template(file=str(VIEWS / 'myepg.tmpl')))
            for mode in (1, 2):
                for day, week in ((0, 0), (1, 0), (0, 1), (2, 1), (0, 2)):
                    # The timeline always starts at midnight; the magazine keeps its current two-hour slot.
                    slot_start = MIDNIGHT + (day + week * 7) * 86400 if mode == 2 or day or week else MIDNIGHT + 20 * 3600
                    events = {}
                    for channel in ('1:0:1:AAA:', '1:0:1:BBB:'):
                        slots = [[] for _ in range(12 if mode == 1 else 1)]
                        for hour in range(24):
                            event = {
                                'id': hour + 1, 'ref': channel, 'begin_timestamp': slot_start + hour * 3600,
                                'duration': 3600, 'title': 'Sendung %d <Live> & "Musik"' % hour,
                                'shortdesc': escape('Beschreibung <b> & Details'), 'timerStatus': '', 'timer': None,
                            }
                            slots[hour // 2 if mode == 1 else 0].append(event)
                        events[channel] = slots
                    context = {
                        'mode': mode, 'day': day, 'week': week, 'epgmode': 'tv', 'bref': BOUQUET,
                        'slot_start': slot_start, 'time': time, 'bouquets': [(BOUQUET, 'Testbouquet'), (OTHER_BOUQUET, 'Anderes Bouquet')],
                        'events': events, 'channelnames': dict.fromkeys(events, 'Gleicher Sendername'),
                        'channelrefs': {ref: ref for ref in events}, 'picons': dict.fromkeys(events, '/picon.png'),
                        'epg_jump_now': 0, 'epg_jump_active_service': 0, 'current_service_ref': '',
                    }
                    if mode == 2:
                        context.update(timeline_start=slot_start, timeline_end=slot_start + 86400)
                    fixtures['%d:%d:%d' % (mode, day, week)] = str(template(searchList=[context]))
                    fixtures['%d:%d:%d:grid-off' % (mode, day, week)] = str(template(searchList=[
                        {**context, 'epg_hourly_lines': False, 'epg_channel_lines': False}]))
                    context['current_service_ref'] = CONFIG_PROBE
                    fixtures['%d:%d:%d:hostile' % (mode, day, week)] = str(template(searchList=[context]))
                    base = MIDNIGHT + (day + week * 7) * 86400
                    boundary_start = base + 18 * 3600 if mode == 1 else base
                    boundary_events = {}
                    for channel_index, channel in enumerate(events):
                        slots = [[] for _ in range(12 if mode == 1 else 1)]
                        minute = 57 if channel_index == 0 else 56
                        intervals = [(3000, base + 18 * 3600 + 30 * 60, (60 + minute - 30) * 60,
                                      'Sportschau', 'Logo Sportschau'),
                                     (3001, base + 19 * 3600 + minute * 60, (60 - minute) * 60,
                                      'Lotto am Samstag' if channel_index == 0 else 'SAT.1 :newstime',
                                      'Die Gewinnzahlen' if channel_index == 0 else 'SAT.1 :newstime Information, D 2026'),
                                     (3002, base + 20 * 3600, 15 * 60, 'Tagesschau', 'Tagesschau Logo'),
                                     (3003, base + 20 * 3600 + 15 * 60, 90 * 60, 'Verstehen Sie Spaß?', 'Unterhaltung')]
                        for event_id, begin, duration, title, description in intervals:
                            event = {'id': event_id, 'ref': channel, 'begin_timestamp': begin,
                                     'duration': duration, 'title': title, 'shortdesc': description,
                                     'timerStatus': '', 'timer': None}
                            if event_id == 3001:
                                event['timer'] = {'sref': channel, 'begin': begin, 'end': begin + duration,
                                                  'markerType': 'record', 'isEnabled': True, 'isAutoTimer': False}
                            slots[int((begin - boundary_start) // 7200) if mode == 1 else 0].append(event)
                        boundary_events[channel] = slots
                    boundary_context = {**context, 'slot_start': boundary_start, 'events': boundary_events,
                                        'current_service_ref': ''}
                    fixtures['%d:%d:%d:boundary' % (mode, day, week)] = str(template(searchList=[boundary_context]))
                    aligned_events = {}
                    for channel_index, channel in enumerate(events):
                        slots = [[] for _ in range(12 if mode == 1 else 1)]
                        for event_id, minute, duration in ((4000, 715, 5), (4001, 720, 3),
                                                           (4002, 723, 42), (4003, 765, 3)):
                            begin = base + minute * 60
                            event = {'id': event_id, 'ref': channel, 'begin_timestamp': begin,
                                     'duration': duration * 60,
                                     'title': 'Eine sehr kurze Sendung mit einem vollständig sichtbaren langen Titel' if channel_index else 'Tagesschau',
                                     'shortdesc': 'Verborgene Details <b>mit Information</b> &amp; mehr',
                                     'timerStatus': '', 'timer': None}
                            slots[minute // 120 if mode == 1 else 0].append(event)
                        aligned_events[channel] = slots
                    fixtures['%d:%d:%d:alignment' % (mode, day, week)] = str(template(searchList=[
                        {**context, 'slot_start': base, 'events': aligned_events, 'current_service_ref': ''}]))
                    fixtures['%d:%d:%d:alignment-grid-off' % (mode, day, week)] = str(template(searchList=[
                        {**context, 'slot_start': base, 'events': aligned_events, 'current_service_ref': '',
                         'epg_hourly_lines': False, 'epg_channel_lines': False}]))
                    geometry_events = {}
                    for channel_index, channel in enumerate(events):
                        slots = [[] for _ in range(12 if mode == 1 else 1)]
                        intervals = [
                            (1000, (slot_start if mode == 1 else base) - 900, 1500),
                            (1001, base + 20 * 3600 + 15 * 60, 90 * 60),
                            (1002, base + 21 * 3600 + 45 * 60, 15 * 60),
                            (1003, base + 22 * 3600, 5 * 3600),
                            (1004, slot_start + 86400 - 900, 3600),
                        ]
                        if mode == 2:
                            intervals.append((1005, base + 86400, (4 - channel_index) * 3600))
                        intervals.extend((1100 + index, base + (27 if mode == 1 else 8) * 3600 + 600 + index * 300, 180)
                                         for index in range(80))
                        for event_id, begin, duration in intervals:
                            if channel_index and event_id >= 1100:
                                if event_id % 2:
                                    continue
                                begin += 60
                            event = {'id': event_id, 'ref': channel, 'begin_timestamp': begin,
                                     'duration': duration, 'title': 'Sendung %d' % event_id,
                                     'shortdesc': 'Beschreibung ' * (150 if channel_index else 1),
                                     'timerStatus': '', 'timer': None}
                            if event_id == 1001:
                                event['timerStatus'] = 'waiting'
                                event['timer'] = {'sref': channel, 'begin': begin, 'end': begin + duration,
                                                  'markerType': 'record', 'isEnabled': True, 'isAutoTimer': False}
                            slot = max(0, int((begin - slot_start) // 7200)) if mode == 1 else 0
                            if slot < len(slots):
                                slots[slot].append(event)
                        geometry_events[channel] = slots
                    context.update(events=geometry_events, current_service_ref='')
                    if mode == 2:
                        context['timeline_end'] = base + 28 * 3600
                    fixtures['%d:%d:%d:geometry' % (mode, day, week)] = str(template(searchList=[context]))
                    if mode == 2:
                        short_event = {'id': 2001, 'ref': next(iter(events)), 'begin_timestamp': base,
                                       'duration': 3 * 3600, 'title': 'Kurzer Tag', 'shortdesc': '',
                                       'timerStatus': '', 'timer': None}
                        context.update(events={short_event['ref']: [[short_event]]}, timeline_end=base + 3 * 3600,
                                       epg_jump_now=1, epg_jump_active_service=1, current_service_ref=short_event['ref'])
                        fixtures['%d:%d:%d:short' % (mode, day, week)] = str(template(searchList=[context]))
                        context['epg_jump_now'] = 0
                        long_event = {'id': 2000, 'ref': next(iter(events)), 'begin_timestamp': base - 3 * 86400,
                                      'duration': 7 * 86400 + 1, 'title': 'Mehrtägige Sendung', 'shortdesc': '',
                                      'timerStatus': '', 'timer': None}
                        context.update(events={long_event['ref']: [[long_event]]}, timeline_end=base + 4 * 86400 + 1)
                        fixtures['%d:%d:%d:long' % (mode, day, week)] = str(template(searchList=[context]))
                        context.update(events={}, timeline_end=base)
                        fixtures['%d:%d:%d:empty' % (mode, day, week)] = str(template(searchList=[context]))
                        short_event = {**short_event, 'duration': 1800}
                        context.update(events={short_event['ref']: [[short_event]]}, timeline_end=base + 1800,
                                       bref=OTHER_BOUQUET)
                        other = str(template(searchList=[context]))
                        for variant in ('', ':short', ':long', ':empty', ':geometry'):
                            fixtures['%d:%d:%d%s:other' % (mode, day, week, variant)] = other

        main = (VIEWS.parent / 'main.tmpl').read_text(encoding='utf-8')
        settings_start = main.index('<li>', main.index("$tstrings['common_settings']"))
        settings_end = main.index('<!--', settings_start)
        with patch.dict('sys.modules', modules):
            grid_settings = str(Template(source=main[settings_start:settings_end], searchList=[{
                'isSettingEnabled': lambda key: 'checked',
                'tstrings': translations.tstrings,
            }]))
        assets = {}
        asset_tags = []
        for name in ('css/multiepg.min.css', 'js/responsive.min.js', 'js/epgtime.min.js', 'js/responsive-multiepg.min.js'):
            url = '/modern/' + name
            tag = re.search(r'<(?:link|script)\b[^>]*(?:href|src)="' + re.escape(url) +
                            r'(?:\?[^"\s]*)?"[^>]*>(?:</script>)?', main)
            self.assertIsNotNone(tag, 'Missing modern EPG asset in main.tmpl: ' + url)
            asset_tags.append(tag.group())
            assets[url] = (ROOT / 'plugin/public/modern' / name).read_text(encoding='utf-8')
        self.assertLess(main.index('/modern/js/epgtime.min.js'), main.index('/modern/js/responsive-multiepg.min.js'))

        data = {'now': NOW * 1000, 'midnight': MIDNIGHT, 'bouquet': BOUQUET, 'otherBouquet': OTHER_BOUQUET,
                'shell': shell, 'gridSettings': grid_settings, 'pages': fixtures, 'configProbe': CONFIG_PROBE,
                'assets': assets, 'assetTags': '\n'.join(asset_tags),
                'jquery': (ROOT / 'plugin/public/js/jquery-2.2.4.min.js').read_text(encoding='utf-8'),
                'css': (ROOT / 'plugin/public/modern/css/style.min.css').read_text(encoding='utf-8')}
        result = subprocess.run(['node', '--test-reporter=tap', str(Path(__file__).with_name('epg_browser_tests.js'))],
                                input=json.dumps(data), text=True, encoding='utf-8',
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout)
        print(result.stdout)


if __name__ == '__main__':
    unittest.main()
