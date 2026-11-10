import unittest
from module_converter import convert


class EchoCompatibilityTests(unittest.TestCase):
    def test_analyze_echo_runs_before_upstream_and_receives_request_body(self):
        calls=[]
        def adapter(original,mirror,options):
            calls.append(options.copy())
            return mirror
        obj,notes=convert('^https://example.com/settings/save url script-analyze-echo-response https://example.com/source.js',
                          '微博',lambda url:url,lambda *args:None,adapter)
        self.assertFalse(notes)
        item=obj['scriptings'][0]
        self.assertIn('http_request',item)
        self.assertTrue(item['http_request']['body_required'])
        self.assertTrue(calls[0]['echo'])

    def test_echo_settings_page_does_not_require_request_body(self):
        obj,notes=convert('^https://example.com/settings url script-echo-response https://example.com/source.js',
                          '微博',lambda url:url,lambda *args:None,lambda original,mirror,options:mirror)
        self.assertFalse(obj['scriptings'][0]['http_request']['body_required'])


if __name__=='__main__':unittest.main()
