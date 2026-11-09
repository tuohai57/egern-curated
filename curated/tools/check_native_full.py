"""Integrity and execution prerequisites for restored native Egern modules.

These checks do not certify iOS certificate trust, network reachability from a
phone, Egern's compatibility runtime, or current App endpoint behavior.
"""
from pathlib import Path
from collections import Counter
import hashlib,json,re,shutil,subprocess,sys
ROOT=Path(__file__).resolve().parents[2]
LOCAL_VENDOR=ROOT.parent/'.vendor'
if LOCAL_VENDOR.exists():sys.path.insert(0,str(LOCAL_VENDOR))
import yaml
M=json.loads((ROOT/'curated/native-full/manifest.json').read_text(encoding='utf-8'))
errors=[];counts=Counter();regexes=set();filters=set();objects=[]
def check(ok,message):
    if not ok:errors.append(message)
def load_defaults(text):
    tokens={}
    def hide(match):
        token='NATIVE_CHECK_TOKEN_'+str(len(tokens));tokens[token]=match[1];return token
    obj=yaml.safe_load(re.sub(r'\{\{\{([^}]+)\}\}\}',hide,text))
    defaults=obj.get('compat_arguments',{})
    for token,key in tokens.items():
        check(key in defaults,'Undeclared parameter '+key)
        if key not in defaults:continue
        value=defaults[key]
        text=text.replace('{{{'+key+'}}}',str(value).lower() if isinstance(value,bool) else str(value))
    return yaml.safe_load(text)
def path_for(row):
    path=(ROOT/row['repository_path']).resolve()
    check(path.is_relative_to(ROOT),'Path escapes repository')
    return path
def pattern(expr):
    if expr in regexes:return
    regexes.add(expr)
    try:re.compile(expr.replace('(?i)',''),re.I if '(?i)' in expr else 0)
    except re.error as error:errors.append('Regex parser: '+str(error)+' '+expr)
def rule(entry):
    check(isinstance(entry,dict) and len(entry)==1,'Invalid rule union')
    if not isinstance(entry,dict) or len(entry)!=1:return
    kind,fields=next(iter(entry.items()))
    check(isinstance(fields,dict),'Invalid rule fields '+kind)
    if not isinstance(fields,dict):return
    check(kind in {'domain','domain_suffix','domain_keyword','domain_regex','domain_wildcard','ip_cidr','ip_cidr6','asn','geoip','url_regex','user_agent','dest_port','protocol','rule_set','ssid','bssid','cellular','and','or','not','default'},'Unknown rule '+kind)
    if 'policy' in fields:check(fields['policy'] in set(M['policy_names'])|{'DIRECT','REJECT'},'Unknown policy '+str(fields['policy']))
    if kind in {'domain_regex','url_regex'}:pattern(fields['match'])
    if kind in {'and','or'}:
        check(isinstance(fields['match'],list) and bool(fields['match']),'Empty logical expression '+kind)
        for child in fields['match']:rule(child)
    if kind=='not':rule(fields['match'])
deps={row['url']:row for row in M['dependencies']}
helpers={row['repository_path']:row for row in M.get('helpers',[])}
module_rows=M['modules']+M.get('extra_modules',[])
seen={};exact_duplicates=[]
for row in module_rows+M['dependencies']+list(helpers.values())+[M['priority_guard']]+M.get('extra_rule_sets',[])+M.get('source_evidence',[]):
    data=path_for(row).read_bytes()
    check(hashlib.sha256(data).hexdigest()==row['sha256'],'Hash mismatch '+row['repository_path'])
    check(not data.lstrip().lower().startswith((b'<html',b'<!doctype')),'HTML asset '+row['repository_path'])
for mod in module_rows:
    if 'original_repository_path' in mod:
        original=ROOT/mod['original_repository_path']
        check(hashlib.sha256(original.read_bytes()).hexdigest()==mod['source_sha256'],'Original module bytes changed '+mod['name'])
    else:check(mod.get('source_kind')=='reviewed-repository-delta','Missing original module evidence '+mod['name'])
    obj=load_defaults(path_for(mod).read_text(encoding='utf-8'));objects.append((mod,obj))
    for entry in obj.get('rules',[]):rule(entry)
    actual={section:len(obj.get(section,[])) for section in mod['counts']}
    check(actual==mod['counts'],'Section count mismatch '+mod['name'])
    for section in ('url_rewrites','body_rewrites','map_locals','scriptings'):
        for entry in obj.get(section,[]):
            fields=entry if 'match' in entry else next(iter(entry.values()))
            if isinstance(fields,dict) and 'match' in fields:pattern(fields['match'])
            if section=='url_rewrites':check(fields['location'] not in {'-','_','reject'},'Invalid rejection placeholder')
            if section=='body_rewrites':
                kind,fields=next(iter(entry.items()))
                if kind.endswith('_jq'):filters.add(fields['filter'])
                if kind.endswith('_regex'):pattern(fields['find'])
            if section=='map_locals':
                check(all(re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+",name) for name in fields.get('headers',{})),'Invalid HTTP header name')
            if section=='scriptings':
                url=fields['script_url'];row=deps.get(url)
                check(row is not None or any(url.endswith(p) for p in helpers),'Unregistered script '+url)
                if row:check(row['status']==200,'Unreachable original script '+url)
                if fields.get('binary_body'):check(fields.get('body_required') is True,'Binary handler has no body')
                check(0<fields.get('timeout',10)<=600,'Invalid script timeout')
            # Duplicate identity matches the builder; descriptions do not change
            # the runtime operation. Disabled modules are intentionally retained.
            identity=json.loads(json.dumps(entry))
            if section=='scriptings':next(iter(identity.values())).pop('name',None)
            key=(section,json.dumps(identity,sort_keys=True))
            if mod['enabled']:
                if key in seen:exact_duplicates.append((seen[key],mod['name'],section))
                seen[key]=mod['name']
    if mod['enabled']:
        for k,v in actual.items():counts[k]+=v
guard=yaml.safe_load(path_for(M['priority_guard']).read_text(encoding='utf-8'))
for entry in guard['rules']:rule(entry)
check(len(guard['rules'])==M['priority_guard']['rules'],'Priority guard count')
check(not exact_duplicates,'Exact active processing duplicates remain')
service_exact=set();service_suffix=set();module_keywords=set()
def gather(entry):
    kind,f=next(iter(entry.items()))
    if kind in {'and','or'}:
        for child in f['match']:gather(child)
    elif kind=='not':gather(f['match'])
    elif kind=='domain':service_exact.add(f['match'])
    elif kind=='domain_suffix':service_suffix.add(f['match'])
    elif kind=='domain_keyword':module_keywords.add(f['match'])
for mod,obj in objects:
    if mod['enabled']:
        for entry in obj.get('rules',[]):gather(entry)
for entry in guard['rules']:gather(entry)
managed=json.loads((ROOT/'curated/managed-rules.json').read_text(encoding='utf-8'))
for spec in managed['sets']:
    for entry in spec['rules']:
        if entry['kind']=='domain':service_exact.add(entry['value'])
        elif entry['kind']=='domain_suffix':service_suffix.add(entry['value'])
ancestors=set()
for host in service_exact|service_suffix:
    parts=host.split('.')
    ancestors.update('.'.join(parts[i:]) for i in range(len(parts)))
delta_count=0
for spec in M.get('extra_rule_sets',[]):
    delta=yaml.safe_load(path_for(spec).read_text(encoding='utf-8'))
    check(set(delta)<={'domain_set','domain_suffix_set'},'Supplement contains broad or IP selectors')
    check({k:len(v) for k,v in delta.items()}==spec['counts'],'Supplement count mismatch')
    seen_suffix=set();seen_exact=set()
    for kind,host in sorted(((k,h) for k,values in delta.items() for h in values),key=lambda pair:(pair[1].count('.'),pair[1])):
        delta_count+=1;parts=host.split('.')
        check(host not in service_exact and not any('.'.join(parts[i:]) in service_suffix for i in range(len(parts))),'Supplement overlaps existing rule '+host)
        check(kind!='domain_suffix_set' or host not in ancestors,'Supplement covers existing service '+host)
        check(not any(v and v in host for v in module_keywords),'Supplement shadowed by module keyword '+host)
        check(host not in seen_exact and not any('.'.join(parts[i:]) in seen_suffix for i in range(len(parts))),'Supplement internal duplicate/shadow '+host)
        (seen_suffix if kind=='domain_suffix_set' else seen_exact).add(host)
jq=shutil.which('jq') or str(ROOT.parent/'tools/jq.exe')
for expr in filters:
    result=subprocess.run([jq,'-n',expr],capture_output=True)
    # Runtime null-input errors are different from jq compile errors.
    check(result.returncode not in {2,3},'jq compile failed '+expr)
result={'passed':not errors,'errors':errors,'modules':len(module_rows)+1,
 'enabled':sum(m['enabled'] for m in module_rows)+1,'disabled':sum(not m['enabled'] for m in module_rows),
 'original_scripts':len(deps),'original_script_bytes_unchanged':True,
 'compatibility_helpers':len(helpers),'supplemental_domains':delta_count,'counts':counts,'unique_regexes_parsed':len(regexes),
 'unique_jq_compiled':len(filters),'exact_active_processing_duplicates':len(exact_duplicates),
 'unavailable_jq_not_enabled':len(M['invalid_jq_not_enabled']),
 'scope':'Repository integrity and execution prerequisites only; original runtime and App behavior require device logs.'}
print(json.dumps(result,ensure_ascii=False,indent=2));sys.exit(bool(errors))
