"""Deterministic native collection composition; originals are never mutated."""
import copy
import json

SECTIONS=('rules','url_rewrites','header_rewrites','body_rewrites','map_locals','scriptings')


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

