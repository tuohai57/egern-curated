"""Service ownership, supported-country boundaries and failover regression."""
from pathlib import Path
import fnmatch,hashlib,ipaddress,json,sys
ROOT=Path(__file__).resolve().parents[2]
vendor=ROOT.parent/'.vendor'
if vendor.exists():sys.path.insert(0,str(vendor))
from adblock_model import DomainRouter
import yaml
data=json.loads((ROOT/'curated/routing/service-audit.json').read_text(encoding='utf-8'))
graph=data['graph'];spec=data['spec'];checks=[];errors=[]
model=DomainRouter(ROOT,{'rules':data['main_rules']})
def check(ok,label,**detail):
 row={'name':label,'passed':bool(ok),**detail};checks.append(row)
 if not ok:errors.append(row)
def policy_references(value):
 if isinstance(value,dict):
  for key,item in value.items():
   if key=='policy':yield item
   else:yield from policy_references(item)
 elif isinstance(value,list):
  for item in value:yield from policy_references(item)

legacy=json.loads((ROOT/'curated/routing/legacy-guard-compatibility.json').read_text(encoding='utf-8'))
for profile in legacy['profiles']:
 raw=(ROOT/profile['repository_path']).read_bytes()
 check(hashlib.sha256(raw).hexdigest()==profile['sha256'],'旧保护URL保留原字节 '+profile['repository_path'])
 unknown=set(policy_references(yaml.safe_load(raw)))-set(profile['allowed_policies'])
 check(not unknown,'旧配置保护模块不存在未知策略 '+profile['repository_path'],unknown=sorted(unknown))
check('Muse' not in legacy['profiles'][1]['allowed_policies'],'旧245组兼容样例不虚增Muse组')
active_guard=json.loads((ROOT/'curated/native-full/manifest.json').read_text(encoding='utf-8'))['priority_guard']
check(active_guard['repository_path']=='curated/native-full/priority-guard-ai-regions-muse.yaml','新增Muse保护使用独立URL')
check(set(policy_references(yaml.safe_load((ROOT/active_guard['repository_path']).read_bytes())))<=set(graph)|{'DIRECT','REJECT'},'新版保护仅引用当前已有策略')

def resolve(name,dead=(),path=()):
 assert name not in path,'Cycle '+name
 if name not in graph:return None if name in dead else name
 g=graph[name];kind=g['kind']
 if kind=='country':return None if g['country'] in dead else g['country']
 if kind=='financial':return None if g['country'] in dead else '金融:'+g['country']
 if kind=='conditional':return resolve(g['target'],dead,path+(name,))
 if kind=='select':return resolve(g['policies'][0],dead,path+(name,))
 candidates=g.get('policies',g.get('countries',[]))
 return next((v for child in candidates if (v:=resolve(child,dead,path+(name,))) is not None),None)
def countries(name,path=()):
 assert name not in path,'Cycle '+name
 if name not in graph:return {name}
 g=graph[name]
 if g['kind']=='country':return {g['country']}
 if g['kind']=='financial':return {'金融:'+g['country']}
 if g['kind']=='conditional':return countries(g['target'],path+(name,))
 if g['kind']=='select':return countries(g['policies'][0],path+(name,))
 return set().union(*(countries(v,path+(name,)) for v in g.get('policies',g.get('countries',[]))))
for name in graph:check(graph[name]['kind']!='select' or name=='Apple AI补充','仅用户要求的 Apple AI补充允许切 DIRECT '+name)
check(graph['Apple AI补充']['policies']==['Apple智能','DIRECT'],'Apple AI补充 默认自动代理，停用时可手动直连')
supplement_url='https://raw.githubusercontent.com/tuohai57/egern-curated/main/curated/rules/managed/apple-ai-supplement.yaml'
supplement_path=ROOT/'curated/rules/managed/apple-ai-supplement.yaml'
supplement=yaml.safe_load(supplement_path.read_text(encoding='utf-8'))
expected={
 'domain_set':{'mask-api.fe.apple-dns.net','mask-api.icloud.com','mask-t.apple-dns.net','mask.apple-dns.net','wps.apple.com'},
 'domain_suffix_set':{'guzzoni.apple.com','smoot.apple.com','apple-relay.apple.com','apple-relay.cloudflare.com','apple-relay.fastly-edge.com','apple-relay.mask.apple-dns.net','cp4.cloudflare.com','gateway.icloud.com','ls.apple.com','mask-h2.icloud.com','mask.icloud.com','apps.mastic.com','apps.mzstatic.com','apple-relay.akamaized.net'},
 'domain_keyword_set':{'siri','apple-relay'},
 'ip_cidr_set':{'17.248.152.0/24'}}
check({k:set(v) for k,v in supplement.items() if k!='no_resolve'}==expected,'两张截图与审阅增量保持22个有效选择器')
check(sum(len(v) for v in supplement.values() if isinstance(v,list))==22,'补充规则总数可由远程YAML复算')
check(supplement.get('no_resolve') is True,'补充IP规则只匹配已有IP，不额外触发DNS解析')
check(ipaddress.ip_network('17.248.152.145/24',strict=False)==ipaddress.ip_network('17.248.152.113/24',strict=False),'截图两条CIDR为同一网段')
refs=[f for _,node in model.rules for kind,f in node.items() if kind=='rule_set' and f['match']==supplement_url]
check(len(refs)==1 and refs[0]['policy']=='Apple AI补充' and refs[0]['update_interval']==86400,'截图远程集合仅引用一次并每天更新')
for kind,values in expected.items():
 for value in values:
  host=('siriously.example.com' if value=='siri' else 'edge.apple-relay.example.com') if kind=='domain_keyword_set' else '17.248.152.113' if kind=='ip_cidr_set' else value
  route=model.route('https://'+host+'/')
  check(route['policy']=='Apple AI补充','截图范围独立控制 '+host,actual=route['policy'])
  if route['policy']=='Apple AI补充':
   original=graph['Apple AI补充']['policies']
   try:
    graph['Apple AI补充']['policies']=['DIRECT','Apple智能']
    check(resolve(route['policy'])=='DIRECT','补充开关选择DIRECT可达 '+host)
   finally:graph['Apple AI补充']['policies']=original
for host in ['17.248.152.0','17.248.152.113','17.248.152.145','17.248.152.255']:
 check(model.route('https://'+host+'/')['policy']=='Apple AI补充','截图IP全网段先于Apple直连兜底 '+host)
for host in ['17.248.151.255','17.248.153.0']:
 check(model.route('https://'+host+'/')['policy']=='Apple系统服务','相邻Apple网段不扩大代理 '+host)
check(model.route('https://17.248.152.113:53/')['policy']=='REJECT','新增IP网段不绕过公网明文DNS阻断')
for host in ['apple-relay.paypal.com','apple-relay.icbc.com.cn']:
 expected_policy='PayPal' if host.endswith('paypal.com') else '中国工商银行'
 check(model.route('https://'+host+'/')['policy']==expected_policy,'新增关键词不覆盖金融保护 '+host)
for host,policy in [('siri.paypal.com','PayPal'),('siri.icbc.com.cn','中国工商银行'),('gspe19-cn-ssl.ls.apple.com','Apple地图国内')]:
 actual=model.route('https://'+host+'/')['policy']
 check(actual==policy,'金融与国内地图具体例外前置 '+host,actual=actual,expected=policy)
check(model.blocked('siri.googlesyndication.com'),'宽siri关键词不放行已有广告域')
check(model.blocked('apple-relay.googlesyndication.com'),'新增apple-relay关键词不放行已有广告域')
check('guzzoni.apple.com' not in supplement['domain_set'],'Siri后缀替换原精确规则而非重复叠加')
check('api-siri-prod.apple.com' not in supplement['domain_suffix_set'],'siri关键词已覆盖的上游规则不重复添加')
check('gspe1-ssl.ls.apple.com' not in supplement['domain_suffix_set'],'ls父域已覆盖的上游规则不重复添加')
for host in ['wps.apple.com','apps.mzstatic.com']:
 check(host in data['mitm_excludes'] and '*.'+host in data['mitm_excludes'],'新增共享服务不解密 '+host)
for name,members in spec['pools'].items():
 members=[r for r in members if r in graph and graph[r]['kind']=='country']
 check(graph[name]['policies']==members,'地区顺序 '+name)
 check(graph[name]['interval']==120,'故障检查间隔 '+name)
 for country in members:
  check(resolve(name,[r for r in members if r!=country])==country,'仅 '+country+' 存活 '+name)
 check(resolve(name,members) is None,'全部地区失败不越界 '+name)
for name in spec['ai_groups']:
 leaves=countries(name)
 check(bool(leaves),'AI 存在出口 '+name)
 check(not (leaves & {'香港','DIRECT','自动选择','故障转移'}) or leaves=={'DIRECT'},'AI 无香港/通用池后备 '+name,regions=sorted(leaves))
 check(resolve(name,leaves) is None if leaves!={'DIRECT'} else resolve(name)=='DIRECT','AI 全故障边界 '+name)
for name,_,roots in spec['domestic']:
 check(resolve(name)=='DIRECT','国区服务直连 '+name)
for name,target in spec['targets'].items():
 check(graph[name]['target']==target,'独立服务目标 '+name)
def dns(host):
 for node in data['dns_forward']:
  kind,p=next(iter(node.items()));value=p['match']
  if (kind=='domain' and host==value) or (kind=='domain_suffix' and (host==value or host.endswith('.'+value))) or (kind=='domain_wildcard' and fnmatch.fnmatchcase(host,value)):return p['value']
for row in data['fixtures']:
 actual=model.route('https://'+row['host']+'/')['policy']
 if row['policy'] is None:
  check(actual not in spec['ai_groups'],'公共域名未误占到 AI '+row['host'],actual=actual)
  continue
 check(actual==row['policy'],'模块和主规则归属 '+row['scene'],actual=actual,expected=row['policy'])
 endpoint=resolve(row['policy'])
 expected='国内加密DNS' if endpoint=='DIRECT' else '国外加密DNS'
 check(dns(row['host'])==expected,'DNS 与服务分类一致 '+row['scene'],actual=dns(row['host']),expected=expected)
for name,roots in spec['critical'].items():
 for h in roots:
  check(h in data['mitm_excludes'] and '*.'+h in data['mitm_excludes'],'关键 AI/账户接口不解密 '+h)
for labels in [('OpenAI','ChatGPT','Sora','Apple智能','Siri','Apple私密中继'),('Google','Google 国外','Gemini','Google AI Studio','NotebookLM'),('Microsoft','Outlook','Teams','Microsoft Copilot','Bing'),('GitHub','GitHub Copilot'),('Anthropic','Claude'),('X','Grok'),('Meta共享','Meta AI','Facebook','Instagram','WhatsApp')]:
 for dead in [(),('美国',),('美国','日本')]:
  check(len({resolve(n,dead) for n in labels})==1,'共享链路地区联动 '+' / '.join(labels)+' '+str(dead))
result={'passed':not errors,'checks':len(checks),'failures':errors,'ai_groups':len(spec['ai_groups']),'country_pools':len(spec['pools']),'route_witnesses':len(data['fixtures']),'scope':data['scope']}
(ROOT/'curated/routing/test-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
if errors:raise SystemExit(1)
