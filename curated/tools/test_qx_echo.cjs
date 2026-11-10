// Exercise only our compatibility prefix, never the downloaded upstream code.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const folder=path.resolve(__dirname,'../module-stack/scripts');
let checked=0;
for(const filename of fs.readdirSync(folder)){
 if(!filename.endsWith('.js'))continue;
 const text=fs.readFileSync(path.join(folder,filename),'utf8');
 const marker='// END EGERN COMPATIBILITY PREFIX; exact upstream bytes follow.\n';
 if(!text.includes(marker)||!text.includes('const __egernEchoDone = $done;'))continue;
 const prefix=text.split(marker)[0];
 for(const [input,expected] of [
  [{status:'HTTP/1.1 200 OK',headers:{'Content-Type':'text/html'},body:'settings'}, {response:{status:200,headers:{'Content-Type':'text/html'},body:'settings'}}],
  [{statusCode:201,body:'saved'}, {response:{status:201,headers:{},body:'saved'}}],
  [{},{}],
  [{response:{status:204}}, {response:{status:204}}]
 ]){
  let result;const context={$done:value=>{result=value},$persistentStore:{read:()=>null,write:()=>true},$notification:{post(){}},$httpClient:{},input};
  vm.runInNewContext(prefix+'\n$done(input);',context,{timeout:1000});
  assert.deepEqual(JSON.parse(JSON.stringify(result)),expected);checked++;
 }
}
assert(checked>0,'No current QX echo adapters tested');
console.log(JSON.stringify({passed:true,cases:checked,upstream_executed:false}));
