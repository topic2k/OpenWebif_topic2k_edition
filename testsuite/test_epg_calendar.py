import ast
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from time import localtime, mktime
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
SERVICES = ROOT / 'plugin/controllers/models/services.py'
WEB = ROOT / 'plugin/controllers/web.py'
AJAX = ROOT / 'plugin/controllers/ajax.py'


class EpgCalendarTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = ast.parse(SERVICES.read_text(encoding='utf-8'))
        function = next(node for node in source.body
                        if isinstance(node, ast.FunctionDef) and node.name == 'getEpgCalendarDays')
        cls.code = compile(ast.Module(body=[function], type_ignores=[]), str(SERVICES), 'exec')

    def available(self, events, services=('channel',)):
        calls = []

        def lookup(srefs, start, duration, fields):
            calls.append((srefs, start, duration, fields))
            return events

        namespace = {
            'date': date, 'datetime': datetime, 'timedelta': timedelta,
            'localtime': localtime, 'mktime': mktime,
            'monotonic': lambda: 0, '_epgCalendarDaysCache': {},
            'eServiceCenter': SimpleNamespace(getInstance=lambda: SimpleNamespace(
                list=lambda _: SimpleNamespace(getContent=lambda _: services) if services else None)),
            'eServiceReference': lambda value: value,
            'EPG': lambda: SimpleNamespace(getMultiChannelEvents=lookup),
        }
        exec(self.code, namespace)
        return namespace['getEpgCalendarDays']('bouquet', 2026, 10), calls

    def test_marks_only_days_with_events_in_selected_month(self):
        timestamp = lambda y, m, d, h: int(mktime((y, m, d, h, 0, 0, -1, -1, -1)))
        days, calls = self.available([
            (timestamp(2026, 9, 30, 23), 7200),
            (timestamp(2026, 10, 7, 12), 1800),
            (timestamp(2026, 10, 7, 13), 1800),
            (timestamp(2026, 10, 31, 23), 7200),
            (timestamp(2026, 11, 1, 12), 1800),
            (None, None),
        ])
        self.assertEqual(days, ['2026-10-01', '2026-10-07', '2026-10-31'])
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], ('channel',))
        self.assertEqual(calls[0][3], 'BD')
        self.assertLessEqual(calls[0][1], timestamp(2026, 9, 30, 23))

    def test_empty_bouquet_or_cache(self):
        self.assertEqual(self.available([])[0], [])
        days, calls = self.available([], services=())
        self.assertEqual(days, [])
        self.assertEqual(calls, [])

    def test_repeated_month_queries_use_short_lived_bouquet_cache(self):
        calls = []
        clock = [0]
        start = int(mktime((2026, 10, 7, 12, 0, 0, -1, -1, -1)))
        namespace = {
            'date': date, 'datetime': datetime, 'timedelta': timedelta,
            'localtime': localtime, 'mktime': mktime,
            'monotonic': lambda: clock[0], '_epgCalendarDaysCache': {},
            'eServiceCenter': SimpleNamespace(getInstance=lambda: SimpleNamespace(
                list=lambda _: SimpleNamespace(getContent=lambda _: ['channel']))),
            'eServiceReference': lambda value: value,
            'EPG': lambda: SimpleNamespace(getMultiChannelEvents=lambda *args, **kwargs: calls.append(args) or [(start, 1800)]),
        }
        exec(self.code, namespace)
        available = namespace['getEpgCalendarDays']
        self.assertEqual(available('bouquet', 2026, 10), ['2026-10-07'])
        self.assertEqual(available('bouquet', 2026, 10), ['2026-10-07'])
        self.assertEqual(len(calls), 1)
        available('another bouquet', 2026, 10)
        self.assertEqual(len(calls), 2)
        clock[0] = 61
        available('bouquet', 2026, 10)
        self.assertEqual(len(calls), 3)

    def test_endpoint_validates_month_and_bouquet(self):
        source = ast.parse(WEB.read_text(encoding='utf-8'))
        controller = next(node for node in source.body if isinstance(node, ast.ClassDef)
                          and node.name == 'WebController')
        handler = next(node for node in controller.body if isinstance(node, ast.FunctionDef)
                       and node.name == 'P_epgcalendar')
        calls = []
        namespace = {
            'getUrlArg': lambda request, name: request.get(name),
            'getEpgCalendarDays': lambda *args: calls.append(args) or ['2026-10-07'],
        }
        exec(compile(ast.Module(body=[handler], type_ignores=[]), str(WEB), 'exec'), namespace)
        call = lambda params: namespace['P_epgcalendar'](None, params)
        self.assertEqual(call({'bref': 'bouquet', 'year': '2026', 'month': '10'}),
                         {'result': True, 'days': ['2026-10-07']})
        self.assertEqual(calls, [('bouquet', 2026, 10)])
        for params in ({'year': '2026', 'month': '10'},
                       {'bref': 'bouquet', 'year': '2026', 'month': '13'},
                       {'bref': 'bouquet', 'year': 'broken', 'month': '10'}):
            self.assertEqual(call(params), {'result': False, 'days': []})
        self.assertEqual(len(calls), 1)

    def test_past_days_work_only_in_modern_epg(self):
        source = ast.parse(AJAX.read_text(encoding='utf-8'))
        controller = next(node for node in source.body if isinstance(node, ast.ClassDef)
                          and node.name == 'AjaxController')
        handler = next(node for node in controller.body if isinstance(node, ast.FunctionDef)
                       and node.name == 'P_multiepg')
        for modern in (True, False):
            with self.subTest(modern=modern):
                namespace = {
                    'getUrlArg': lambda request, name, default=None: request.get(name, default),
                    'getBouquets': lambda mode: {'bouquets': [('bouquet', 'Favorite')]},
                    'getViewsPath': lambda name: '/views/responsive/ajax/multiepg.tmpl' if modern else '/views/ajax/multiepg.tmpl',
                    'VIEWS_PATH': '/views',
                    'getMultiEpg': lambda _self, _bref, start, *_args, **_kwargs: {'start': start},
                    'config': SimpleNamespace(OpenWebif=SimpleNamespace(webcache=SimpleNamespace(
                        mepgmode=SimpleNamespace(value=0), epg_jump_now=SimpleNamespace(value=0),
                        epg_jump_active_service=SimpleNamespace(value=0), epg_hourly_lines=SimpleNamespace(value=True),
                        epg_channel_lines=SimpleNamespace(value=True)))),
                    'NavigationInstance': SimpleNamespace(instance=None),
                    'localtime': lambda: localtime(mktime((2026, 10, 1, 12, 0, 0, -1, -1, -1))),
                    'mktime': mktime,
                }
                exec(compile(ast.Module(body=[handler], type_ignores=[]), str(AJAX), 'exec'), namespace)
                result = namespace['P_multiepg'](SimpleNamespace(), {'day': '-1', 'week': '0'})
                expected = int(mktime((2026, 9, 30, 0, 0, 0, -1, -1, -1))) if modern else -1
                self.assertEqual(result['start'], expected)


if __name__ == '__main__':
    unittest.main()