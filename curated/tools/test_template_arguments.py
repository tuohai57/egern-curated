"""Whole-marker substitution plus actual delivered parameter contracts."""
from pathlib import Path
import json, re, sys
ROOT=Path(__file__).resolve().parents[2]
if (ROOT.parent/'.vendor').is_dir():sys.path.insert(0,str(ROOT.parent/'.vendor'))
import yaml
from template_arguments import substitute_markers

def main():
    checks=0
    for size in (12,60,121):
        markers={f'NATIVE_RESTORE_TEMPLATE_{i}':'{{{v'+str(i)+'}}}' for i in range(size)}
        values={'v'+str(i):'value_'+str(i) for i in range(size)}
        text='|'.join(markers)
        assert substitute_markers(text,markers,values)=='|'.join(values.values());checks+=1
    stack=ROOT/'curated/module-stack'
    manifest=json.loads((stack/'manifest.json').read_bytes())
    for key in ('native-015','native-070','native-071','native-075'):
        row=next(r for r in manifest['modules'] if Path(r['repository_path']).stem==key)
        current=yaml.safe_load((ROOT/row['repository_path']).read_bytes())
        source=(ROOT/row['original_url'].split('/main/',1)[1]).read_text(encoding='utf-8-sig')
        markers={}
        def hide(m):
            marker='NATIVE_RESTORE_TEMPLATE_'+str(len(markers));markers[marker]=m[0];return marker
        original=yaml.safe_load(re.sub(r'\{\{\{[^}]+\}\}\}',hide,source))
        defaults={**current.get('compat_arguments',{}),**original.get('compat_arguments',{})}
        expected=yaml.safe_load(substitute_markers(yaml.safe_dump(original,allow_unicode=True,sort_keys=False),markers,defaults))
        # Compare complete rendered parameter values to source defaults, not a
        # blacklist of known malformed strings. Script URL mirroring is separate.
        if key=='native-015':
            assert len(current['url_rewrites'])==len(expected['url_rewrites'])
            for actual,wanted in zip(current['url_rewrites'],expected['url_rewrites']):
                assert actual['location']==wanted['location'];checks+=1
        else:
            assert len(current['scriptings'])==len(expected['scriptings'])
            for actual,wanted in zip(current['scriptings'],expected['scriptings']):
                assert actual.keys()==wanted.keys()
                a,w=next(iter(actual.values())),next(iter(wanted.values()))
                for field in ('env','arguments','disabled','cron'):
                    if field in w:assert a[field]==w[field],(key,field);checks+=1
    music=yaml.safe_load((stack/'modules/native-013.yaml').read_bytes())
    bindings=[e['http_response'] for e in music['scriptings'] if 'netease-ui-native.js' in e.get('http_response',{}).get('script_url','')]
    assert len(bindings)==1; b=bindings[0]
    assert b['body_required'] and b['binary_body']; checks+=1
    for key,value in b['env'].items():assert music['compat_arguments'][key]==value;checks+=1
    for name in ('MY','DT','GZ','PRGG','HMPR'):assert b['env'][name]=='true';checks+=1
    assert b['env']['FX']=='false';checks+=1
    for url in ('https://interface.music.163.com/eapi/link/home/framework/tab','https://interface3.music.163.com/api/homepage/block/page?x=1'):
        assert re.search(b['match'],url);checks+=1
    for url in ('https://interface3.music.163.com/eapi/song/detail','https://interface3.music.163.com/eapi/link/home/framework/tabExtra'):
        assert not re.search(b['match'],url);checks+=1
    print(json.dumps({'passed':True,'checks':checks,'scope':'Source-default rendering and actual delivered bindings; no device verification'}))
if __name__=='__main__':main()
