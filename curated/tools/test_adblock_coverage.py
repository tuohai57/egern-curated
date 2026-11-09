"""Independent domain regressions, business negatives and ownership subtraction."""
from pathlib import Path
import json, sys
ROOT=Path(__file__).resolve().parents[2]
vendor=ROOT.parent/'.vendor'
if vendor.exists():sys.path.insert(0,str(vendor))
from adblock_model import DomainRouter


def main():
    model=DomainRouter(ROOT)
    data=json.loads((ROOT/'curated/native-full/adblock-regression-fixtures.json').read_text(encoding='utf-8'))
    rows=[]
    for expectation,kind in [(True,'block'),(False,'allow')]:
        for host in data[kind]:
            actual=model.blocked(host)
            rows.append({'host':host,'expected_reject':expectation,'actual_reject':actual,'passed':actual==expectation,'kind':'independent_domain'})
    for entry in data['synthetic_residual_checks']:
        actual=model.blocked(entry['host'])
        rows.append({**entry,'actual_reject':actual,'passed':actual==entry['reject'],'kind':'synthetic_ownership'})
    result={'passed':all(r['passed'] for r in rows),'cases':len(rows),'failures':[r for r in rows if not r['passed']],
            'scope':data['scope'],'results':rows}
    print(json.dumps({k:v for k,v in result.items() if k!='results'},ensure_ascii=False,indent=2))
    return result

if __name__=='__main__':sys.exit(not main()['passed'])
