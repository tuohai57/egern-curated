"""Validate public managed assets before a repository push or CI run."""
from pathlib import Path
from collections import defaultdict
import hashlib,json,re,sys
LOCAL_VENDOR=Path(__file__).resolve().parents[3]/'.vendor'
if LOCAL_VENDOR.exists():sys.path.insert(0,str(LOCAL_VENDOR))
import yaml
ROOT=Path(__file__).resolve().parents[2]
M=json.loads((ROOT/'curated/managed-manifest.json').read_text(encoding='utf-8'))
R=json.loads((ROOT/'curated/managed-rules.json').read_text(encoding='utf-8'))
P=json.loads((ROOT/'curated/managed-protection.json').read_text(encoding='utf-8'))
def within(a,b):return a==b or a.endswith('.'+b)
def overlap(a,b):return within(a,b) or within(b,a)
errors=[]
def check(ok,message):
    if not ok:errors.append(message)
seen={};suffix={};ipnets=[]
deps={d['url']:d for d in M['dependencies']}
for item in M['modules']+M['dependencies']+R['sets']:
    path=(ROOT/item['repository_path']).resolve()
    check(path.is_relative_to(ROOT),'Asset path escapes repository')
    check(hashlib.sha256(path.read_bytes()).hexdigest()==item['sha256'],'Asset hash mismatch '+item['repository_path'])
for mod in M['modules']:
    check(not re.search(r'kelee\.one|luestr/ProxyResource',mod.get('upstream_url') or '',re.I),'Excluded Kelee module source '+mod['app'])
    check('Rule' not in mod['sections'],'Content module contains domain-wide rules '+mod['app'])
    names=[]
    for line in mod['sections'].get('Script',[]):
        name=line.split('=',1)[0].strip();names.append(name)
        url=re.search(r'script-path=([^,\s]+)',line)
        check(url and url[1] in deps,'Unregistered script dependency')
        check('{{{' not in line,'Unresolved Surge argument')
    check(len(names)==len(set(names)),'Duplicate script name '+mod['app'])
    for h in mod['hosts']:
        for root in P['finance_roots']:
            check(not within(h.removeprefix('*.'),root) and not (h.startswith('*.') and within(root,h[2:])), 'Financial MITM '+h)
for dep in M['dependencies']:
    check(not re.search(r'kelee\.one|luestr/ProxyResource|\.lpx(?:$|\?)',dep.get('upstream_url') or '',re.I),'Excluded encrypted/platform source')
    if dep.get('source_kind')=='independent-reimplementation':
        check(hashlib.sha256((ROOT/dep['source_repository_path']).read_bytes()).hexdigest()==dep['upstream_sha256'],'Independent source hash mismatch')
for spec in R['sets']:
    obj=yaml.safe_load((ROOT/spec['repository_path']).read_text(encoding='utf-8'))
    check(set(obj)<={'domain_set','domain_suffix_set','domain_keyword_set','ip_cidr_set','no_resolve'},'Unsupported ruleset keys')
    for key,values in obj.items():
        if key=='no_resolve':continue
        for value in values:
            check((key,value) not in seen,'Duplicate remote matcher '+key+':'+value)
            seen[key,value]=spec['name']
            if key=='domain_suffix_set':suffix[value]=spec['name']
            if spec['name']=='去广告':
                check(not any(overlap(value,f) for f in P['protected_roots']),'Protected ad match '+value)
                for mod in M['modules']:
                    check(not any(overlap(value,h.removeprefix('*.')) for h in mod['hosts']),'Ad blocks content module '+value)
check(not errors,'')
result={'passed':not errors,'errors':[e for e in errors if e],
 'modules':len(M['modules']),'dependencies':len(M['dependencies']),'rulesets':len(R['sets']),
 'rule_members':len(seen),'scope':'Public asset integrity, matcher duplicates, financial MITM and rewrite reachability; no device guarantee.'}
print(json.dumps(result,ensure_ascii=False,indent=2))
sys.exit(bool(errors))
