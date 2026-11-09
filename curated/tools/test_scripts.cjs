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
