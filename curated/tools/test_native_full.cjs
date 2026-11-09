// Original author scripts, isolated from network, filesystem, and account state.
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'curated/native-full/manifest.json'),'utf8'));
const fixtures=JSON.parse(fs.readFileSync(path.join(root,'curated/native-full/regression-fixtures.json'),'utf8'));
let syntaxPassed=0;const functionScopeRequired=[],tests=[],failures=[];
for(const dep of manifest.dependencies){
 const data=fs.readFileSync(path.join(root,dep.repository_path));
 assert.equal(crypto.createHash('sha256').update(data).digest('hex'),dep.sha256);
 const source=data.toString('utf8').replace(/^\uFEFF/,'');
 try{new vm.Script(source);syntaxPassed++;}catch(error){
  if(error.message!=='Illegal return statement')throw error;
  // Report this separately: parsing in a function does not prove that Egern
  // uses function scope for a legacy script. The delivered bytes stay original.
  new vm.Script('(function(){\n'+source+'\n})');
  functionScopeRequired.push(dep.url);
 }
}
async function run(source,url,input){
 const outputs=[];
 const sandbox={
  $request:{url,method:'GET',headers:{},body:''},
  $response:{status:200,statusCode:200,headers:{'content-type':'application/json'},body:JSON.stringify(input)},
  $done:output=>outputs.push(output),
  $environment:{'surge-version':'5.0'},
  $persistentStore:{read:()=>null,write:()=>true},$notification:{post:()=>{}},
  console:{log:()=>{},info:()=>{},error:()=>{},warn:()=>{}},
  TextEncoder,TextDecoder,URL,URLSearchParams,setTimeout,clearTimeout
 };
 vm.runInNewContext(source,sandbox,{timeout:1200});
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(outputs.length,1,'Script must complete exactly once');
 return outputs[0];
}
(async()=>{
 for(const fixture of fixtures.cases){
  try{
   const dep=manifest.dependencies.find(row=>row.url.endsWith('/'+fixture.source_suffix));assert.ok(dep,'Missing fixture source');
   const output=await run(fs.readFileSync(path.join(root,dep.repository_path),'utf8'),fixture.url,fixture.input);
   assert.deepEqual(JSON.parse(output.body),fixture.expected);tests.push(fixture.name);
  }catch(error){failures.push({name:fixture.name,error:error.message});}
 }
 for(const helper of manifest.helpers||[]){
  const source=fs.readFileSync(path.join(root,helper.repository_path),'utf8');
  for(const [frameIndex,frame] of helper.frames.entries()){
   const url=helper.kind==='tiny-gif'?[
     'https://flowplus.meituan.net/v1/abc/linglong/ad.jpg',
     'https://img.meituan.net/bizad/bizad_brandCpt_123.jpg',
     'https://img.meituan.net/goodsawardpic/aabb.png.webp'][frameIndex]:
     frame.match.includes('Teenagers')?'https://grpc.biliapi.net/bilibili.app.interface.v1.Teenagers/ModeStatus':frame.match.includes('DefaultWords')?'https://grpc.biliapi.net/bilibili.app.interface.v1.Search/DefaultWords':'https://grpc.biliapi.net/bilibili.app.viewunite.v1.View/ViewEndPage';
   try{
    const output=await run(source,url,{});assert.equal(output.response.status,200);
    assert.deepEqual(Array.from(output.response.body),frame.bytes);
    assert.equal(Number(output.response.headers['content-length']),frame.bytes.length);
    const bytes=Buffer.from(frame.bytes);
    if(helper.kind==='tiny-gif'){
      assert.equal(bytes.subarray(0,6).toString(),'GIF89a');assert.equal(bytes.readUInt16LE(6),1);assert.equal(bytes.readUInt16LE(8),1);
      assert.equal(output.response.headers['content-type'],'image/gif');tests.push('美团原始tiny-gif响应格式 '+url);
    }else{assert.equal(bytes.readUInt32BE(1),bytes.length-5);tests.push('B站原始gRPC响应字节 '+url);}
   }catch(error){failures.push({name:url,error:error.message});}
  }
 }
 const result={original_scripts:manifest.dependencies.length,program_parse_passed:syntaxPassed,
  requires_function_scope_runtime_verification:functionScopeRequired,source_bytes_modified:false,
  behavior_cases:tests.length+failures.length,behavior_passed:tests.length,failures,
  scope:'Synthetic fixtures in a mocked legacy compatibility runtime, not Egern/iOS execution.'};
 console.log(JSON.stringify(result,null,2));process.exitCode=failures.length?1:0;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
