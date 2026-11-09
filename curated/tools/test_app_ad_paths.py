"""Author-declared App paths and transport prerequisites, outside scoring sites.

Inputs are synthetic witnesses. Passing checks proves routing/handler
prerequisites and ownership, not current App API or iOS script execution.
"""
from pathlib import Path
from urllib.parse import urlsplit
import argparse, fnmatch, hashlib, json, sys

ROOT=Path(__file__).resolve().parents[2]
vendor=ROOT.parent/'.vendor'
if vendor.exists():sys.path.insert(0,str(vendor))
import yaml
from adblock_model import DomainRouter, load_defaults


def main(profile=None):
    config=yaml.safe_load(Path(profile).read_text(encoding='utf-8')) if profile else None
    model=DomainRouter(ROOT,config)
    fixture=json.loads((ROOT/'curated/native-full/app-path-fixtures.json').read_text(encoding='utf-8'))
    manifest=model.manifest
    errors=[]; results=[]
    def check(ok, label, **details):
        row={'name':label,'passed':bool(ok),**details};results.append(row)
        if not ok:errors.append(row)
    def hit(pattern,url):return model.rx(pattern,url)
    def candidates(url):
        groups={k:[] for k in ('terminal','request','response_script','response_body')}
        for name,obj in model.active+([('主配置',config)] if config else []):
            for section in ('url_rewrites','map_locals','body_rewrites','scriptings'):
                for e in obj.get(section,[]):
                    phase,f=(section,e) if section in {'url_rewrites','map_locals'} else next(iter(e.items()))
                    if f.get('disabled') or not f.get('match') or not hit(f['match'],url):continue
                    key='terminal' if section in {'url_rewrites','map_locals'} else 'request' if phase=='http_request' else 'response_script' if phase=='http_response' else 'response_body' if phase.startswith('response_') else None
                    if key:groups[key].append({'module':name,'phase':phase,'script_url':f.get('script_url')})
        return groups
    def mitm(host):
        if config:
            hosts=config['mitm']['hostnames']
            return any(fnmatch.fnmatchcase(host,p) for p in hosts['includes']) and not any(fnmatch.fnmatchcase(host,p) for p in hosts['excludes'])
        # Public CI verifies enabled module declarations; the private-profile
        # run separately verifies its actual include/exclude and DNS lists.
        for _,obj in model.active:
            hosts=obj.get('mitm',{}).get('hostnames',[])
            if isinstance(hosts,dict):hosts=hosts.get('includes',[])
            if any(fnmatch.fnmatchcase(host,p) for p in hosts):return True
        return False
    for row in fixture['paths']:
        url=row['url'];host=urlsplit(url).hostname
        if row.get('evidence'):
            e=row['evidence'];raw=(ROOT/e['original_repository_path']).read_bytes()
            check(hashlib.sha256(raw).hexdigest()==e['source_sha256'],row['app']+' 原始来源哈希')
            original=load_defaults(raw.decode('utf-8-sig'))
            source_match=False
            for match in e['matches']:
                for entry in original.get(match['section'],[]):
                    phase,f=(match['section'],entry) if match['section'] in {'url_rewrites','map_locals'} else next(iter(entry.items()))
                    if phase==match['phase'] and f.get('match')==match['match'] and hit(f['match'],url):source_match=True
            check(source_match,row['app']+' '+row['scene']+' 来源接口声明')
        h=candidates(url);route=model.route(url,protocol='tcp')
        count={k:len(v) for k,v in h.items()}
        if row['expected']=='gap':
            check(not any(h.values()),row['app']+' 已记录缺口保持诚实',counts=count)
            continue
        check(count[row['expected']]>0,row['app']+' '+row['scene']+' 有目标处理者',counts=count)
        check(all(n<=1 for n in count.values()),row['app']+' '+row['scene']+' 每阶段单处理者',counts=count)
        check(not (count['terminal'] and (count['response_script'] or count['response_body'])),row['app']+' '+row['scene']+' 响应未被提前终结',counts=count)
        # The resolver selects one response owner, including across jq/JS.
        check(count['response_script']+count['response_body']<=1,row['app']+' '+row['scene']+' 单响应所有者',counts=count)
        if any(h.values()) and url.startswith('https:'):
            check(mitm(host),row['app']+' '+row['scene']+' MITM前提')
        if count['request'] or count['response_script'] or count['response_body'] or any(v['phase']=='map_locals' for v in h['terminal']):
            check(route['policy'] not in {'REJECT','去广告'},row['app']+' '+row['scene']+' HTTP处理未被域名拒绝',route=route)
            if config:
                decision=next((f['value'] for node in config['dns']['forward'] for k,f in node.items() if model.matches(k,f,url,host)),None)
                check(decision!='reject',row['app']+' '+row['scene']+' DNS未拒绝',dns=decision)
    for row in fixture['transports']:
        actual=model.route(row['url'],protocol=row['protocol'],user_agent=row.get('user_agent'))
        rejected=actual['policy'] in {'REJECT','去广告'}
        ok=rejected==row['reject'] and (not row.get('policy') or actual['policy']==row['policy'])
        check(ok,row['name'],route=actual,protocol=row['protocol'])
    for row in fixture['normal']:
        h=candidates(row['url']);route=model.route(row['url'],protocol='tcp')
        terminal=h['terminal']+[v for v in h['request'] if (v.get('script_url') or '').endswith(('/static-protobuf.js','/static-meituan-gif.js'))]
        check(not terminal and route['policy'] not in {'REJECT','去广告'},row['name'],route=route,terminal=terminal)
    result={'passed':not errors,'cases':len(results),'path_witnesses':len(fixture['paths']),
            'transport_cases':len(fixture['transports']),'normal_cases':len(fixture['normal']),
            'profile_supplied':bool(config),'failures':errors,
            'scope':'Synthetic author-declared URL and explicit transport contexts; not live phone acceptance.'}
    if config:(ROOT.parent/'app-ad-path-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--profile');args=parser.parse_args()
    sys.exit(not main(args.profile)['passed'])
