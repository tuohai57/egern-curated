// Exercise our own probe code with synthetic HTTP responses; no upstream JS runs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const source=fs.readFileSync(path.join(__dirname,'../hub-resources/scripts/service-diagnostics.js'),'utf8');
  const mod=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  let cases=0;
  for(const status of [401,403,429,500,503,404,302,101,undefined,NaN,700]) {
    assert(!mod.classify(status).text.startsWith('可达'));cases++;
  }
  for(const status of [200,204]) {assert(mod.classify(status).text.startsWith('可达'));cases++;}
  assert.equal(mod.classify(null,true).text,'连接失败');cases++;
  const calls=[];
  const ctx={http:{get:async(url,options)=>{calls.push({url,options});return {status:403};}}};
  for(const service of mod.services) {
    const value=await mod.probe(ctx,service);
    assert(value.text.includes('403'));
    assert.equal(calls.at(-1).options.policy,service.policy);
    assert.equal(calls.at(-1).options.credentials,'omit');
    assert.equal(calls.at(-1).options.insecureTls,false);
    assert.equal(calls.at(-1).options.redirect,'manual');
    assert(calls.at(-1).url.startsWith('https://'));
    cases++;
  }
  const failures=await mod.probe({http:{get:async()=>{throw new Error('timeout');}}},mod.services[0]);
  assert.equal(failures.text,'连接失败');cases++;
  const tree=await mod.default({...ctx,widgetFamily:'systemMedium'});
  assert.equal(tree.type,'widget');assert(JSON.stringify(tree).includes('可达不等于地区或账户可用'));cases++;
  console.log(JSON.stringify({passed:true,cases,scope:'Own-code mocked HTTP checks, not live availability or iOS rendering'}));
})().catch(error=>{console.error(error);process.exitCode=1;});
