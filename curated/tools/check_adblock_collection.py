"""Check the actual aggregate, source hashes, jq and local script dependencies."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import fnmatch,hashlib,json,re,shutil,subprocess,sys,tempfile
ROOT=Path(__file__).resolve().parents[2]
if (ROOT.parent/'.vendor').exists():sys.path.insert(0,str(ROOT.parent/'.vendor'))
import yaml

def main():
    manifest=json.loads((ROOT/'curated/module-stack/merged-manifest.json').read_text(encoding='utf-8'))
    path=ROOT/manifest['repository_path'];raw=path.read_bytes()
    assert hashlib.sha256(raw).hexdigest()==manifest['sha256']
    obj=yaml.safe_load(raw);expressions=set();scripts=set();patterns=set()
    for section,count in manifest['counts'].items():
        assert len(obj.get(section,[]))==count,section
        for entry in obj.get(section,[]):
            fields=entry if section in {'map_locals','url_rewrites'} else next(iter(entry.values()))
            assert not fields.get('disabled'),'Disabled operation leaked into aggregate'
            if fields.get('match') and section!='rules':patterns.add(fields['match'])
            if fields.get('filter'):expressions.add(fields['filter'])
            if fields.get('script_url'):scripts.add(fields['script_url'])
    for pattern in patterns:re.compile(pattern)
    for source in manifest['included_sources']:
        relative=source['url'].split('egern-curated/main/',1)[1]
        assert hashlib.sha256((ROOT/relative).read_bytes()).hexdigest()==source['sha256'],relative
    assert len(set(obj['mitm']['hostnames']))==manifest['mitm_hosts']
    finance=json.loads((ROOT/'curated/managed-protection.json').read_text(encoding='utf-8'))['finance_roots']
    for host in obj['mitm']['hostnames']:
        assert not any(fnmatch.fnmatchcase(host,root) or fnmatch.fnmatchcase(host,'*.'+root)
                       or fnmatch.fnmatchcase(root,host) or fnmatch.fnmatchcase('probe.'+root,host)
                       for root in finance),('Financial hostname in aggregate',host)
    jq=shutil.which('jq') or str(ROOT.parent/'tools/jq.exe')
    with tempfile.TemporaryDirectory(prefix='egern-collection-') as directory:
        paths=[]
        for i,expression in enumerate(sorted(expressions)):
            p=Path(directory)/(str(i)+'.jq');p.write_text(expression,encoding='utf-8');paths.append(p)
        def compile_jq(p):
            process=subprocess.run([jq,'-n','-f',str(p)],capture_output=True,timeout=30)
            assert process.returncode in (0,5),(p.name,process.stderr.decode(errors='replace')[:300])
        with ThreadPoolExecutor(max_workers=5) as pool:list(pool.map(compile_jq,paths))
    node=shutil.which('node')
    if node is None:
        candidate=Path('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe')
        if candidate.exists():node=str(candidate)
    assert node,'Node unavailable'
    def check_js(url):
        assert url.startswith('https://raw.githubusercontent.com/tuohai57/egern-curated/main/'),url
        p=ROOT/url.split('egern-curated/main/',1)[1];assert p.is_file(),url
        process=subprocess.run([node,'--check',str(p)],capture_output=True,timeout=30)
        assert process.returncode==0,(p.name,process.stderr.decode(errors='replace')[:300])
    with ThreadPoolExecutor(max_workers=5) as pool:list(pool.map(check_js,sorted(scripts)))
    result={'passed':True,'aggregate_sha256':manifest['sha256'],'included_sources':len(manifest['included_sources']),
            'counts':manifest['counts'],'mitm_hosts':manifest['mitm_hosts'],'unique_regexes':len(patterns),
            'jq_compiled':len(expressions),'javascript_syntax_checked':len(scripts),'upstream_javascript_executed':False,
            'runtime_verified':False,'meaning':'Source integrity and syntax; arbitrary regex overlaps and actual iOS behavior are not proven.'}
    (ROOT/'curated/module-stack/collection-checks.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':main()
