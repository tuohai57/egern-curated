"""Offline integrity, name isolation and routing-boundary checks for Hub additions."""
from pathlib import Path
from collections import Counter
import hashlib,json,shutil,subprocess,sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT.parent/'.vendor'))
import yaml
from adblock_model import load_defaults

manifest=json.loads((ROOT/'curated/hub-resources/manifest.json').read_text(encoding='utf-8'))
catalog=json.loads((ROOT/'curated/hub-resources/catalog-review.json').read_text(encoding='utf-8'))
assert len(catalog['entries'])==catalog['resources']==1374
assert len({r['id'] for r in catalog['entries']})==catalog['resources']
assert sum(r['kind']=='modules' for r in catalog['entries'])==catalog['modules']==1316
assert sum(catalog['module_decisions'].values())==catalog['modules']
assert sum(catalog['module_sources'].values())==catalog['modules']
assert catalog['dependency_scripts']==catalog['dependency_syntax_passes']==571
assert not catalog['device_runtime_verified']
scripts={};widgets={};totals=Counter()
assets=manifest['modules']+manifest['dependencies']
for row in assets:
    raw=(ROOT/row['repository_path']).read_bytes()
    assert hashlib.sha256(raw).hexdigest()==row['sha256'],row['repository_path']
for row in manifest['modules']:
    if row.get('original_repository_path'):
        raw=(ROOT/row['original_repository_path']).read_bytes()
        assert hashlib.sha256(raw).hexdigest()==row['source_sha256']
    obj=load_defaults((ROOT/row['repository_path']).read_text(encoding='utf-8'))
    totals[row['resource_kind']]+=1
    local=set()
    for entry in obj.get('scriptings',[]):
        fields=next(iter(entry.values()));name=fields['name']
        assert name not in scripts,('Script name collision',name)
        scripts[name]=row['id'];local.add(name)
        url=fields.get('script_url')
        if url:
            asset=next(a for a in manifest['dependencies'] if a['url']==url)
            assert (ROOT/asset['repository_path']).is_file()
    for widget in obj.get('widgets',[]):
        assert widget['name'] not in widgets,('Widget name collision',widget['name'])
        widgets[widget['name']]=row['id']
        assert widget['script_name'] in local,('Missing generic script',widget)
        assert any('generic'in entry and entry['generic']['name']==widget['script_name'] for entry in obj['scriptings'])
    if row['resource_kind']=='widgets':
        assert not obj.get('rules'),'A display widget must not steal global App routing'
        assert not obj.get('dns'),'A display widget must not override DNS'
        if row['default_enabled']:
            assert all('generic'in entry for entry in obj['scriptings']), 'Default widget has background/interception side effects'
            assert not obj.get('mitm'),'Default display widget adds MITM'
    if row['resource_kind']=='app_module':assert not row['default_enabled'],'App alternate must not overlap active owner'
assert totals['widgets']==53 and totals['app_module']==2
assert len(widgets)==55
node=shutil.which('node')
if node is None:
    bundled=Path('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe')
    node=str(bundled) if bundled.is_file() else None
assert node,'Node is needed for source syntax checks'
checked=set()
for row in manifest['dependencies']:
    path=ROOT/row['repository_path']
    if path in checked:continue
    checked.add(path)
    result=subprocess.run([node,'--check',str(path)],capture_output=True)
    assert result.returncode==0,result.stderr.decode(errors='replace')[:300]
print(json.dumps({'passed':True,'resources':sum(totals.values()),'widget_resources':totals['widgets'],
                  'widget_entries':len(widgets),'unique_script_bindings':len(scripts),
                  'script_files_syntax_checked':len(checked),'device_runtime_verified':False}))
