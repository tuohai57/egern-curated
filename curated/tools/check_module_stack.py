"""Static integrity check for the merged module and disabled alternatives."""
from pathlib import Path
import hashlib,json,sys
ROOT=Path(__file__).resolve().parents[2];STACK=ROOT/'curated/module-stack';
sys.path.insert(0,str(ROOT.parent/'.vendor'))
import yaml
manifest=json.loads((STACK/'manifest.json').read_text(encoding='utf-8'))
assert manifest['module_count']==len(manifest['modules'])
urls=set();failed=[]
for row in manifest['modules']:
 p=ROOT/row['repository_path'];assert p.is_file(),row['repository_path']
 assert hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256'],row['repository_path']
 assert row['url'] not in urls,row['url'];urls.add(row['url'])
 obj=yaml.safe_load(p.read_text(encoding='utf-8'))
 assert isinstance(obj,dict) and isinstance(obj.get('name'),str),row['name']
 for section in ('rules','url_rewrites','header_rewrites','body_rewrites','map_locals','scriptings'):
  assert isinstance(obj.get(section,[]),list),(row['name'],section)
 if row['name']=='去广告合并合集（Egern）':
  assert row['enabled'] is True
  assert row['counts']['scriptings']==len(obj.get('scriptings',[]))
print(json.dumps({'passed':True,'modules':len(manifest['modules']),'enabled_default':sum(1 for r in manifest['modules'] if r.get('enabled')),'unique_urls':len(urls)},ensure_ascii=False))
