"""Meaningful semantic regression checks for Loon-to-Egern native conversion."""
from pathlib import Path
import json
import subprocess
import tempfile
import unittest
from loon_lpx_converter import convert_lpx, keypath, regexp


class ConversionTests(unittest.TestCase):
    def convert(self, text, resources=None):
        self.arguments = []
        resources = resources or {}
        def argument_adapter(url, value):
            self.arguments.append(value)
            return url
        return convert_lpx(text, '测试应用', lambda url:url,
                           lambda data,status,headers:'https://example.com/binary.js',
                           lambda url:resources[url], argument_adapter)

    def run_jq(self, expression, value):
        root = Path(__file__).resolve().parents[3]
        executable = root/'tools/jq.exe'
        if not executable.is_file():
            # The public CI runner supplies jq on PATH.
            executable = 'jq'
        with tempfile.TemporaryDirectory(prefix='lpx-test-') as folder:
            path = Path(folder)/'filter.jq'
            path.write_text(expression, encoding='utf-8')
            result = subprocess.run([str(executable),'-f',str(path)],
                                    input=json.dumps(value).encode(), capture_output=True, check=True)
        return json.loads(result.stdout)

    def test_bracket_path_is_literal_not_jq_code(self):
        self.assertEqual(keypath('data["/service/settings/v3/"].body.data'),
                         ['data','/service/settings/v3/','body','data'])
        self.assertEqual(keypath('$.data["3D_AVATAR_UPDATE"]'), ['data','3D_AVATAR_UPDATE'])
        self.assertEqual(keypath('data.resp_map./teenager/api/info'), ['data','resp_map','/teenager/api/info'])
        with self.assertRaises((ValueError,AssertionError)):
            keypath('^https://api.example.com/config/')

    def test_all_actions_for_one_response_execute_in_source_order(self):
        text = r'''[Rewrite]
response if ${url} ~= /^https:\/\/api\.example\.com\/home$/i then response.json.delete("data.banner")
response if ${url} ~= /^https:\/\/api\.example\.com\/home$/i then response.json.jq(".data.items |= map(select(.ad != true))")
response if ${url} ~= /^https:\/\/api\.example\.com\/home$/i then response.json.replace("data.countdown", 0)
'''
        obj, notes = self.convert(text)
        self.assertEqual(notes[-1]['unsupported_lines'],0)
        self.assertEqual(len(obj['body_rewrites']),1)
        source={'code':0,'data':{'banner':{'ad':True},'items':[{'id':1,'ad':True},{'id':2,'title':'普通内容'}],'countdown':5,'order':'keep'}}
        result=self.run_jq(obj['body_rewrites'][0]['response_jq']['filter'],source)
        self.assertEqual(result,{'code':0,'data':{'items':[{'id':2,'title':'普通内容'}],'countdown':0,'order':'keep'}})

    def test_plugin_object_argument_keeps_boolean_and_string_types(self):
        obj,notes=self.convert(r'''[Argument]
enabled=switch, true, false
region=select, "US", "JP"
[Script]
response if ${url} ~= /example/ then script("https://example.com/original.js", {${enabled}, ${region}}) with requires_body=true, binary_body_mode=true
''')
        self.assertEqual(self.arguments,[{'enabled':True,'region':'US'}])
        self.assertTrue(obj['scriptings'][0]['http_response']['binary_body'])
        self.assertEqual(notes[-1]['unsupported_lines'],0)

    def test_url_guard_extra_condition_is_reported_not_discarded(self):
        obj,notes=self.convert('[Script]\nresponse if ${url} ~= /example/ && ${response.status} == 200 then script("https://example.com/original.js")')
        self.assertEqual(notes[-1]['unsupported_lines'],1)
        self.assertFalse(obj.get('scriptings'))

    def test_local_json_response_keeps_status_type_and_body(self):
        obj,notes=self.convert('[Rewrite]\nrequest if ${url} ~= /splash/ then reject_dict(200)')
        item=obj['map_locals'][0]
        self.assertEqual((item['status_code'],item['body']),(200,'{}'))
        self.assertEqual(item['headers']['Content-Type'],'application/json; charset=utf-8')

    def test_jq_file_is_inlined_without_losing_existing_rewrite(self):
        obj,notes=self.convert('''[Rewrite]
response if ${url} ~= /home/ then response.json.delete("data.banner")
response if ${url} ~= /home/ then response.json.jq_file("https://example.com/filter.jq")
''',{'https://example.com/filter.jq':b'.data.items |= map(select(.ad != true))'})
        result=self.run_jq(obj['body_rewrites'][0]['response_jq']['filter'],{'data':{'banner':1,'items':[{'ad':True},{'id':2}]}})
        self.assertEqual(result,{'data':{'items':[{'id':2}]}})

    def test_redirect_preserves_default_app_and_capture(self):
        obj,notes=self.convert(r'''[Argument]
app=select, "tg", "sg"
[Rewrite]
request if ${url} ~= /^https:\/\/t\.me\/(\w+)$/ as item then redirect(307, "${app}://resolve?domain=${item.1}")
''')
        self.assertEqual(obj['url_rewrites'][0]['location'],'tg://resolve?domain=$1')
        self.assertEqual(notes[-1]['unsupported_lines'],0)

    def test_regex_flags_and_escaped_slashes_survive(self):
        pattern,tail=regexp(r'/^https:\/\/example\.com\/[a/b]+/im then reject_dict(200)')
        self.assertTrue(pattern.startswith('(?im)'))
        self.assertEqual(tail,'then reject_dict(200)')

    def test_empty_jq_does_not_replace_the_comment_filter(self):
        obj,notes=self.convert(r'''[Rewrite]
response if ${url} ~= /comments/ then response.json.jq("")
response if ${url} ~= /comments/ then response.json.jq(".cards |= map(select(has(\"alias_name\")))")
''')
        self.assertEqual(notes[-1]['unsupported_lines'], 0)
        self.assertEqual(len(obj['body_rewrites']), 1)
        expr=obj['body_rewrites'][0]['response_jq']['filter']
        self.assertEqual(self.run_jq(expr, {'cards':[{'alias_name':'content'},{'ad':1}]}),
                         {'cards':[{'alias_name':'content'}]})

    def test_transparent_url_rewrite_keeps_capture_without_redirect(self):
        import re
        obj,notes=self.convert(r'''[Rewrite]
request if ${url} ~= /^https:\/\/\w+-spclient\.spotify\.com\/artist\/(.*)&platform=iphone/i as urlMatch then url.replace("https://spclient.wg.spotify.com/artist/${urlMatch.1}&platform=ipad")
''')
        fields=obj['url_rewrites'][0]
        self.assertNotIn('status_code',fields)
        match=re.compile(fields['match'])
        self.assertEqual(match.sub(fields['location'].replace('$1',r'\g<1>'),
                                   'https://a-spclient.spotify.com/artist/17?q=1&platform=iphone'),
                         'https://spclient.wg.spotify.com/artist/17?q=1&platform=ipad')
        self.assertFalse(match.search('https://a-spclient.spotify.com/album/17?q=1&platform=iphone'))
        self.assertEqual(notes[-1]['unsupported_lines'],0)

    def test_unknown_operation_is_not_misreported_as_success(self):
        obj,notes=self.convert('[Rewrite]\nrequest if ${url} ~= /example/ then imaginary.action("x")')
        self.assertEqual(notes[-1]['converted_lines'],0)
        self.assertEqual(notes[-1]['unsupported_lines'],1)


if __name__=='__main__':
    unittest.main()
