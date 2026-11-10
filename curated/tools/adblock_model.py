"""Offline domain first-match model. No DNS/network result is inferred from it."""
from pathlib import Path
import fnmatch, ipaddress, json, re
from urllib.parse import urlsplit
import yaml


def within(host, root):
    return host == root or host.endswith('.' + root)


def parents(host):
    pieces = host.lower().rstrip('.').split('.')
    return ['.'.join(pieces[i:]) for i in range(len(pieces))]


def load_defaults(text):
    tokens = {}
    def hide(match):
        token = 'ADBLOCK_ARGUMENT_' + str(len(tokens))
        tokens[token] = match[1]
        return token
    obj = yaml.safe_load(re.sub(r'\{\{\{([^}]+)\}\}\}', hide, text))
    for key in tokens.values():
        value = obj['compat_arguments'][key]
        text = text.replace('{{{' + key + '}}}', str(value).lower() if isinstance(value, bool) else str(value))
    return yaml.safe_load(text)


class DomainRouter:
    def __init__(self, root, profile=None):
        self.root = Path(root)
        self.manifest = json.loads((self.root/'curated/native-full/manifest.json').read_text(encoding='utf-8'))
        m = self.manifest
        self.sets = {}
        managed = json.loads((self.root/'curated/managed-rules.json').read_text(encoding='utf-8'))
        for row in managed['sets'] + m.get('extra_rule_sets', []):
            obj = yaml.safe_load((self.root/row['repository_path']).read_text(encoding='utf-8'))
            self.sets[row['url']] = {k: set(v) for k, v in obj.items() if isinstance(v, list)}
        self.active = []
        rows=[m['priority_guard']] + m.get('extra_modules', []) + m['modules']
        if profile is not None:
            stack_path=self.root/'curated/module-stack/manifest.json'
            stack=json.loads(stack_path.read_text(encoding='utf-8')) if stack_path.exists() else {'modules':[]}
            index={row['url']:row for row in rows+stack['modules']}
            hub_path=self.root/'curated/hub-resources/manifest.json'
            if hub_path.exists():
                index.update({row['url']:row for row in json.loads(hub_path.read_text(encoding='utf-8'))['modules']})
            rows=[]
            for ref in profile.get('modules',[]):
                if not ref.get('enabled',True):continue
                if ref['url'] not in index:raise ValueError('Unknown active profile module: '+ref['url'])
                rows.append({**index[ref['url']],'enabled':True})
        for row in rows:
            if not row.get('enabled', True): continue
            obj = load_defaults((self.root/row['repository_path']).read_text(encoding='utf-8'))
            self.active.append((row['name'], obj))
        self.rules = [(name, n) for name, obj in self.active for n in obj.get('rules', [])]
        if profile is not None:
            self.rules += [('主配置', n) for n in profile['rules']]
        else:
            # Only a repository-level fallback; personal-profile audits supply
            # the actual local rules, including their exact first-match order.
            self.rules += [('维护集合', {'rule_set': {'match': r['url'], 'policy': r['rules'][0]['policy']}})
                           for r in managed['sets'] if r['rules']]
        self.regexes = {}

    def rx(self, pattern, value):
        if pattern not in self.regexes:
            self.regexes[pattern] = re.compile(pattern.replace('(?i)', ''), re.I if '(?i)' in pattern else 0)
        return self.regexes[pattern].search(value) is not None

    def matches(self, kind, f, url, host, protocol=None, user_agent=None):
        value = f.get('match', '')
        if kind == 'domain': return host == value
        if kind == 'domain_suffix': return within(host, value)
        if kind == 'domain_keyword': return value in host
        if kind == 'domain_wildcard': return fnmatch.fnmatchcase(host, value)
        if kind == 'domain_regex': return self.rx(value, host)
        if kind == 'url_regex': return self.rx(value, url)
        if kind == 'default': return True
        if kind == 'protocol':
            # No protocol is inferred from an HTTPS URL: it can use TCP or QUIC.
            return protocol is not None and str(value).casefold() == protocol.casefold()
        if kind == 'user_agent':
            return user_agent is not None and fnmatch.fnmatchcase(user_agent.casefold(), str(value).casefold())
        if kind in {'and', 'or'}:
            result = [self.matches(*next(iter(n.items())), url, host, protocol, user_agent) for n in value]
            return all(result) if kind == 'and' else any(result)
        if kind == 'not': return not self.matches(*next(iter(value.items())), url, host, protocol, user_agent)
        if kind == 'dest_port':
            return str(urlsplit(url).port or (443 if url.startswith('https:') else 80)) in str(value).split(',')
        if kind == 'rule_set':
            obj = self.sets.get(value, {})
            try:
                address = ipaddress.ip_address(host)
            except ValueError:
                address = None
            ip_match = address is not None and any(
                address in ipaddress.ip_network(net)
                for net in obj.get('ip_cidr_set', set()))
            return (ip_match or host in obj.get('domain_set', set()) or
                    any(v in obj.get('domain_suffix_set', set()) for v in parents(host)) or
                    any(v in host for v in obj.get('domain_keyword_set', set())) or
                    any(fnmatch.fnmatchcase(host, v) for v in obj.get('domain_wildcard_set', set())) or
                    any(self.rx(v, host) for v in obj.get('domain_regex_set', set())))
        if kind in {'ip_cidr', 'ip_cidr6'}:
            try: return ipaddress.ip_address(host) in ipaddress.ip_network(value)
            except ValueError: return False
        # UA/GeoIP/ASN/process facts are unavailable in an offline URL model.
        return False

    def route(self, url, protocol=None, user_agent=None):
        host = urlsplit(url).hostname
        for index, (name, node) in enumerate(self.rules):
            kind, fields = next(iter(node.items()))
            if not fields.get('disabled') and self.matches(kind, fields, url, host, protocol, user_agent):
                return {'module': name, 'kind': kind, 'match': fields.get('match'),
                        'policy': fields.get('policy'), 'position': index}
        return {'policy': None, 'module': None}

    def blocked(self, host):
        return self.route('https://' + host + '/favicon.ico')['policy'] in {'REJECT', '去广告'}
