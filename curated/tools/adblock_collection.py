"""Deterministic native collection composition; originals are never mutated."""
import copy
import json
import re

SECTIONS=('rules','url_rewrites','header_rewrites','body_rewrites','map_locals','scriptings')

JQ_GUARD_MARKER = '# Egern: preserve input on failed, empty or multi-result transform'


def guarded_jq(expression):
    """Retain every successful single JSON result; fail open on transform failure."""
    if expression.startswith(JQ_GUARD_MARKER):
        return expression
    return (JQ_GUARD_MARKER + '\n'
            '. as $__egern_original_json\n'
            '| try (([ (\n' + expression + '\n) ]) as $__egern_results\n'
            '       | if ($__egern_results | length) == 1\n'
            '         then $__egern_results[0] else $__egern_original_json end)\n'
            '  catch $__egern_original_json')


def _safe_union_branch(pattern):
    # Numeric and named capture backreferences can change meaning after union.
    if re.search(r'\\[1-9]|\\k[<{]|\(\?P[<=]|\(\?<[A-Za-z_]', pattern):
        return None
    if pattern.startswith('(?i)'):
        return '(?i:' + pattern[4:] + ')'
    return '(?:' + pattern + ')'


def _url_host_scope(pattern):
    normalized = pattern.replace(r'\/', '/')
    found = re.match(r'^(?:\(\?i\))?\^https?\??://([^/]+)', normalized)
    return found[1] if found else None


def normalize_processing(obj):
    """Add shared robustness without changing upstream archives or script bytes.

    Only consecutive identical local replies/script bindings are consolidated:
    moving a later matcher across a different reply could change priority.
    """
    output = copy.deepcopy(obj)
    changes = []
    for section in ('map_locals', 'scriptings'):
        entries = output.get(section)
        if not entries:
            continue
        grouped = []
        previous_key = None
        previous_fields = None
        previous_patterns = []
        for entry in entries:
            phase, fields = (section, entry) if section == 'map_locals' else next(iter(entry.items()))
            branch = _safe_union_branch(fields.get('match', ''))
            payload = {key: value for key, value in fields.items() if key not in {'match', 'name'}}
            # Keep distinct hostname scopes separate so later finance/host
            # protections can remove one host without dropping unrelated URLs.
            scope = _url_host_scope(fields.get('match', ''))
            key = (phase, scope, json.dumps(payload, sort_keys=True, ensure_ascii=False))
            eligible = not fields.get('disabled') and scope and branch and fields.get('match') and phase in {'map_locals', 'http_request', 'http_response'}
            if eligible and key == previous_key:
                previous_patterns.append(branch)
                previous_fields['match'] = '|'.join(previous_patterns)
                changes.append({'kind': 'consecutive_identical_handlers_unified',
                                'section': section, 'phase': phase,
                                'source_match': fields['match'],
                                'source_name': fields.get('name'),
                                'upstream_script_bytes_changed': False})
            else:
                grouped.append(entry)
                previous_key = key if eligible else None
                previous_fields = fields
                previous_patterns = [branch] if eligible else []
        output[section] = grouped
    for entry in output.get('body_rewrites', []):
        phase, fields = next(iter(entry.items()))
        if phase not in {'request_jq', 'response_jq'} or fields.get('disabled'):
            continue
        original = fields['filter']
        fields['filter'] = guarded_jq(original)
        if fields['filter'] != original:
            changes.append({'kind': 'jq_preserve_input_on_transform_failure',
                            'phase': phase, 'match': fields['match'],
                            'successful_single_result_preserved': True})
    return output, changes


def compose_jq_operations(entries):
    """Preserve same-selector JSON operations in source order in one handler."""
    output=[];seen={};changes=[]
    for original in entries:
        entry=copy.deepcopy(original);phase,fields=next(iter(entry.items()))
        if phase not in {'request_jq','response_jq'} or fields.get('disabled'):
            output.append(entry);continue
        key=(phase,fields['match'])
        if key in seen:
            previous=seen[key]
            previous['filter']='(\n'+previous['filter']+'\n) | (\n'+fields['filter']+'\n)'
            changes.append({'kind':'same_app_same_selector_jq_composed','phase':phase,'match':fields['match'],'source_filters_preserved':True})
        else:
            seen[key]=fields;output.append(entry)
    return output,changes


class Collection:
    def __init__(self, obj):
        self.obj=copy.deepcopy(obj)
        self.changes=[]
        self.seen={section:{} for section in SECTIONS}
        self.processing={}
        for section in SECTIONS:self.obj[section]=[]

    def add(self, owner, section, original):
        item=copy.deepcopy(original)
        if section in {'rules','scriptings','body_rewrites','header_rewrites'}:
            phase,fields=next(iter(item.items()))
        else:phase,fields=section,item
        if fields.get('disabled'):return
        # Do not include mutable names in functional duplicate detection.
        payload={key:value for key,value in fields.items() if key not in {'name','update_interval'}}
        if section=='rules':
            selector={key:value for key,value in payload.items() if key not in {'policy','no_resolve'}}
            exact=(phase,json.dumps(selector,sort_keys=True,ensure_ascii=False))
        else:exact=(phase,json.dumps(payload,sort_keys=True,ensure_ascii=False))
        previous=self.seen[section].get(exact)
        if previous is not None:
            kind='exact_duplicate_omitted'
            if section=='rules' and previous[1].get('policy')!=fields.get('policy'):
                kind='exact_selector_policy_conflict_first_owner'
            self.changes.append({'kind':kind,'section':section,'first':previous[0],'second':owner,'match':fields.get('match')})
            return
        if section in {'body_rewrites','scriptings'}:
            key=(section,phase,fields.get('match'))
            previous=self.processing.get(key)
            if previous:
                old_owner,old_fields=previous
                if old_owner==owner and phase in {'request_jq','response_jq'}:
                    # Crucially mutate the object already stored in output,
                    # not an input object that was deep-copied earlier.
                    old_fields['filter']='(\n'+old_fields['filter']+'\n) | (\n'+fields['filter']+'\n)'
                    self.changes.append({'kind':'same_owner_jq_composed_in_output','owner':owner,'match':fields['match']})
                else:
                    self.changes.append({'kind':'same_selector_processing_first_owner','section':section,'phase':phase,'first':old_owner,'second':owner,'match':fields.get('match')})
                return
            self.processing[key]=(owner,fields)
        self.seen[section][exact]=(owner,fields)
        self.obj[section].append(item)

    def ingest(self, owner, obj):
        for section in SECTIONS:
            for entry in obj.get(section,[]):self.add(owner,section,entry)
        hosts=obj.get('mitm',{}).get('hostnames',[])
        if isinstance(hosts,dict):hosts=hosts.get('includes',[])
        self.obj.setdefault('mitm',{}).setdefault('hostnames',[])
        for host in hosts:
            if host.startswith(('-','!')):continue
            if host not in self.obj['mitm']['hostnames']:self.obj['mitm']['hostnames'].append(host)

