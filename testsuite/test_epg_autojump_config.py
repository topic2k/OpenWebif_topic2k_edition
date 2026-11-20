#!/usr/bin/python
# -*- coding: utf-8 -*-
import os
import sys
import types
import unittest
from contextlib import ExitStack
from importlib.machinery import ModuleSpec
from unittest.mock import MagicMock, patch

# Setup mock modules for Enigma2 components
components = types.ModuleType('Components')
components.__path__ = []
components_language = types.ModuleType('Components.Language')
components_config = types.ModuleType('Components.config')
components_config.ConfigBoolean = type('ConfigBoolean', (object,), {})
components_systeminfo = types.ModuleType('Components.SystemInfo')
components_systeminfo.BoxInfo = types.ModuleType('BoxInfo')
components_systeminfo.BoxInfo.getItem = lambda *args: ""
components_systeminfo.SystemInfo = {}

tools = types.ModuleType('Tools')
tools.__path__ = []
tools_directories = types.ModuleType('Tools.Directories')
tools_directories.resolveFilename = lambda *args: ""
tools_directories.SCOPE_PLUGINS = 0
tools_directories.SCOPE_PLAYLIST = 0
tools_directories.SCOPE_CONFIG = 0
tools_directories.fileExists = lambda *args: True
tools_directories.isPluginInstalled = lambda *args: False
tools.Directories = tools_directories


class MockLoader(object):
	def create_module(self, spec):
		mod = MagicMock()
		mod.__name__ = spec.name
		mod.__path__ = []
		return mod

	def exec_module(self, module):
		pass


class MockFinder(object):
	@classmethod
	def find_spec(cls, fullname, path=None, target=None):
		if any(fullname.startswith(p) for p in ('Components.', 'Screens', 'Tools.', 'enigma', 'NavigationInstance', 'RecordTimer', 'ServiceReference', 'timer', 'Plugins')):
			return ModuleSpec(fullname, MockLoader(), is_package=True)
		return None


twisted = types.ModuleType('twisted')
twisted.__path__ = []
twisted.version = "20.0.0"
twisted_web = types.ModuleType('twisted.web')
twisted_web.__path__ = []


class FakeResource(object):
	def putChild(self, path, child):
		pass


twisted_web_resource = types.ModuleType('twisted.web.resource')
twisted_web_resource.Resource = FakeResource
twisted_web_resource.EncodingResourceWrapper = type('EncodingResourceWrapper', (object,), {})
twisted_web_server = types.ModuleType('twisted.web.server')
twisted_web_server.NOT_DONE_YET = 1
twisted_web_server.GzipEncoderFactory = type('GzipEncoderFactory', (object,), {})
twisted_web_http = types.ModuleType('twisted.web.http')
twisted_web_http.NOT_FOUND = 404
twisted_web_http.INTERNAL_SERVER_ERROR = 500
twisted_web_http.OK = 200
twisted_web_http.Request = type('Request', (object,), {})
twisted_web.resource = twisted_web_resource
twisted_web.server = twisted_web_server
twisted_web.http = twisted_web_http
twisted.web = twisted_web

twisted_internet = types.ModuleType('twisted.internet')
twisted_internet.defer = types.ModuleType('twisted.internet.defer')
twisted_internet.reactor = types.ModuleType('twisted.internet.reactor')
twisted.internet = twisted_internet

twisted_protocols = types.ModuleType('twisted.protocols')
twisted_protocols_basic = types.ModuleType('twisted.protocols.basic')
twisted_protocols_basic.FileSender = type('FileSender', (object,), {})
twisted_protocols.basic = twisted_protocols_basic
twisted.protocols = twisted_protocols

cheetah = types.ModuleType('Cheetah')
cheetah_template = types.ModuleType('Cheetah.Template')
cheetah_template.Template = type('Template', (object,), {})
cheetah.Template = cheetah_template


class LanguageMock(object):
	def getLanguage(self):
		return "de_DE"

	def addCallback(self, cb):
		pass


class ConfigMock(object):
	def __init__(self):
		self.misc = MagicMock()
		self.misc.rcused.value = 1
		self.OpenWebif = MagicMock()


components_language.language = LanguageMock()
components_config.config = ConfigMock()
components.Language = components_language
components.config = components_config
screens = types.ModuleType('Screens')
screens.__path__ = []
screens_infobar = types.ModuleType('Screens.InfoBar')
screens_infobar.InfoBar = types.ModuleType('InfoBar')
screens_infobar.InfoBar.instance = None
screens_infobar.MoviePlayer = type('MoviePlayer', (object,), {})
screens_channelselection = types.ModuleType('Screens.ChannelSelection')
screens_channelselection.service_types_tv = ""
screens_channelselection.service_types_radio = ""
screens_channelselection.FLAG_SERVICE_NEW_FOUND = 0
screens.InfoBar = screens_infobar
screens.ChannelSelection = screens_channelselection


class MockModule(types.ModuleType):
	def __getattr__(self, name):
		m = MagicMock()
		setattr(self, name, m)
		return m


enigma = MockModule('enigma')
enigma.eEnv = MockModule('eEnv')
enigma.eEnv.resolve = lambda *args: ""


class ConfigItemMock(object):
	def __init__(self, val=False):
		self.value = val

	def save(self):
		pass


class EpgAutoJumpTestCase(unittest.TestCase):
	def setUp(self):
		stack = ExitStack()
		self.addCleanup(stack.close)
		stack.enter_context(patch.dict(sys.modules, {
			'twisted': twisted,
			'twisted.internet': twisted_internet,
			'twisted.internet.defer': twisted_internet.defer,
			'twisted.internet.reactor': twisted_internet.reactor,
			'twisted.protocols': twisted_protocols,
			'twisted.protocols.basic': twisted_protocols_basic,
			'twisted.web': twisted_web,
			'twisted.web.resource': twisted_web_resource,
			'twisted.web.server': twisted_web_server,
			'twisted.web.http': twisted_web_http,
			'Cheetah': cheetah,
			'Cheetah.Template': cheetah_template,
			'Components': components,
			'Components.Language': components_language,
			'Components.config': components_config,
			'Components.SystemInfo': components_systeminfo,
			'Tools': tools,
			'Tools.Directories': tools_directories,
			'Screens': screens,
			'Screens.InfoBar': screens_infobar,
			'Screens.ChannelSelection': screens_channelselection,
			'enigma': enigma,
		}))
		stack.enter_context(patch.object(sys, 'meta_path', [MockFinder] + sys.meta_path))
		stack.enter_context(patch.object(sys, 'path', sys.path + [os.path.join(os.path.dirname(__file__), '../plugin')]))
		if not hasattr(os, 'statvfs'):
			stack.enter_context(patch.object(os, 'statvfs', lambda *args: None, create=True))
		_orig_listdir = os.listdir
		stack.enter_context(patch.object(os, 'listdir', lambda path: _orig_listdir(path) if os.path.exists(path) else []))

	def test_i18n_keys(self):
		from controllers.i18n import tstrings

		self.assertIn('epg_autojump', tstrings)
		self.assertIn('epg_jump_now', tstrings)
		self.assertIn('epg_jump_active_service', tstrings)
		self.assertIn('epg_jump_on_resume', tstrings)
		self.assertNotIn('epg_jump_keep_running_visible', tstrings)
		self.assertEqual(tstrings['epg_autojump'], "EPG Auto-Jump")
		self.assertEqual(tstrings['epg_jump_now'], "Jump to current time in EPG")
		self.assertEqual(tstrings['epg_jump_active_service'], "Jump to active channel in EPG")
		self.assertEqual(tstrings['epg_jump_on_resume'], "Jump to current time after five minutes in the background")

	def test_resume_option_defaults_to_enabled_and_is_rendered_under_auto_jump(self):
		from pathlib import Path
		import ast
		root = Path(__file__).resolve().parents[1]
		source = ast.parse((root / 'plugin/plugin.py').read_text(encoding='utf-8'))
		assignment = next(node for node in source.body if isinstance(node, ast.Assign)
						  and isinstance(node.targets[0], ast.Attribute)
						  and node.targets[0].attr == 'epg_jump_on_resume')
		self.assertIsInstance(assignment.value, ast.Call)
		self.assertEqual(assignment.value.func.id, 'ConfigYesNo')
		self.assertTrue(next(keyword.value.value for keyword in assignment.value.keywords if keyword.arg == 'default'))

		main = (root / 'plugin/controllers/views/responsive/main.tmpl').read_text(encoding='utf-8')
		self.assertIn("$tstrings['epg_jump_on_resume']", main)
		self.assertIn('id="epg_jump_on_resume"', main)

	def test_setwebconfig_epg_jump_keys(self):
		from controllers.web import WebController
		web = WebController(session=None)

		class FakeRequest(object):
			def __init__(self, key, val):
				self.args = {key.encode('utf-8'): [val.encode('utf-8')]}

		components_config.config.OpenWebif = ConfigMock()
		components_config.config.OpenWebif.webcache = ConfigMock()
		components_config.config.OpenWebif.webcache.epg_jump_now = ConfigItemMock(False)
		components_config.config.OpenWebif.webcache.epg_jump_active_service = ConfigItemMock(False)
		components_config.config.OpenWebif.webcache.epg_jump_on_resume = ConfigItemMock(False)

		res1 = web.P_setwebconfig(FakeRequest("epg_jump_now", "true"))
		self.assertEqual(res1, {"result": True})
		self.assertTrue(components_config.config.OpenWebif.webcache.epg_jump_now.value)

		res2 = web.P_setwebconfig(FakeRequest("epg_jump_active_service", "1"))
		self.assertEqual(res2, {"result": True})
		self.assertTrue(components_config.config.OpenWebif.webcache.epg_jump_active_service.value)

		res3 = web.P_setwebconfig(FakeRequest("epg_jump_now", "false"))
		self.assertEqual(res3, {"result": True})
		self.assertFalse(components_config.config.OpenWebif.webcache.epg_jump_now.value)

		res4 = web.P_setwebconfig(FakeRequest("epg_jump_on_resume", "0"))
		self.assertEqual(res4, {"result": True})
		self.assertFalse(components_config.config.OpenWebif.webcache.epg_jump_on_resume.value)
		res5 = web.P_setwebconfig(FakeRequest("epg_jump_on_resume", "true"))
		self.assertEqual(res5, {"result": True})
		self.assertTrue(components_config.config.OpenWebif.webcache.epg_jump_on_resume.value)


class EpgAutoJumpIsolationTests(unittest.TestCase):
	def test_mocks_are_removed_after_running_config_tests(self):
		modules = sys.modules.copy()
		meta_path = sys.meta_path[:]
		path = sys.path[:]
		listdir = os.listdir
		statvfs = getattr(os, 'statvfs', None)
		result = unittest.TestResult()
		unittest.defaultTestLoader.loadTestsFromTestCase(EpgAutoJumpTestCase).run(result)
		self.assertTrue(result.wasSuccessful(), (result.errors, result.failures))
		self.assertEqual(result.testsRun, 3)
		self.assertEqual(sys.modules, modules)
		self.assertEqual(sys.meta_path, meta_path)
		self.assertEqual(sys.path, path)
		self.assertIs(os.listdir, listdir)
		self.assertIs(getattr(os, 'statvfs', None), statvfs)


if __name__ == '__main__':
	unittest.main()
