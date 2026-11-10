"""Explicit conversion of readable Loon 3.5 Rewrite/Script syntax to Egern.

This is a parser, not a decryptor. Unsupported expressions are reported rather
than silently ignored. No downloaded JavaScript is executed or rewritten.
"""
import base64
import json
import re
from collections import OrderedDict
from module_converter import rule, split_top, SECTIONS


def literal(text):
    text = text.strip()
    if text.startswith('`') and text.endswith('`'):
        return text[1:-1].replace('``', '`')
    return json.loads(text)


def regexp(text):
    """Read one slash-delimited regex, respecting escapes and character sets."""
    assert text.startswith('/'), 'Expected a regex literal'
    escaped = inside = False
    for index, char in enumerate(text[1:], 1):
        if escaped:
            escaped = False
            continue
        if char == '\\':
            escaped = True
        elif char == '[':
            inside = True
        elif char == ']':
            inside = False
        elif char == '/' and not inside:
            end = index + 1
            while end < len(text) and text[end].isalpha():
                end += 1
            flags = text[index+1:end]
            assert set(flags) <= set('ims'), 'Unsupported regex flags: ' + flags
            pattern = ('(?'+flags+')' if flags else '') + text[1:index]
            re.compile(pattern)
            return pattern, text[end:].strip()
    raise ValueError('Unterminated regex literal')


def keypath(text):
    """Translate documented simple Loon JSON paths without guessing wildcards."""
    assert isinstance(text, str), 'Expected a JSON path string'
    text = text.removeprefix('$.')
    result = []
    remaining = text
    first = True
    while remaining:
        if not first and remaining.startswith('.'):
            remaining = remaining[1:]
        elif not first and not remaining.startswith('['):
            raise ValueError('Unsupported JSON path: '+text)
        first = False
        if remaining.startswith('['):
            numeric = re.match(r'^\[(\d+)\]', remaining)
            if numeric:
                result.append(int(numeric[1]))
                remaining = remaining[numeric.end():]
                continue
            assert remaining[1:2] == '"', 'Unsupported JSON path: '+text
            value, end = json.JSONDecoder().raw_decode(remaining[1:])
            assert isinstance(value, str) and remaining[end+1:end+2] == ']', 'Unsupported JSON path: '+text
            result.append(value)
            remaining = remaining[end+2:]
            continue
        segment = re.match(r'^[A-Za-z0-9_$/-]+', remaining)
        assert segment, 'Unsupported JSON path: '+text
        result.append(segment[0])
        remaining = remaining[segment.end():]
    assert result, 'Empty JSON path'
    return result


def defaults(text):
    values = {}
    active = False
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith('['):
            active = line.lower() == '[argument]'
        elif active and '=' in line and not line.startswith('#'):
            name, payload = line.split('=', 1)
            parts = split_top(payload)
            assert len(parts) >= 2, 'Argument has no default'
            try:
                values[name.strip()] = literal(parts[1])
            except json.JSONDecodeError:
                values[name.strip()] = parts[1].strip()
    return values


def argument(text, values):
    text = text.strip()
    direct = re.fullmatch(r'\$\{([^}]+)\}', text)
    if direct:
        return values[direct[1]]
    if text.startswith('{') and '${' in text:
        keys = re.findall(r'\$\{([^}]+)\}', text)
        assert keys and all(key in values for key in keys), 'Undeclared script argument'
        return {key: values[key] for key in keys}
    result = literal(text)
    if isinstance(result, str):
        def replace(match):
            value = values[match[1]]
            return json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
        result = re.sub(r'\$\{([^}]+)\}', replace, result)
    return result


def convert_lpx(text, name, dependency, binary_local, resource, argument_adapter):
    obj = {'name': name}
    notes = []
    values = defaults(text)
    section = ''
    grouped = OrderedDict()
    recognized = converted = 0

    def add(section, value):
        obj.setdefault(section, []).append(value)

    def jq(phase, match, expression):
        key = (phase, match)
        grouped.setdefault(key, []).append(expression)

    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        meta = re.match(r'^#!(desc|author|homepage|icon)=(.*)$', line)
        if meta:
            obj[{'desc':'description'}.get(meta[1], meta[1])] = meta[2]
            continue
        if line.startswith(('#', ';', '//')):
            continue
        if re.fullmatch(r'\[[^\]]+\]', line):
            section = line[1:-1].lower()
            continue
        if section == 'argument':
            continue
        recognized += 1
        try:
            if section == 'mitm' and line.lower().startswith('hostname='):
                obj['mitm'] = {'hostnames': [h.strip() for h in line.split('=', 1)[1].split(',') if h.strip()]}
            elif section == 'rule':
                add('rules', rule(line))
            elif section in {'rewrite', 'script'}:
                condition = re.match(r'^(request|response) if \$\{url\} ~= (.*)$', line)
                assert condition, 'Unsupported trigger or condition'
                phase, tail = condition.groups()
                match, tail = regexp(tail)
                alias = None
                bound = re.match(r'^as (\w+)\s+(.*)$', tail)
                if bound:
                    alias, tail = bound.groups()
                assert tail.startswith('then '), 'Additional conditions require an explicit adapter'
                tail = tail[5:]
                call = re.match(r'^([\w.]+)\((.*)\)(?: with (.*))?$', tail)
                assert call, 'Unsupported action pipeline or syntax'
                action, arguments, options = call.groups()
                parts = split_top(arguments)
                if action == 'script':
                    assert len(parts) <= 2, 'Unexpected script argument count'
                    url = literal(parts[0])
                    target = dependency(url)
                    if len(parts) == 2:
                        target = argument_adapter(target, argument(parts[1], values))
                    settings = {}
                    for option in split_top(options or ''):
                        if not option:
                            continue
                        key, value = option.split('=', 1)
                        settings[key.strip()] = argument(value, values)
                    assert not set(settings) - {'tag','timeout','requires_body','binary_body_mode','enable','img_url'}, 'Unsupported script option'
                    fields = {'name': settings.get('tag', name+' / '+str(number)), 'match': match,
                              'script_url': target, 'body_required': bool(settings.get('requires_body', False)),
                              'update_interval': 86400}
                    if 'timeout' in settings:
                        fields['timeout'] = min(600, max(1, int(settings['timeout'])))
                    if settings.get('binary_body_mode'):
                        fields.update(binary_body=True, max_size=16777216)
                    if not settings.get('enable', True):
                        fields['disabled'] = True
                    add('scriptings', {'http_'+phase: fields})
                elif action in {'response.json.jq', 'request.json.jq'}:
                    jq(phase, match, literal(arguments))
                elif action in {'response.json.jq_file', 'request.json.jq_file'}:
                    jq(phase, match, resource(literal(arguments)).decode('utf-8-sig'))
                elif action.endswith('.json.delete'):
                    paths = literal(arguments)
                    if not isinstance(paths, list):
                        paths = [paths]
                    jq(phase, match, 'delpaths('+json.dumps([keypath(p) for p in paths], ensure_ascii=False)+')')
                elif action.endswith('.json.replace'):
                    assert len(parts) == 2
                    paths, replacements = map(literal, parts)
                    if not isinstance(paths, list):
                        paths, replacements = [paths], [replacements]
                    assert isinstance(replacements, list) and len(paths) == len(replacements)
                    expressions = ['setpath('+json.dumps(keypath(p), ensure_ascii=False)+'; '+json.dumps(v, ensure_ascii=False)+')' for p,v in zip(paths,replacements)]
                    jq(phase, match, ' | '.join(expressions))
                elif action in {'reject', 'reject_dict', 'reject_array', 'reject_img'}:
                    args = [literal(p) for p in parts]
                    status = args[0]
                    assert isinstance(status, int) and 100 <= status <= 599
                    if action == 'reject_img':
                        url = binary_local(base64.b64decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),status,{'Content-Type':'image/gif'})
                        add('scriptings', {'http_request': {'name':name+' / 透明图片','match':match,'script_url':url,'body_required':False}})
                    else:
                        body = '{}' if action == 'reject_dict' else '[]' if action == 'reject_array' else args[1] if len(args) == 2 else ''
                        mime = 'application/json' if action != 'reject' else 'text/plain'
                        add('map_locals', {'match':match,'status_code':status,'body':body,'headers':{'Content-Type':mime+'; charset=utf-8'}})
                elif action in {'response.body.mock', 'response.body.mock_file'}:
                    args = [literal(p) for p in parts]
                    mime, body = args[:2]
                    status = args[2] if len(args) > 2 else 200
                    encoded = args[3] if len(args) > 3 else False
                    headers = {'Content-Type':{'text':'text/plain','json':'application/json','plain':'text/plain'}.get(mime,mime if '/' in mime else 'image/'+mime)}
                    data = resource(body) if action.endswith('_file') else body.encode()
                    if encoded:
                        data = base64.b64decode(data, validate=True)
                    if encoded or action.endswith('_file'):
                        target = binary_local(data,status,headers)
                        add('scriptings', {'http_request':{'name':name+' / 原生响应','match':match,'script_url':target,'body_required':False}})
                    else:
                        add('map_locals', {'match':match,'status_code':status,'body':body,'headers':headers})
                elif action == 'response.header.add':
                    key, value = map(literal, parts)
                    add('header_rewrites', {'add':{'match':match,'name':key,'value':value,'type':'response'}})
                elif action == 'redirect':
                    status, location = map(literal, parts)
                    if alias:
                        location = re.sub(r'\$\{'+re.escape(alias)+r'\.(\d+)\}', r'$\1', location)
                    location = re.sub(r'\$\{([^}]+)\}', lambda m: str(values[m[1]]) if m[1] in values else m[0], location)
                    assert '${' not in location, 'Unresolved redirect template'
                    add('url_rewrites', {'match':match,'location':location,'status_code':status})
                elif action in {'response.body.replace','request.body.replace'}:
                    find, rest = regexp(arguments)
                    assert rest.startswith(',')
                    add('body_rewrites', {phase+'_regex':{'match':match,'find':find,'replace':literal(rest[1:])}})
                else:
                    raise ValueError('Unsupported action '+action)
            else:
                raise ValueError('Unsupported section '+section)
            converted += 1
        except (ValueError, TypeError, KeyError, AssertionError) as exc:
            notes.append({'kind':'unsupported_lpx_operation','line':number,'source':line,'reason':str(exc)})
    # Loon applies all matching Rewrite lines in sequence. Coalesce identical
    # URL selectors so Egern cannot choose just one of the source operations.
    for (phase, match), expressions in grouped.items():
        expression = ' | '.join('('+value+')' for value in expressions)
        add('body_rewrites', {phase+'_jq': {'match':match,'filter':expression}})
    notes.append({'kind':'lpx_parse_totals','recognized_lines':recognized,'converted_lines':converted,
                  'unsupported_lines':recognized-converted,'argument_defaults':values,
                  'runtime_verified':False})
    return obj, notes
