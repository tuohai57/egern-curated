"""Check actual remote module names and the selected release list, not labels alone."""
from pathlib import Path
import hashlib
import json
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
if (ROOT.parent/'.vendor').is_dir():
    sys.path.insert(0,str(ROOT.parent/'.vendor'))
import yaml

layout=json.loads((ROOT/'curated/delivery-layout.json').read_bytes())
refs=layout['modules']
assert len({row['url'] for row in refs})==len(refs)
forbidden=re.compile('旧整理|整理备用|未取得源码|完整原生|明文转换')
prefix='https://raw.githubusercontent.com/tuohai57/egern-curated/main/'
active=0
for ref in refs:
    assert ref['url'].startswith(prefix)
    assert '/native-full/modules/' not in ref['url']
    path=(ROOT/ref['url'][len(prefix):]).resolve()
    assert path.is_relative_to(ROOT)
    obj=yaml.safe_load(path.read_bytes())
    assert obj['name']==ref['name'],path.name
    assert not forbidden.search(ref['name']),ref['name']
    assert not forbidden.search(obj['name']),path.name
    active+=bool(ref.get('enabled',True))
print(json.dumps({'passed':True,'selected_modules':len(refs),'enabled':active,
                  'name_mismatches':0,'forbidden_names':0,
                  'scope':'Actual selected remote module metadata and delivery references.'}))
