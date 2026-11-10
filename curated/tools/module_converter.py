"""Explicit Surge/QX -> Egern conversion. Unknown operations remain in the audit.

No upstream JavaScript is edited here. Callers must resolve and audit dependencies
before enabling a converted module. A successful parse is not a device test.
"""
import base64, json, re

SECTIONS = ('rules', 'url_rewrites', 'header_rewrites', 'body_rewrites', 'map_locals', 'scriptings')


def split_top(text, delimiter=','):
    result=[]; start=0; depth=0; quote=None; escape=False
    for i,ch in enumerate(text):
        if escape: escape=False; continue
        if ch=='\\': escape=True; continue
        if quote:
            if ch==quote: quote=None
        elif ch in '\"\'': quote=ch
        elif ch in '({[': depth+=1
        elif ch in ')}]': depth-=1
        elif ch==delimiter and depth==0: result.append(text[start:i].strip());start=i+1
    result.append(text[start:].strip()); return result


def rule(text):
    aliases={'host':'domain','host-suffix':'domain_suffix','host-keyword':'domain_keyword',
             'host-wildcard':'domain_wildcard','ip6-cidr':'ip_cidr6','ip-cidr6':'ip_cidr6',
             'dst-port':'dest_port'}
    def node(text):
        parts=split_top(text); kind=aliases.get(parts[0].lower(),parts[0].lower().replace('-','_'))
        if kind in {'and','or','not'}:
            raw=parts[1].strip();assert raw[0]=='(' and raw[-1]==')'
            children=[node(p.strip()[1:-1]) for p in split_top(raw[1:-1])]
            value=children[0] if kind=='not' else children
        else:
            assert kind in {'domain','domain_suffix','domain_keyword','domain_wildcard','domain_regex','url_regex','ip_cidr','ip_cidr6','dest_port','protocol','user_agent','geoip','ip_asn'}, 'unsupported rule '+kind
            value=parts[1].strip().strip('"')
        fields={'match':value}
        if len(parts)>2:
            policy=parts[2].upper()
            fields['policy']='REJECT' if policy.startswith('REJECT') else ('自动选择' if policy=='PROXY' else policy)
        if any(p.lower()=='no-resolve' for p in parts[3:]):fields['no_resolve']=True
        return {kind:fields}
    return node(text)


def unquote(text):
    text=text.strip()
    return text[1:-1] if len(text)>1 and text[0]==text[-1] and text[0] in '\"\'' else text


def convert(text, name, dependency, binary_local, adapter=None):
    """Return native object and changes; callbacks keep transport outside parser."""
    obj={'name':name}; notes=[]; section=''; counter=0
    def add(key,item): obj.setdefault(key,[]).append(item)
    def script(pattern,url,phase,options=None):
        nonlocal counter
        counter+=1;options=options or {}
        phase=phase.replace('-','_')
        fields={'name':name+' / '+str(counter),'match':pattern,'script_url':dependency(url),
                'body_required':str(options.get('requires-body','true')).lower() in {'true','1'},
                'update_interval':86400}
        if str(options.get('binary-body-mode','false')).lower() in {'true','1'}:fields['binary_body']=True
        if 'timeout' in options:fields['timeout']=min(600,max(1,int(options['timeout'])))
        if 'max-size' in options:
            size=int(options['max-size']);fields['max_size']=size if size>0 else 16777216
            if size<0:notes.append({'kind':'unlimited_body_mapped_to_16MiB','source':pattern})
        if 'argument' in options:
            fields['env']={'argument':unquote(options['argument'])}
        if adapter and phase in {'http_request','http_response'} and options.get('qx'):
            fields['script_url']=adapter(url,fields['script_url'],options)
        add('scriptings',{phase:fields})
    for raw in text.splitlines():
        line=raw.strip()
        if not line:continue
        meta=re.match(r'^(?:#!|//\s*@)(name|desc|description|author|homepage|icon|arguments)(?:\s*=\s*|\s+)(.*)$',line,re.I)
        if meta:
            key,value=meta.groups();key=key.lower()
            key={'desc':'description','arguments':'compat_arguments'}.get(key,key)
            if key=='compat_arguments':
                obj[key]={}
                for item in split_top(value):
                    k,v=item.split(':',1);v=unquote(v)
                    obj[key][k]=True if v=='true' else False if v=='false' else v
            elif key!='name':obj[key]=value
            continue
        if line.startswith(('#','//',';')) or re.fullmatch(r'/\*+|\*+/',line):continue
        if re.fullmatch(r'\[[^\]]+\]',line):section=line[1:-1].lower();continue
        if re.match(r'^hostname\s*=',line,re.I):
            value=line.split('=',1)[1].replace('%APPEND%','').replace('%INSERT%','')
            obj.setdefault('mitm',{}).setdefault('hostnames',[]).extend(h.strip() for h in value.split(',') if h.strip());continue
        try:
            if section=='rule' or re.match(r'^(host(?:-suffix|-keyword|-wildcard)?|ip(?:6)?-cidr)\s*,',line,re.I):
                add('rules',rule(line))
            elif section=='script':
                sname,payload=line.split('=',1)
                options={k:v for k,v in re.findall(r'(?:^|,\s*)([\w-]+)=(.*?)(?=,\s*[\w-]+=|$)',payload.strip())}
                if options['type'] in {'http-request','http-response'}:script(options['pattern'],options['script-path'],options['type'],options)
                else:raise ValueError('Unsupported script type '+options['type'])
            elif section=='map local':
                pattern,payload=line.split(None,1)
                values={k:v.strip() for k,v in re.findall(r'(?:^|\s+)([\w-]+)=(.*?)(?=\s+[\w-]+=|$)',payload)}
                data=unquote(values.get('data',''));status=int(values.get('status-code',200));headers={}
                for h in unquote(values.get('header','')).split('|'):
                    if ':' in h:k,v=h.split(':',1);headers[k.strip()]=v.strip()
                if values.get('data-type') in {'base64','tiny-gif'}:
                    if values.get('data-type')=='tiny-gif':
                        rawbody=base64.b64decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');headers.setdefault('Content-Type','image/gif')
                    else:rawbody=base64.b64decode(data,validate=True)
                    add('scriptings',{'http_request':{'name':name+' / binary local','match':pattern,'script_url':binary_local(rawbody,status,headers),'body_required':False}})
                elif values.get('data-type','text')=='text':
                    fields={'match':pattern,'status_code':status,'body':data}
                    if headers:fields['headers']=headers
                    add('map_locals',fields)
                else:raise ValueError('Unsupported local response type '+values['data-type'])
            elif section=='body rewrite':
                kind,pattern,expression=line.split(None,2)
                if kind.endswith('-jq'):
                    phase='response_jq' if kind.startswith('http-response') else 'request_jq'
                    add('body_rewrites',{phase:{'match':pattern,'filter':unquote(expression)}})
                elif kind in {'http-response','http-request'}:
                    found=re.match(r"('(?:[^']*)'|\"(?:[^\"]*)\"|\S+)\s+(.+)$",expression)
                    assert found,'Missing body replacement'
                    phase='response_regex' if kind=='http-response' else 'request_regex'
                    add('body_rewrites',{phase:{'match':pattern,'find':unquote(found[1]),'replace':unquote(found[2])}})
                else:raise ValueError('Unsupported body rewrite '+kind)
            elif section=='header rewrite':
                kind,pattern,operation,payload=line.split(None,3)
                values=re.findall(r"'([^']*)'|\"([^\"]*)\"",payload)
                values=[a or b for a,b in values]
                if operation=='header-add' and len(values)==2:
                    phase='response' if kind=='http-response' else 'request'
                    add('header_rewrites',{'add':{'match':pattern,'name':values[0],'value':values[1],'type':phase}})
                else:raise ValueError('Unsupported header operation '+operation)
            elif section=='url rewrite':
                parts=line.split();pattern=parts[0];action=parts[-1]
                if action.startswith('reject'):
                    if action in {'reject-dict','reject-array','reject-200'}:add('map_locals',{'match':pattern,'status_code':200,'body':{'reject-array':'[]','reject-dict':'{}','reject-200':''}[action]})
                    elif action in {'reject-img','reject-img-1x1','reject-video'}:
                        if action=='reject-video':raise ValueError('Video local response requires an audited media payload')
                        add('scriptings',{'http_request':{'name':name+' / tiny GIF','match':pattern,'script_url':binary_local(base64.b64decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),200,{'Content-Type':'image/gif'}),'body_required':False}})
                    else:add('rules',{'url_regex':{'match':pattern,'policy':'REJECT'}})
                elif action in {'302','307','301','308'}:add('url_rewrites',{'match':pattern,'location':parts[1],'status_code':int(action)})
                else:raise ValueError('Unsupported URL operation '+action)
            elif re.match(r'^\S+\s+url\s+',line):
                pattern,_,action,payload=(line.split(None,3)+[''])[:4]
                if action.startswith('script-'):
                    if action in {'script-echo-response','script-analyze-echo-response'}:
                        script(pattern,payload.strip(),'http_request',{'requires-body':'true' if action=='script-analyze-echo-response' else 'false','qx':True,'echo':True});continue
                    phase='http_response' if 'response' in action else 'http_request'
                    script(pattern,payload.strip(),phase,{'requires-body':'true' if 'body' in action else 'false','qx':True})
                elif action.startswith('jsonjq-'):
                    phase='response_jq' if 'response' in action else 'request_jq'
                    add('body_rewrites',{phase:{'match':pattern,'filter':unquote(payload)}})
                elif action in {'302','307','301','308'}:add('url_rewrites',{'match':pattern,'location':payload,'status_code':int(action)})
                elif action in {'request-header','response-header'}:
                    raise ValueError('QX header replacement needs an explicit adapter')
                elif action in {'request-body','response-body'}:
                    find,replace=payload.split(' '+action+' ',1)
                    add('body_rewrites',{'response_regex' if action=='response-body' else 'request_regex':{'match':pattern,'find':find,'replace':replace}})
                elif action.startswith('reject'):
                    one,n=convert('[URL Rewrite]\n'+pattern+' - '+action,name,dependency,binary_local)
                    for k in SECTIONS:
                        for entry in one.get(k,[]):add(k,entry)
                    notes.extend(n)
                else:raise ValueError('Unsupported QX operation '+action)
            elif section in {'general','mitm'}:
                if section=='general':notes.append({'kind':'app_setting_not_imported','source':line})
                elif '=' in line and not re.match(r'^(const|var|let)\s',line):
                    if re.match(r'^[A-Za-z_-]+\s*=',line):raise ValueError('Unknown MITM setting')
            elif line.startswith(('^','(?i)')):raise ValueError('Undeclared rewrite syntax')
        except (ValueError,KeyError,AssertionError) as e:
            notes.append({'kind':'unsupported','source':line,'reason':str(e)})
    return obj,notes
