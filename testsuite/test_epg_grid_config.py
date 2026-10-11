import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


ROOT = Path(__file__).resolve().parents[1]
KEYS = ('epg_hourly_lines', 'epg_channel_lines')


def controller_method(path, name):
    source = ast.parse(path.read_text(encoding='utf-8'))
    controller = next(node for node in source.body if isinstance(node, ast.ClassDef))
    method = next(node for node in controller.body if isinstance(node, ast.FunctionDef) and node.name == name)
    return compile(ast.Module(body=[method], type_ignores=[]), str(path), 'exec')


class EpgGridConfigTests(unittest.TestCase):
    def test_defaults_are_enabled(self):
        source = ast.parse((ROOT / 'plugin/plugin.py').read_text(encoding='utf-8'))
        items = [node for node in source.body if isinstance(node, ast.Assign)
                 and isinstance(node.targets[0], ast.Attribute) and node.targets[0].attr in KEYS]
        self.assertEqual(len(items), 2)
        config = SimpleNamespace(OpenWebif=SimpleNamespace(webcache=SimpleNamespace()))
        exec(compile(ast.Module(body=items, type_ignores=[]), 'grid-defaults', 'exec'),
             {'config': config, 'ConfigYesNo': lambda default: SimpleNamespace(value=default)})
        for key in KEYS:
            self.assertIs(getattr(config.OpenWebif.webcache, key).value, True)

    def test_settings_are_saved_independently(self):
        cache = SimpleNamespace(**{key: SimpleNamespace(value=True, save=Mock()) for key in KEYS})
        namespace = {'comp_config': SimpleNamespace(OpenWebif=SimpleNamespace(webcache=cache)),
                     'toString': lambda value: value.decode('utf-8')}
        exec(controller_method(ROOT / 'plugin/controllers/web.py', 'P_setwebconfig'), namespace)
        for key in KEYS:
            for value, expected in ((b'0', False), (b'1', True), (b'false', False), (b'true', True)):
                with self.subTest(key=key, value=value):
                    item = getattr(cache, key)
                    item.save.reset_mock()
                    other = getattr(cache, next(other for other in KEYS if other != key))
                    other.save.reset_mock()
                    result = namespace['P_setwebconfig'](None, SimpleNamespace(args={key.encode(): [value]}))
                    self.assertEqual(result, {'result': True})
                    self.assertIs(item.value, expected)
                    item.save.assert_called_once_with()
                    other.save.assert_not_called()
        self.assertEqual(namespace['P_setwebconfig'](None, SimpleNamespace(args={b'unknown': [b'1']})),
                         {'result': False})

    def test_options_are_passed_only_to_modern_epg(self):
        for modern in (True, False):
            for enabled in (True, False):
                with self.subTest(modern=modern, enabled=enabled):
                    cache = SimpleNamespace(mepgmode=SimpleNamespace(value=1), epg_jump_now=SimpleNamespace(value=False),
                                            epg_jump_active_service=SimpleNamespace(value=False),
                                            **{key: SimpleNamespace(value=enabled) for key in KEYS})
                    namespace = {
                        'config': SimpleNamespace(OpenWebif=SimpleNamespace(webcache=cache)),
                        'getUrlArg': lambda request, name, default=None: request.get(name, default),
                        'getBouquets': lambda mode: {'bouquets': [('bouquet', 'Test')]},
                        'getMultiEpg': lambda *args, **kwargs: {}, 'VIEWS_PATH': '/views',
                        'getViewsPath': lambda name: '/views/' + ('responsive/' if modern else '') + name,
                        'NavigationInstance': SimpleNamespace(instance=None),
                    }
                    exec(controller_method(ROOT / 'plugin/controllers/ajax.py', 'P_multiepg'), namespace)
                    result = namespace['P_multiepg'](None, {})
                    for key in KEYS:
                        if modern:
                            self.assertIs(result[key], enabled)
                        else:
                            self.assertNotIn(key, result)


if __name__ == '__main__':
    unittest.main()