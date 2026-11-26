/* Execute updated compatibility payloads with synthetic responses and no real network. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const stack=JSON.parse(fs.readFileSync(path.join(root,'curated/module-stack/manifest.json')));
const payload=rel=>fs.readFileSync(path.join(root,rel),'utf8');
function script(moduleFile,phase,index=0) {
 const row=stack.modules.find(r=>r.repository_path.endsWith('/'+moduleFile));assert(row);
 const text=payload(row.repository_path);const block=text.split(/\n- /).filter(s=>s.startsWith(phase+':'))[index];assert(block);
 const url=/script_url: (\S+)/.exec(block)[1];return payload(url.split('/main/')[1]);
}
async function run(source,url,body,hasResponse=true,argument='Notify=关闭通知') {
 let calls=0,completed=false,logs=[];
 let resolve,reject;const result=new Promise((a,b)=>{resolve=a;reject=b;});
 const deadline=setTimeout(()=>reject(Error('Completion timeout: '+url)),2000);
 const context={URL,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Buffer,atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),setTimeout,clearTimeout,
  console:{log:(...v)=>logs.push(v.join(' ')),warn(){},error(){}},$request:{url,method:'GET',headers:{'User-Agent':'Egern'}},
  $environment:{'surge-version':'5.20.0','surge-build':'2806',system:'iOS'},$argument:argument,
  $persistentStore:{read:()=>null,write:()=>true},$notification:{post(){}},$utils:{ungzip: b=>b},
  $done:v=>{if(!completed){completed=true;resolve(v);}},
  $httpClient:{get:(opts,cb)=>{calls++;cb(null,{status:200,headers:{}},body);},post:()=>{throw Error('Unexpected POST');}}};
 if(hasResponse)context.$response={status:200,headers:{'Content-Type':'application/json','bili-status-code':'0'},body};
 try {vm.runInNewContext(source,context,{timeout:2000});const out=await result;return {out,calls,logs};}
 finally{clearTimeout(deadline);}
}
(async()=>{
 let checks=0;const ok=v=>{assert(v);checks++;};
 // Every existing data card must survive an ordinary feed response.
 const weibo=script('user-026.yaml','http_response');
 const normal=JSON.stringify({ok:1,data:{cards:[{card_type:9,mblog:{id:'ordinary',text:'normal content'}}]}});
 const feed=await run(weibo,'https://api.weibo.cn/2/statuses/container_timeline?count=20',normal);
 ok(JSON.stringify(feed.out).includes('ordinary'));ok(feed.calls===0);
 // The settings endpoint must return an actual local HTTP response.
 const settings=await run(script('user-026.yaml','http_request'),'https://api.weibo.cn/__qx_weibo_settings__/', '',false);
 ok(settings.out.response && settings.out.response.status===200);ok(settings.calls===0);
 const sparkle=await run(script('native-014.yaml','http_response',1),'https://app.bilibili.com/x/v2/feed/index?count=20',JSON.stringify({code:0,data:{items:[{card_goto:'ad_av',card_type:'cm_v2'},{card_goto:'av',card_type:'small_cover_v2',title:'ordinary video'}]}}),true,undefined);
 ok(JSON.stringify(sparkle.out).includes('ordinary video'));ok(!JSON.stringify(sparkle.out).includes('ad_av'));ok(sparkle.calls===0);
 // Script Hub retains rule conversion and rewrite conversion for an existing target.
 const rule=await run(script('user-120.yaml','http_request',2),'https://script.hub/file/_start_/https://fixture.invalid/source.list/_end_/rules.list?type=rule-set&target=surge-rule-set','DOMAIN,example.invalid,DIRECT\nIP-CIDR,192.0.2.0/24,DIRECT,no-resolve',false);
 ok(JSON.stringify(rule.out).includes('example.invalid'));ok(rule.calls===1);
 const rewrite=await run(script('user-120.yaml','http_request',1),'https://script.hub/file/_start_/https://fixture.invalid/source.conf/_end_/rules.sgmodule?type=qx-rewrite&target=surge-module','hostname = ads.example.invalid\n^https://ads\\.example\\.invalid/banner url reject',false);
 ok(JSON.stringify(rewrite.out).includes('ads'));ok(rewrite.calls===1);
 console.log(JSON.stringify({passed:true,checks,real_network_requests:0,device_verified:false}));
})().catch(e=>{console.error(e);process.exit(1);});
