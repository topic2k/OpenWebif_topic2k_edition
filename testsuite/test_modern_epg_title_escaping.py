from collections import defaultdict
from copy import deepcopy
from html import escape
from html.parser import HTMLParser
import importlib.util
from pathlib import Path
import time
from types import ModuleType
import unittest
from unittest.mock import patch

from Cheetah.Template import Template


VIEWS = Path(__file__).resolve().parents[1] / 'plugin/controllers/views/responsive/ajax'


class EpgTitleParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.elements = []
        self.titles = []
        self.title_depth = 0
        self.tooltips = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'a' and 'ui-widget-content' in attrs.get('class', '').split():
            assert 'title' not in attrs, 'No native tooltip may bypass the 1.5-second delay'
        if tag == 'span' and 'ename' in attrs.get('class', '').split():
            self.tooltips.append(attrs.pop('data-epg-title'))
        self.elements.append((tag, attrs))
        if tag == 'span':
            if self.title_depth:
                self.title_depth += 1
            elif {'epg__title', 'ename'} & set(attrs.get('class', '').split()):
                self.titles.append('')
                self.title_depth = 1

    def handle_endtag(self, tag):
        if tag == 'span' and self.title_depth:
            self.title_depth -= 1

    def handle_data(self, data):
        if self.title_depth == 1:
            self.titles[-1] += data


class ModernEpgTitleEscapingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
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

    def event(self, title):
        return {
            'id': 1, 'ref': '1:0:1:', 'begin_timestamp': 1791072000, 'duration': 3600,
            'title': title, 'shortdesc': escape('Beschreibung <b> & "Details"'),
            'timerStatus': 'on',
            'timer': {'markerType': 'record', 'isEnabled': True, 'isAutoTimer': True,
                      'sref': '1:0:1:', 'begin': 1791072000, 'end': 1791075600},
        }

    def render(self, mode, event):
        slots = [[event]] + ([[] for _ in range(11)] if mode == 1 else [])
        context = {
            'mode': mode, 'day': 0, 'week': 0, 'epgmode': 'tv', 'bref': 'bouquet',
            'slot_start': event['begin_timestamp'], 'time': time, 'bouquets': [],
            'events': {'Channel': slots}, 'channelnames': {'Channel': 'Channel'},
            'channelrefs': {'Channel': event['ref']}, 'picons': {'Channel': '/picon'},
            'epg_jump_now': 0, 'epg_jump_active_service': 0, 'current_service_ref': '',
        }
        if mode == 2:
            context.update(timeline_start=event['begin_timestamp'],
                           timeline_end=event['begin_timestamp'] + event['duration'])
        markup = str(self.template(searchList=[context]))
        parser = EpgTitleParser()
        parser.feed(markup)
        return markup, parser

    def test_titles_remain_literal_text_in_both_views(self):
        titles = (
            'Normale Sendung',
            'Märchen & Musik: "Grüße" <Live> \'heute\'',
            '<img src=x onerror=alert(1)>',
            '</span><script>alert(1)</script><span>',
            '" autofocus onfocus="alert(1)',
            '&lt;script&gt; &amp; &#34;',
            '',
        )
        for mode in (1, 2):
            _, baseline = self.render(mode, self.event('Normale Sendung'))
            for title in titles:
                with self.subTest(mode=mode, title=title):
                    event = self.event(title)
                    original = deepcopy(event)
                    _, parser = self.render(mode, event)
                    self.assertEqual([text.strip() for text in parser.titles], [title])
                    self.assertEqual(parser.elements, baseline.elements)
                    self.assertEqual(parser.tooltips, [title] if mode == 2 else [])
                    self.assertEqual(event, original)

    def test_timeline_tooltip_cannot_inject_attributes(self):
        title = '" onmouseover="alert(1)" data-injected="yes'
        _, baseline = self.render(2, self.event('Normal'))
        _, parser = self.render(2, self.event(title))
        self.assertEqual(parser.tooltips, [title])
        self.assertEqual(parser.elements, baseline.elements)

    def test_generated_markup_is_not_escaped_again(self):
        for mode in (1, 2):
            with self.subTest(mode=mode):
                markup, parser = self.render(mode, self.event('Titel <b> & "Text"'))
                events = [attrs for _, attrs in parser.elements if attrs.get('data-id') == '1']
                self.assertEqual(len(events), 1)
                self.assertEqual(events[0]['data-target'], '#EventModal')
                markers = [attrs for tag, attrs in parser.elements
                           if tag == 'button' and attrs.get('class') == 'epg__timer-marker']
                self.assertEqual(len(markers), 1)
                self.assertEqual(markers[0]['data-target'], '#TimerModal')
                if mode == 1:
                    self.assertIn('<i class="material-icons material-icons-centered">alarm_on</i>', markup)
                    self.assertIn('<i class="material-icons material-icons-centered">av_timer</i>', markup)
                    self.assertIn('Beschreibung &lt;b&gt; &amp; &quot;Details&quot;</summary>', markup)
                    self.assertNotIn('&amp;lt;b&amp;gt;', markup)


if __name__ == '__main__':
    unittest.main()