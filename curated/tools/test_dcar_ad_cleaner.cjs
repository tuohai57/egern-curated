// Synthetic response regressions. No network or paid-stream behavior is tested.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const script=fs.readFileSync(path.join(__dirname,'../module-stack/scripts/dcar-ad-cleaner.js'),'utf8');
let count=0;
function run(url,body){let result,calls=0;vm.runInNewContext(script,{$request:{url},$response:{body},$done:r=>{result=r;calls++;}},{timeout:100});assert.equal(calls,1);return result;}
function test(name,fn){fn();count++;}
const ad='https://api5-normal-lq.dcarapi.com/motor/ad/?version=1';
test('ad data and timer removed; envelope preserved',()=>{
 const input={code:0,message:'success',request_id:'synthetic',data:[{ad_id:1}],countdown:5};
 const result=JSON.parse(run(ad,JSON.stringify(input)).body);
 assert.deepEqual(result,{...input,data:[],countdown:0});
});
test('configuration clears only explicit ad fields',()=>{
 const input={status_code:0,data:{splash:[{id:1}],ad_duration:5,show_ad:true,car_list:[{id:6}],token_expired:false}};
 const result=JSON.parse(run('https://api5-normal-lq.dcarapi.com/motor/operation/activity/display/config/V2/',JSON.stringify(input)).body);
 assert.deepEqual(result,{status_code:0,data:{splash:[],ad_duration:0,show_ad:false,car_list:[{id:6}],token_expired:false}});
});
for(const url of ['https://api5-normal-lq.dcarapi.com/motor/information/api/full','https://api5-normal-lq.dcarapi.com/motor/stream_entrance/get_feed','https://api5-normal-lq.dcarapi.com/motor/advice/','https://api5-normal-lq.dcarapi.com/motor/adsExtra','https://example.com/motor/ad/']){
 test('normal/other URL unchanged '+url,()=>assert.deepEqual(run(url,'{"data":[{"video_detail_info":{"url":"normal"}}]}'),{}));
}
for(const body of ['{"code":401,"message":"login required","ads":[1]}','{"status_code":500,"ads":[1]}','{"message":"permission denied","ads":[1]}','null','[]','not JSON','{"code":0,"unknown_payload":{"keep":true}}']){
 test('error/unknown payload preserved '+body,()=>assert.deepEqual(run(ad,body),{}));
}
console.log(JSON.stringify({passed:true,cases:count,scope:'Synthetic field preservation and endpoint boundaries; phone MITM, actual API schema and splash behavior unverified.'}));
