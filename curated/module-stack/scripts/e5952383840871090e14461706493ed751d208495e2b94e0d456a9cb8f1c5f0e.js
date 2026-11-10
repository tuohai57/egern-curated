// Compatibility API aliases; original source follows without byte edits.
if (typeof $prefs === 'undefined') globalThis.$prefs = {valueForKey:k=>$persistentStore.read(k),setValueForKey:(v,k)=>$persistentStore.write(v,k),removeValueForKey:k=>$persistentStore.write('',k)};
if (typeof $notify === 'undefined') globalThis.$notify = (...args)=>$notification.post(...args);
if (typeof $task === 'undefined') globalThis.$task = {fetch:options=>new Promise((resolve,reject)=>{
 const o=typeof options==='string'?{url:options}:options;
 const method=(o.method||'GET').toLowerCase();
 $httpClient[method](o,(error,response,body)=>error?reject(error):resolve({...response,statusCode:response.status||response.statusCode,body}));
})};
// Egern request scripts use a nested response envelope for local replies.
const __egernEchoDone = $done;
globalThis.$done = value => {
 if (!value || value.response || !['body','status','statusCode','headers'].some(k => Object.prototype.hasOwnProperty.call(value,k))) return __egernEchoDone(value || {});
 const status = typeof value.status === 'number' ? value.status : Number(String(value.status || value.statusCode || 200).match(/\b[1-5]\d{2}\b/)?.[0] || 200);
 return __egernEchoDone({response:{status,headers:value.headers || {},body:value.body || ''}});
};
/***********************************************

> 应用名称：墨鱼自用12306去广告脚本
> 脚本作者：@ddgksf2013
> 微信账号：墨鱼手记
> 更新时间：2024-08-24
> 通知频道：https://t.me/ddgksf2021
> 特别提醒：如需转载请注明出处，谢谢合作！
> 脚本说明：目前脚本是最简洁也是最完美的了（低调使用），Enjoy！
> 使用说明：请在本地添加分流 host, ad.12306.cn, direct

[rewrite_local]

^https?:\/\/ad\.12306\.cn\/ad\/ser\/getAdList url script-analyze-echo-response https://github.com/ddgksf2013/Scripts/raw/master/12306.js

[mitm]

hostname = ad.12306.cn

***********************************************/













const version = 'V1.0.23';

var obj=JSON.parse($request.body),ddgksf2013={};"0007"==obj.placementNo?(ddgksf2013.materialsList=[{billMaterialsId:"6491",filePath:"ddgksf2013",creativeType:1}],ddgksf2013.advertParam={skipTime:1},ddgksf2013.code="00"):ddgksf2013="G0054"==obj.placementNo?{code:"00",materialsList:[{}]}:{code:"00",message:"无广告返回"},"undefined"!=typeof $task?$done({body:JSON.stringify(ddgksf2013)}):$done({response:{body:JSON.stringify(ddgksf2013)}});
