const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const file = path.resolve(__dirname, '../module-stack/scripts/netease-ui-native.js');

(async () => {
  const mod = await import('data:text/javascript;base64,' + fs.readFileSync(file).toString('base64'));
  let checks = 0;
  const clean = (input, endpoint, env, expected) => {
    const value = structuredClone(input);
    const changed = mod.cleanMusicDocument(value, endpoint, env);
    assert.deepEqual(value, expected);
    assert.equal(changed, JSON.stringify(input) !== JSON.stringify(expected)); checks++;
  };
  const tabs = {code:200, data:{commonResourceList:[{title:'漫游'}, {title:'笔记'}, {title:'关注'}, {title:'我的'}, {title:'发现',subCommonResourceList:[{title:'直播'}, {title:'歌单'}]}, {title:'未知'}]}};
  clean(tabs, '/link/home/framework/tab', {MY:'true',DT:true,GZ:'true'}, {code:200,data:{commonResourceList:[{title:'我的'},{title:'发现',subCommonResourceList:[{title:'歌单'}]},{title:'未知'}]}});
  clean({code:403,data:tabs.data}, '/link/home/framework/tab', {MY:true}, {code:403,data:tabs.data});
  for (const value of [null, [], {data:null}, {data:[]}, {data:{commonResourceList:null}}]) clean(value,'/link/home/framework/tab',{MY:true},value);
  const blocks = {code:200,data:{blocks:[{bizCode:'PAGE_RECOMMEND_GREETING'},{bizCode:'PAGE_RECOMMEND_RANK'},{bizCode:'HOMEPAGE_MUSIC_PARTNER'},{bizCode:'UNKNOWN'}], blockCodeOrderList:'["PAGE_RECOMMEND_GREETING","PAGE_RECOMMEND_RANK","HOMEPAGE_MUSIC_PARTNER","UNKNOWN"]'}};
  clean(blocks,'/link/page/rcmd/resource/show',{PRGG:true,HMPR:true},{code:200,data:{blocks:[{bizCode:'PAGE_RECOMMEND_RANK'},{bizCode:'UNKNOWN'}],blockCodeOrderList:'["PAGE_RECOMMEND_RANK","UNKNOWN"]'}});
  clean(blocks,'/link/page/rcmd/resource/show',{},blocks);
  const banner = {code:200,data:{blocks:[{showType:'BANNER',extInfo:{banners:[{typeTitle:'广告'},{typeTitle:'活动'},{typeTitle:'新歌'},{unknown:true}]}}]}};
  clean(banner,'/homepage/block/page',{}, {code:200,data:{blocks:[{showType:'BANNER',extInfo:{banners:[{typeTitle:'新歌'},{unknown:true}]}}]}});
  clean({data:{blocks:[{bizCode:'PAGE_DISCOVERY_BANNER'},{bizCode:'UNKNOWN'}],blockCodeOrderList:'["PAGE_DISCOVERY_BANNER","UNKNOWN"]'}},'/link/page/discovery/resource/show',{}, {data:{blocks:[{bizCode:'UNKNOWN'}],blockCodeOrderList:'["UNKNOWN"]'}});
  const batch = {'/api/ad/get':{code:200,data:{ads:[1]}}, '/api/music-vip-membership/client/vip/info':{code:200,data:{vipLevel:0}}, '/api/song/detail':{code:200,data:{songId:12}}, '/api/comment/feed/inserted/resources':{code:403,data:{reason:'login'}}};
  clean(batch,'/batch',{}, {...batch, '/api/ad/get':{code:200,data:{code:200,ads:{}}}});
  clean({code:200,data:{defaultKeyword:'推广搜索词'}},'/search/default',{},{});
  clean({code:403,message:'login'},'/search/default',{}, {code:403,message:'login'});
  clean({data:{crossPlatformResource:{positionCode:'MyPageBar',promotion:[1]}}},'/link/position/show/resource',{}, {data:{crossPlatformResource:{}}});
  clean({data:{crossPlatformResource:{positionCode:'MusicPlayer',normal:[1]}}},'/link/position/show/resource',{}, {data:{crossPlatformResource:{positionCode:'MusicPlayer',normal:[1]}}});

  // Independent standard AES implementation verifies the public upstream codec.
  const key = Buffer.alloc(16); [1698181731,1801809512,946104675,1751477816].forEach((v,i)=>key.writeUInt32BE(v,i*4));
  const independentEncrypt = bytes => {const c=crypto.createCipheriv('aes-128-ecb',key,null);return Buffer.concat([c.update(bytes),c.final()]);};
  for (const bytes of [Buffer.from('{}'),Buffer.from(JSON.stringify(tabs)),zlib.gzipSync(Buffer.from(JSON.stringify(tabs)))]) {
    const encrypted=independentEncrypt(bytes);
    assert.deepEqual(Buffer.from(mod.encodeMusicBytes(bytes)),encrypted);
    assert.deepEqual(Buffer.from(mod.decodeMusicBytes(encrypted)),bytes); checks+=2;
  }
  const ctx = (input, options={}) => {
    let wire=Buffer.isBuffer(input)?input:Buffer.from(JSON.stringify(input));
    if(options.inner) wire=zlib.gzipSync(wire);
    if(options.encrypted) wire=independentEncrypt(wire);
    const preHttp=wire;
    const compress={gzip:zlib.gzipSync,deflate:zlib.deflateSync,br:zlib.brotliCompressSync};
    if(options.encoding) wire=compress[options.encoding](wire);
    let reads=0;
    return {request:{url:options.url || 'https://interface3.music.163.com/eapi/link/home/framework/tab'},env:{MY:'true',DT:'true',GZ:'true'},response:{status:options.status??200,headers:new Headers({'Content-Encoding':options.encoding||'identity',etag:'old','Content-Length':String(wire.length)}),arrayBuffer:async()=>{assert.equal(++reads,1);const b=options.decoded?preHttp:wire;return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}},compress:{gunzip:async x=>new Uint8Array(zlib.gunzipSync(x)),gzip:async x=>new Uint8Array(zlib.gzipSync(x)),inflate:async x=>new Uint8Array(zlib.inflateSync(x)),unbrotli:async x=>new Uint8Array(zlib.brotliDecompressSync(x))}};
  };
  for(const encoding of [undefined,'gzip','deflate','br']) for(const encrypted of [false,true]) for(const inner of encrypted?[false,true]:[false]) for(const decoded of [false,true]) {
    const out=await mod.default(ctx(tabs,{encoding,encrypted,inner,decoded}));
    assert.ok(out?.body);
    let result=Buffer.from(out.body);
    if(encrypted) result=Buffer.from(mod.decodeMusicBytes(result));
    if(inner) result=zlib.gunzipSync(result);
    assert.deepEqual(JSON.parse(result).data.commonResourceList.map(x=>x.title),['我的','发现','未知']);
    assert.equal(out.headers.has('etag'),false); assert.equal(out.headers.has('content-encoding'),false);checks++;
  }
  for(const encoding of [undefined,'gzip','br']) {
    const out=await mod.default(ctx({code:200,data:{defaultKeyword:'推广搜索词'}},{encoding,encrypted:true,url:'https://interface.music.163.com/eapi/search/default?test=1'}));
    assert.deepEqual(JSON.parse(Buffer.from(mod.decodeMusicBytes(out.body))),{}); checks++;
  }
  for(const input of [Buffer.from('<html>error</html>'),Buffer.alloc(16,5),{code:500,data:tabs.data},{data:{commonResourceList:[{title:'我的'}]}}]) {assert.equal(await mod.default(ctx(input)),undefined);checks++;}
  for(const options of [{status:401},{url:'https://interface3.music.163.com/eapi/song/detail'},{url:'https://interface3.music.163.com/eapi/link/home/framework/tabExtra'}]) {assert.equal(await mod.default(ctx(tabs,options)),undefined);checks++;}
  console.log(JSON.stringify({passed:true,checks,scope:'Synthetic UI schemas, independent AES and native Egern API mocks; no real App response/device validation.'}));
})().catch(error=>{console.error(error);process.exitCode=1;});
