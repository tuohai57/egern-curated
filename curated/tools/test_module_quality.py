"""Regression checks for shared module robustness, independent of App fixtures."""
from pathlib import Path
import copy, json, re, shutil, subprocess, unittest
from adblock_collection import guarded_jq, normalize_processing

ROOT = Path(__file__).resolve().parents[2]
JQ = shutil.which('jq') or str(ROOT.parent / 'tools/jq.exe')


def transform(expression, value):
    result = subprocess.run([JQ, '-c', expression], input=json.dumps(value),
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


class ModuleQualityTests(unittest.TestCase):
    def test_normal_cards_preserved_while_ads_removed(self):
        value = {'code': 0, 'items': [{'id': 1}, {'id': 2, 'is_ad': True}], 'cursor': 'next'}
        expression = guarded_jq('.items |= map(select(.is_ad != true))')
        self.assertEqual(transform(expression, value), {'code': 0, 'items': [{'id': 1}], 'cursor': 'next'})

    def test_normal_response_without_ads_unchanged(self):
        value = {'items': [{'id': 1}], 'notice': 'normal message'}
        self.assertEqual(transform(guarded_jq('.items |= map(select(.is_ad != true))'), value), value)

    def test_schema_errors_preserve_original(self):
        expression = guarded_jq('.items |= map(select(.is_ad != true))')
        for value in ({'code': 401, 'message': 'login required'}, {'items': 1}, None, 'unexpected'):
            self.assertEqual(transform(expression, value), value)

    def test_empty_and_multiple_results_preserve_input(self):
        value = {'code': 500, 'message': 'service unavailable'}
        for expression in ('empty', '.items[]?', '., .', 'error("changed schema")'):
            self.assertEqual(transform(guarded_jq(expression), value), value)

    def test_valid_null_and_boolean_results_retained(self):
        self.assertIsNone(transform(guarded_jq('null'), {'ad': True}))
        self.assertEqual(transform(guarded_jq('false'), {'ad': True}), False)

    def test_guard_idempotent_and_source_filter_kept(self):
        original = '# upstream comment\ndel(.advertisement)'
        guarded = guarded_jq(original)
        self.assertIn(original, guarded)
        self.assertEqual(guarded_jq(guarded), guarded)

    def test_same_adjacent_reply_one_handler_with_original_case(self):
        obj = {'map_locals': [
            {'match': '(?i)^https://api\\.example/test(?:\\?|$)', 'status_code': 200, 'body': '{}'},
            {'match': '^https://api\\.example/other(?:\\?|$)', 'status_code': 200, 'body': '{}'},
        ]}
        original = copy.deepcopy(obj)
        result, changes = normalize_processing(obj)
        self.assertEqual(len(result['map_locals']), 1)
        pattern = result['map_locals'][0]['match']
        for url in ('https://API.example/TEST?q=1', 'https://api.example/other'):
            self.assertTrue(re.search(pattern, url))
        for url in ('https://API.example/OTHER', 'https://api.example/testExtra'):
            self.assertFalse(re.search(pattern, url))
        self.assertEqual(obj, original)
        self.assertEqual(len(changes), 1)

    def test_different_reply_preserves_priority(self):
        obj = {'map_locals': [
            {'match': '^a', 'status_code': 200, 'body': 'one'},
            {'match': '^b', 'status_code': 200, 'body': 'two'},
            {'match': '^c', 'status_code': 200, 'body': 'one'},
        ]}
        result, _ = normalize_processing(obj)
        self.assertEqual(result, obj)

    def test_scripts_only_merge_with_identical_options(self):
        def script(pattern, body=False):
            return {'http_request': {'name': pattern, 'match': '^https://api\\.example/' + pattern,
                                    'script_url': 'https://example/script.js', 'body_required': body}}
        obj = {'scriptings': [script('^a'), script('^b'), script('^c', True)]}
        result, _ = normalize_processing(obj)
        self.assertEqual(len(result['scriptings']), 2)
        self.assertEqual(result['scriptings'][1], obj['scriptings'][2])

    def test_different_hosts_remain_separately_protectable(self):
        obj = {'map_locals': [
            {'match': '^https://ads\\.example/a', 'status_code': 200, 'body': '{}'},
            {'match': '^https://pay\\.example/a', 'status_code': 200, 'body': '{}'},
        ]}
        result, _ = normalize_processing(obj)
        self.assertEqual(result, obj)

    def test_disabled_and_backreferences_not_merged(self):
        for second in ({'match': '^b', 'disabled': True}, {'match': r'^(a)\1'}, {'match': r'^(?P<id>a)'}):
            candidate = {**second, 'match': '^https://api\\.example/' + second['match'][1:]}
            obj = {'map_locals': [{'match': '^https://api\\.example/a', 'status_code': 200, 'body': ''},
                                  {'status_code': 200, 'body': '', **candidate}]}
            result, _ = normalize_processing(obj)
            self.assertEqual(result, obj)


if __name__ == '__main__':
    unittest.main()
