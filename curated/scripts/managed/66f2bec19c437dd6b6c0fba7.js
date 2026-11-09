// Upstream: https://raw.githubusercontent.com/VenenoSix24/Ivy-Script/refs/heads/main/Loon/script/Coolapk_Redirect.js
// Upstream SHA256: b4932011870422c8bc7b2d895ee3f6be44a87cbfd37b0ed2c60d8ba551523cae
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
       const sample = JSON.parse($response.body);
       if (sample === null || typeof sample !== 'object') return finish({});
       if (sample.error || (typeof sample.code === 'number' && sample.code < 0)) return finish({});
     }
   }
   (function ($done) {
let url = $request.url;

if (url.indexOf("coolapk.com/link") !== -1) {
  let match = url.match(/url=([^&]+)/);
  if (match) {
    let realUrl = decodeURIComponent(match[1]);

    $done({
      response: {
        status: 302,
        headers: {
          "Location": realUrl,
          "Cache-Control": "no-cache"
        }
      }
    });
    return;
  }
}

$done({});
   })(done);
 } catch (error) {
   if (error !== stop && !completed) { completed = true; finish({}); }
 }
})();
