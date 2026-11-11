"""Delivered App selectors and routing prerequisites; synthetic URL witnesses."""
from pathlib import Path
from urllib.parse import urlsplit
import argparse, fnmatch, hashlib, json, re, sys

ROOT = Path(__file__).resolve().parents[2]
if (ROOT.parent/'.vendor').is_dir(): sys.path.insert(0, str(ROOT.parent/'.vendor'))
import yaml
from adblock_model import DomainRouter

def main(profile=None):
    stack = ROOT/'curated/module-stack'
    apps = {k: yaml.safe_load((stack/'modules'/v).read_bytes()) for k, v in
            {'航旅纵横': 'user-007.yaml', '淘宝闪购': 'native-084.yaml', '滴滴出行': 'native-021.yaml', '网易云音乐':'native-013.yaml'}.items()}
    aggregate = yaml.safe_load((stack/'modules/000-adblock-merged-complete.yaml').read_bytes())
    cases = []
    def check(ok, name):
        assert ok, name
        cases.append(name)
    def handlers(obj, url):
        found = []
        for section in ('map_locals', 'body_rewrites', 'scriptings'):
            for entry in obj.get(section, []):
                phase, f = (section, entry) if section == 'map_locals' else next(iter(entry.items()))
                if not f.get('disabled') and f.get('match') and re.search(f['match'], url): found.append((phase, f))
        return found
    witnesses = []
    for host in ('home', 'startup', 'umestartup', 'discardrp', 'umehome', 'ume1', 'sns', 'event'):
        for suffix in ('', '?rpid=1000019'):
            witnesses.append(('航旅纵横', f'https://{host}.umetrip.com/gateway/api/umetrip/native'+suffix, 'http_response'))
    witnesses += [('航旅纵横', 'https://oss.umetrip.com/fs/advert/polite/ad.jpg', 'http_request')]
    for path in ('h5/mtop.alsc.eleme.home.trigger.respond', 'h5/mtop.alsc.eleme.home.trigger.respond/1.0/?data=test',
                 'gw/mtop.alsc.wamai.store.detail.miniapp.popup/1.0/?data=test'):
        witnesses.append(('淘宝闪购', 'https://waimai-guide.ele.me/'+path, 'map_locals'))
    witnesses += [('淘宝闪购', 'https://fuss10.elemecdn.com/a/b/c/ad.mp4?token=example', 'http_request'),
                  ('滴滴出行', 'https://res.xiaojukeji.com/resapi/activity/mget?q=1', 'http_response'),
                  ('滴滴出行', 'https://res.xiaojukeji.com/resapi/activity/mget', 'map_locals')]
    for path in ('batch','link/home/framework/tab','homepage/block/page','link/page/discovery/resource/show',
                 'link/page/rcmd/resource/show','link/page/rcmd/block/resource/multi/refresh',
                 'link/position/show/resource','search/default','ocpc/ad/banner'):
        witnesses.append(('网易云音乐','https://interface3.music.163.com/eapi/'+path+'?synthetic=1','http_response'))
    for app, url, expected in witnesses:
        selected = handlers(apps[app], url)
        check(len(selected) == 1 and selected[0][0] == expected, app+' single owner '+url)
        retained = handlers(aggregate, url)
        check(len(retained) == 1 and retained[0] == selected[0], app+' aggregate equivalence '+url)
    normal = [
        ('淘宝闪购', 'https://waimai-guide.ele.me/h5/mtop.alsc.eleme.home.trigger.respondExtra/1.0/'),
        ('淘宝闪购', 'https://waimai-guide.ele.me/h5/mtop.alsc.eleme.order.detail/1.0/'),
        ('淘宝闪购', 'https://waimai-guide.ele.me/h5/mtop.alsc.eleme.shop.detail/1.0/'),
        ('淘宝闪购', 'https://waimai-guide.ele.me/h5/mtop.alsc.eleme.payment/1.0/'),
        ('淘宝闪购', 'https://waimai-guide.ele.me/gw/mtop.alsc.wamai.store.detail.miniapp.popupExtra/1.0/'),
        ('淘宝闪购', 'https://fuss10.elemecdn.com/a/b/shop.jpg?x-oss-process=image/resize,w_300'),
        ('航旅纵横', 'https://home.umetrip.com/gateway/api/umetrip/nativeExtra'),
        ('航旅纵横', 'https://home.umetrip.com/gateway/api/umetrip/account'),
        ('滴滴出行', 'https://res.xiaojukeji.com/resapi/activity/mgetExtra?q=1'),
        ('网易云音乐','https://interface3.music.163.com/eapi/song/detail'),
        ('网易云音乐','https://interface3.music.163.com/eapi/link/home/framework/tabExtra'),
    ]
    for app, url in normal: check(not handlers(apps[app], url), 'normal or similar path '+url)
    source = json.loads((stack/'umetrip-eleme-review.json').read_bytes())
    archive = (ROOT/source['source_archive']).read_bytes()
    check(hashlib.sha256(archive).hexdigest() == source['eleme_in_app_source']['sha256'], 'source archive exact hash')
    check(all(term in archive.decode() for term in ['mtop\\.alsc\\.eleme', 'mtop\\.alsc\\.wamai']), 'source endpoint evidence')
    if profile:
        config = yaml.safe_load(Path(profile).read_bytes())
        model = DomainRouter(ROOT, config)
        for app, url, expected in witnesses:
            selected = [(name, phase, f) for name, obj in model.active for phase, f in handlers(obj, url)]
            check(len(selected) == 1 and selected[0][1] == expected, 'active profile owner '+url)
            host = urlsplit(url).hostname
            mitm = config['mitm']['hostnames']
            check(any(fnmatch.fnmatchcase(host, p) for p in mitm['includes']) and
                  not any(fnmatch.fnmatchcase(host, p) for p in mitm['excludes']), 'active MITM '+url)
            check(model.route(url, protocol='tcp')['policy'] not in {'REJECT', '去广告'}, 'no routing rejection '+url)
            dns = next((f['value'] for e in config['dns']['forward'] for k, f in e.items() if model.matches(k, f, url, host)), None)
            check(dns != 'reject', 'no DNS rejection '+url)
    print(json.dumps({'passed': True, 'checks': len(cases), 'profile': bool(profile),
                      'scope': 'Synthetic URLs; device behavior and real API responses unverified.'}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--profile'); args = parser.parse_args(); main(args.profile)
