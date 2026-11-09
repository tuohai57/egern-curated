// Upstream: https://raw.githubusercontent.com/zmqcherish/proxy-script/main/weibo_launch.js
// Upstream SHA256: 1ebea73aa974503abf72371cd32bdda86975dbad9beaf4c6f648db6debb75fa6
// Locally maintained guard; original authors and source below.
(function () {
 const finish = $done;
 const stop = {};
 let completed = false;
 function done(result) {
   if (!completed) { completed = true; finish(result || {}); }
   throw stop;
 }
 try {
   if (typeof $response !== 'undefined') {
     const status = Number($response.statusCode || $response.status || 200);
     if (status < 200 || status >= 300) return finish({});
     if (typeof $response.body === 'string') {
       if (!$response.body.trim()) return finish({});
       const sample = JSON.parse($response.body.replace(/OK\s*$/, ""));
       if (sample === null || typeof sample !== 'object') return finish({});
       if (sample.error || (typeof sample.code === 'number' && sample.code < 0)) return finish({});
     }
   }
   (function ($done) {
//参考@yichahucha 的脚本

const launchAdUrl1 = '/interface/sdk/sdkad.php';
const launchAdUrl2 = '/wbapplua/wbpullad.lua';

// function needModify(url) {
// 	if(url.indexOf(launchAdUrl1) > -1 || url.indexOf(launchAdUrl2) > -1) {
// 		return true;
// 	}
// 	return false;
// }

function modifyMain(url, data) {
	if(url.indexOf(launchAdUrl1) > -1) {
		let temp = data.match(/\{.*\}/);
		if(!temp) return data;
		data = JSON.parse(temp);
		if (data.ads) data.ads = [];
		if (data.background_delay_display_time) data.background_delay_display_time = 60 * 60 * 24 * 1000;
		if (data.show_push_splash_ad) data.show_push_splash_ad = false;
		return JSON.stringify(data) + 'OK';
	}
	if(url.indexOf(launchAdUrl2) > -1) {
		data = JSON.parse(data);
		if (data.cached_ad && data.cached_ad.ads) {
			data.cached_ad.ads = [];
		}
		return JSON.stringify(data);
	}
	return data;
}

var body = $response.body;
var url = $request.url;
// if(needModify(url)) {
body = modifyMain(url, body);
// }

$done({ body });
   })(done);
 } catch (error) {
   if (error !== stop && !completed) { completed = true; finish({}); }
 }
})();
