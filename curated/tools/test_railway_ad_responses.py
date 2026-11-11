"""Exercise the delivered 12306 jq against its upstream-documented success code.

Inputs are synthetic, not a captured App response or proof of device execution.
The code='00' contract is in the archived 墨鱼 12306 script. Request-operation
tests live in test_app_native_rewrites.cjs and keep booking/account operations.
"""
from pathlib import Path
import json
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
if (ROOT.parent/'.vendor').is_dir():sys.path.insert(0,str(ROOT.parent/'.vendor'))
import yaml

jq=shutil.which('jq') or str(ROOT.parent/'tools/jq.exe')
module=yaml.safe_load((ROOT/'curated/module-stack/modules/native-056.yaml').read_bytes())
matches=[r['response_jq'] for r in module['body_rewrites'] if 'getAdList' in r['response_jq']['match']]
assert len(matches)==1
expression=matches[0]['filter']
aggregate=yaml.safe_load((ROOT/'curated/module-stack/modules/000-adblock-merged-complete.yaml').read_bytes())
aggregate_filters=[r['response_jq']['filter'] for r in aggregate['body_rewrites']
                   if 'getAdList' in r.get('response_jq',{}).get('match','')]
assert aggregate_filters==[expression], 'The disabled aggregate must retain the same reviewed repair'
cases=0

def transform(value):
    global cases
    cases+=1
    result=subprocess.run([jq,'-c',expression],input=json.dumps(value).encode(),capture_output=True,check=True,timeout=10)
    return json.loads(result.stdout)

business={'request_id':'synthetic','ticket':{'train_no':'example'},'message':'正常返回'}
for code in [0,'0','00',200,'200']:
    value={**business,'code':code,'materialsList':[{'filePath':'advert'}],'advertParam':{'skipTime':5}}
    assert transform(value)=={**business,'code':code},code
    for empty in [[],None]:
        assert transform({**value,'materialsList':empty})=={**business,'code':code}
    clean={**business,'code':code}
    assert transform(clean)==clean
for value in [
    {**business,'code':'401','materialsList':[1],'advertParam':{'skipTime':5}},
    {**business,'code':'00','status_code':500,'materialsList':[1]},
    {**business,'code':'E001','message':'请先登录','materialsList':[1]},
    {**business,'code':'00','data':{'business':'keep'}},
    None,[],{'unknown':True},
]:
    assert transform(value)==value
print(json.dumps({'passed':True,'cases':cases,'scope':'Delivered jq, code 00 and normal/error preservation; synthetic inputs only.'}))
