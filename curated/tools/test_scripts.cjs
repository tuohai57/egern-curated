// Execute reviewed scripts in an isolated JavaScript context with no network.
const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),path=require('path');
const root=path.resolve(__dirname,"../.."),manifest=JSON.parse(fs.readFileSync(path.join(root,"curated/managed-manifest.json"),"utf8"));
let results=[];
function check(name,condition){results.push({name,passed:!!condition});}
function execute(dep,url,body,status=200){
 const outputs=[];const source=fs.readFileSync(path.join(root,dep.repository_path),'utf8');
 const store={read:()=>null,write:()=>true};
 const sandbox={$request:{url,method:'GET',headers:{},body:'{}'},$response:{status,statusCode:status,body,headers:{}},
  $done:r=>outputs.push(r),$persistentStore:store,$prefs:{valueForKey:()=>null,setValueForKey:()=>true},
  $notification:{post:()=>{}},$notify:()=>{},$environment:{'surge-version':'5.0'},console:{log:()=>{}},
  TextEncoder,TextDecoder,URL,URLSearchParams,Buffer};
 vm.runInNewContext(source,sandbox,{timeout:1500});
 if(outputs.length!==1)throw Error('completion count '+outputs.length);
 return outputs[0].body===undefined?body:outputs[0].body;
}
for(const dep of manifest.dependencies){
 const source=fs.readFileSync(path.join(root,dep.repository_path),'utf8');
 check('hash '+dep.upstream_url,crypto.createHash('sha256').update(source).digest('hex')===dep.sha256);
 try{new vm.Script(source);check('syntax '+dep.upstream_url,true);}catch(e){check('syntax '+dep.upstream_url,false);}
 if(!dep.binary){
  for(const body of ['', 'not-json', '<html>error</html>', 'null','42','{"code":-503,"message":"unavailable"}', '{"error":{"message":"unauthorized"}}']){
   try{check('error preservation '+dep.upstream_url+' '+body,execute(dep,'https://unmatched.example.invalid/',body)===body);}catch(e){check('error preservation '+dep.upstream_url+' '+body,false);}
  }
  for(const status of [401,403,429,500]){
   try{check('HTTP '+status+' preservation '+dep.upstream_url,execute(dep,'https://unmatched.example.invalid/','{"data":[]}',status)==='{"data":[]}');}catch(e){check('HTTP '+status+' preservation '+dep.upstream_url,false);}
  }
 }
}
function fixture(tail,url,input,expected,name){
 const dep=manifest.dependencies.find(d=>d.upstream_url.endsWith(tail));
 try{const actual=JSON.parse(execute(dep,url,JSON.stringify(input)));check(name,JSON.stringify(actual)===JSON.stringify(expected));}
 catch(e){check(name,false);}
}
const rewritten='/curated/scripts/source/rewritten-apps.js';
fixture(rewritten,'https://ad.12306.cn/ad/ser/getAdList?test=1',
 {materialsList:[{id:'ad'}],advertParam:{id:2},countdown:5,duration:'5',normal:'preserve'},
 {countdown:0,duration:'0',normal:'preserve'},'Independent 12306 ad material and known countdown removed; envelope preserved');
fixture(rewritten,'https://appconf.mail.163.com/mailmaster/api/config/function.do',
 {data:{config:[{functionName:'Function-AD'},{functionName:'Mail',result:{tools:[{name:'ordinary'}]}}]},success:true},
 {data:{config:[{functionName:'Mail',result:{tools:[{name:'ordinary'}]}}]},success:true},'Independent MailMaster ad function removed; ordinary mail/tools preserved');
fixture(rewritten,'https://api.xiaoheihe.cn/bbs/app/feeds/news?test=1',
 {result:{links:[{content_type:27,id:'ad'},{content_type:1,id:'news'},null]},cursor:'keep'},
 {result:{links:[{content_type:1,id:'news'},null]},cursor:'keep'},'Independent Heybox inserted ad removed; news/null/cursor preserved');
fixture(rewritten,'https://api.xiaoheihe.cn/account/get_ads_info_v2',
 {result:{ads:[{id:1}],countdown:6,account:'preserve'},status:'ok'},
 {result:{ads:[],countdown:0,account:'preserve'},status:'ok'},'Independent Heybox known splash payload and countdown cleared');
fixture(rewritten,'https://api.meiyan.com/operation/get_config.json',
 {response:{bubble:{id:1},time_limit:{id:2},camera:{mode:'normal'},person_center:{settings:true},function_pop:{meiyan_style:{is_pop:true,other:'keep'}}}},
 {response:{camera:{mode:'normal'},person_center:{settings:true},function_pop:{meiyan_style:{is_pop:false,other:'keep'}}}},'Independent Meiyan promotions removed; camera/settings preserved');
fixture(rewritten,'https://api.meiyan.com/operation/home.json',
 {response:{items:[{is_ad:true,id:'ad'},{id:'camera',type:'camera'}],normal:5}},
 {response:{items:[{id:'camera',type:'camera'}],normal:5}},'Independent Meiyan explicit ad item removed; camera item preserved');
fixture(rewritten,'https://acs.m.taobao.com/gw/mtop.damai.wireless.user.my.content.get/1.0/',
 {data:{banner:[{id:1}],orders:[{id:2}],performFilmVip:{userProfitList:[1]},tickets:[3]},ret:['SUCCESS::ok']},
 {data:{orders:[{id:2}],performFilmVip:{userProfitList:[1]},tickets:[3]},ret:['SUCCESS::ok']},'Independent Damai banner removed; tickets/orders/benefits retained');
fixture(rewritten,'https://acs.m.taobao.com/gw/mtop.damai.wireless.mypage.feed/1.0/',
 {data:{feedCard:[{is_ad:true,id:'ad'},{id:'event',type:'event'}]},ret:['SUCCESS::ok']},
 {data:{feedCard:[{id:'event',type:'event'}]},ret:['SUCCESS::ok']},'Independent Damai filters explicit ads and keeps ordinary event card');
fixture(rewritten,'https://acs.m.taobao.com/gw/mtop.damai.wireless.home.welcome/1.0/',
 {data:{splashList:[{id:1}],duration:5,other:'keep'},ret:['SUCCESS::ok']},
 {data:{splashList:[],duration:0,other:'keep'},ret:['SUCCESS::ok']},'Independent Damai known splash list/duration cleared without fabricated response');
fixture(rewritten,'https://mp.weixin.qq.com/mp/getappmsgad?test=1',
 {advertisement_num:1,advertisement_info:[{id:1}],base_resp:{ret:0},article:{id:2}},
 {advertisement_num:0,advertisement_info:[],base_resp:{ret:0},article:{id:2}},'Independent WeChat article ads removed; business envelope retained');
fixture(rewritten,'https://api.pinduoduo.com/api/alexa/homepage/hub?test=1',
 {result:{dy_module:{irregular_banner_dy:{id:1},normal:{id:2}},module_order:[{module_name:'ad_module'},{module_name:'goods'}]},success:true},
 {result:{dy_module:{normal:{id:2}},module_order:[{module_name:'goods'}]},success:true},'Independent PDD inserted home ad removed; goods/normal modules preserved');
{
 const dep=manifest.dependencies.find(d=>d.upstream_url.endsWith(rewritten));
 const unknown='{ "newSchema": {"camera":1}, "data":null }';
 const paths=['https://api.xiaoheihe.cn/bbs/app/feeds/newsExtra','https://api.meiyan.com/operation/home_extra.json',
  'https://acs.m.taobao.com/gw/mtop.damai.wireless.user.my.content.getExtra/1.0/',
  'https://mp.weixin.qq.com/pay/getappmsgad','https://ad.12306.cn/ad/ser/getAdListExtra'];
 for(const url of paths){
  try{check('Independent negative path '+url,execute(dep,url,'{"advertisement_num":1,"materialsList":[1]}')==='{"advertisement_num":1,"materialsList":[1]}');}catch(e){check('Independent negative path '+url,false);}
 }
 for(const url of ['https://api.meiyan.com/operation/home.json','https://acs.m.taobao.com/gw/mtop.damai.wireless.home.welcome/1.0/']){
  try{check('Independent unknown schema unchanged '+url,execute(dep,url,unknown)===unknown);}catch(e){check('Independent unknown schema unchanged '+url,false);}
 }
 const failedLogin='{"data":{"banner":[1],"splashList":[1]},"ret":["FAIL_SYS_SESSION_EXPIRED::login"]}';
 try{check('Independent Damai login error preserved',execute(dep,'https://acs.m.taobao.com/gw/mtop.damai.wireless.home.welcome/1.0/',failedLogin)===failedLogin);}catch(e){check('Independent Damai login error preserved',false);}
}
fixture('/coolapk.js','https://api.coolapk.com/v6/main/dataList?test=1',
 {data:[{id:1,entityTemplate:'sponsorCard'},{id:2,entityTemplate:'feed',title:'正常帖子'}],cursor:'unchanged'},
 {data:[{id:2,entityTemplate:'feed',title:'正常帖子'}],cursor:'unchanged'},'Coolapk inserted sponsor removed; ordinary post/cursor preserved');
fixture('/xiaohongshu.js','https://edith.xiaohongshu.com/api/sns/v6/homefeed?test=1',
 {data:[{id:'ad',ads_info:{}},{id:'post',title:'正常笔记'}],success:true},
 {data:[{id:'post',title:'正常笔记'}],success:true},'XHS homefeed sponsored card removed; ordinary note preserved');
fixture('/zhihu.js','https://api.zhihu.com/topstory/hot-lists/total?test=1',
 {data:[{id:1,ad:{}},{id:2,title:'正常热榜'}],paging:{next:'next'}},
 {data:[{id:2,title:'正常热榜'}],paging:{next:'next'}},'Zhihu hot feed ad removed; normal item and paging preserved');
fixture('/goofish.js','https://acs.m.goofish.com/gw/mtop.taobao.idle.local.home/1.0/',
 {data:{sections:[{data:{bizType:'AD'}},{data:{bizType:'ITEM'},id:2}]},ret:['SUCCESS']},
 {data:{sections:[{data:{bizType:'ITEM'},id:2}]},ret:['SUCCESS']},'Goofish local inserted ad removed; normal listing preserved');
fixture('/jingdong.js','https://api.m.jd.com/client.action?functionId=start',
 {showTimesDaily:5,images:[{url:'splash'}],normal:'preserve'},
 {showTimesDaily:0,images:[],normal:'preserve'},'JD splash display count reset; ordinary data preserved');
fixture('/bilibili.helper.v2.js','https://app.bilibili.com/x/v2/splash/show?test=1',
 {data:{show:[{id:1}],max_time:5,list:[{duration:5,normal:true}]}},
 {data:{max_time:0,min_interval:undefined,list:[{duration:0,normal:true,enable_pre_download:false,end_time:2209046399,begin_time:2208960000}]}},'Bilibili splash duration reset; ordinary per-item fields preserved');
{
 const dep=manifest.dependencies.find(d=>d.upstream_url.endsWith('/weibo_launch.js'));
 const input=JSON.stringify({ads:[{id:1}],show_push_splash_ad:true,normal:'preserve'})+'OK';
 try{const body=execute(dep,'https://sdkapp.uve.weibo.com/interface/sdk/sdkad.php',input);const parsed=JSON.parse(body.replace(/OK$/,''));
  check('Weibo nonstandard JSON+OK splash response remains valid and ads removed',body.endsWith('OK')&&parsed.ads.length===0&&parsed.show_push_splash_ad===false&&parsed.normal==='preserve');
 }catch(e){check('Weibo nonstandard JSON+OK splash response remains valid and ads removed',false);}
}
const failed=results.filter(r=>!r.passed);
const output={scope:'Offline JavaScript syntax, synthetic JSON and error preservation; binary runtime and Egern device acceptance unverified',
 manifest_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'curated/managed-manifest.json'))).digest('hex'),
 cases:results.length,passed:results.length-failed.length,failed:failed.length,results};
fs.writeFileSync(path.join(root,'curated/managed-script-tests.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify({cases:output.cases,passed:output.passed,failures:failed}));
process.exitCode=failed.length?1:0;
