from pathlib import Path
import copy
import json
import subprocess
import tempfile
import unittest
from adblock_collection import Collection,compose_jq_operations


class CollectionTests(unittest.TestCase):
    def test_standalone_jq_composition_preserves_phase_and_disabled_source(self):
        original=[{'response_jq':{'match':'home','filter':'del(.ad) # original comment'}},
                  {'request_jq':{'match':'home','filter':'.request=1'}},
                  {'response_jq':{'match':'home','filter':'del(.banner)'}},
                  {'response_jq':{'match':'home','filter':'.','disabled':True}}]
        before=copy.deepcopy(original)
        output,changes=compose_jq_operations(original)
        self.assertEqual(original,before)
        self.assertEqual(len(output),3)
        self.assertEqual(len(changes),1)
        self.assertIn('del(.ad) # original comment\n)',output[0]['response_jq']['filter'])
        self.assertIn('del(.banner)',output[0]['response_jq']['filter'])
        self.assertTrue(output[-1]['response_jq']['disabled'])

    def test_composition_updates_delivered_object_and_keeps_sources_untouched(self):
        original={'body_rewrites':[
            {'response_jq':{'match':'^https://example/home','filter':'del(.banner) # trailing source comment'}},
            {'response_jq':{'match':'^https://example/home','filter':'.items |= map(select(.ad != true))'}}]}
        before=copy.deepcopy(original)
        collection=Collection({'name':'测试合集'})
        collection.ingest('同一应用',original)
        self.assertEqual(original,before)
        result=collection.obj['body_rewrites']
        self.assertEqual(len(result),1)
        expression=result[0]['response_jq']['filter']
        root=Path(__file__).resolve().parents[3]
        executable=root/'tools/jq.exe'
        if not executable.is_file():executable='jq'
        with tempfile.TemporaryDirectory(prefix='collection-test-') as directory:
            path=Path(directory)/'filter.jq';path.write_text(expression,encoding='utf-8')
            output=subprocess.run([str(executable),'-f',str(path)],input=json.dumps({'banner':1,'items':[{'ad':True},{'id':2}],'normal':3}).encode(),capture_output=True,check=True)
        self.assertEqual(json.loads(output.stdout),{'items':[{'id':2}],'normal':3})

    def test_different_app_filters_are_not_blindly_chained(self):
        collection=Collection({'name':'测试合集'})
        collection.ingest('淘宝',{'body_rewrites':[{'response_jq':{'match':'shared','filter':'.taobao=1'}}]})
        collection.ingest('1688',{'body_rewrites':[{'response_jq':{'match':'shared','filter':'.alibaba=1'}}]})
        self.assertEqual(len(collection.obj['body_rewrites']),1)
        self.assertEqual(collection.obj['body_rewrites'][0]['response_jq']['filter'],'.taobao=1')
        self.assertEqual(collection.changes[0]['kind'],'same_selector_processing_first_owner')

    def test_exact_duplicate_rule_is_removed_with_auditable_conflicts(self):
        collection=Collection({'name':'测试合集'})
        collection.ingest('甲',{'rules':[{'domain':{'match':'ads.example','policy':'REJECT'}}]})
        collection.ingest('乙',{'rules':[{'domain':{'match':'ads.example','policy':'REJECT'}}]})
        collection.ingest('丙',{'rules':[{'domain':{'match':'ads.example','policy':'DIRECT'}}]})
        self.assertEqual(len(collection.obj['rules']),1)
        self.assertEqual(collection.changes[-1]['kind'],'exact_selector_policy_conflict_first_owner')

    def test_disabled_invalid_processing_is_excluded(self):
        collection=Collection({'name':'测试合集'})
        collection.ingest('甲',{'body_rewrites':[{'response_jq':{'match':'x','filter':'invalid','disabled':True}}]})
        self.assertFalse(collection.obj['body_rewrites'])


if __name__=='__main__':unittest.main()
