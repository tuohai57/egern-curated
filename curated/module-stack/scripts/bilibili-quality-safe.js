/* Bilibili quality compatibility helper. It only edits fields already present
 * in a successful JSON response; it never replaces errors or media URLs. */
(function () {
  function finish(body) { $done({ body: body }); }
  var raw = (typeof $response !== 'undefined' && typeof $response.body === 'string') ? $response.body : '';
  if (!raw.trim()) return finish(raw);
  var obj;
  try { obj = JSON.parse(raw); } catch (_) { return finish(raw); }
  if (!obj || (typeof obj.code === 'number' && obj.code < 0)) return finish(raw);
  var url = (typeof $request !== 'undefined' && $request.url) || '';
  var account = /\/x\/v2\/account\/(?:myinfo|mine)(?:\?|$)/.test(url);
  var play = /\/pgc\/player\/api\/playurl(?:\?|$)/.test(url);
  function vip(node) {
    if (!node || typeof node !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(node, 'type')) node.type = 2;
    if (Object.prototype.hasOwnProperty.call(node, 'status')) node.status = 1;
    if (Object.prototype.hasOwnProperty.call(node, 'vip_pay_type')) node.vip_pay_type = 1;
    if (Object.prototype.hasOwnProperty.call(node, 'due_date')) node.due_date = 4102444800000;
  }
  function accountData(node) {
    if (!node || typeof node !== 'object') return;
    vip(node.vip); if (Object.prototype.hasOwnProperty.call(node, 'vip_type')) node.vip_type = 2;
    vip(node.vip_label); if (node.user) vip(node.user.vip);
  }
  if (account) {
    accountData(obj.data); accountData(obj.result); accountData(obj);
  }
  if (play) {
    var root = obj.data || obj.result || obj;
    if (root && Array.isArray(root.accept_quality) && root.accept_quality.length) {
      root.has_paid = true;
      root.quality = root.accept_quality[0];
      if (Array.isArray(root.accept_description) && root.accept_description.length) root.quality_description = root.accept_description[0];
    }
    if (root && root.vip) vip(root.vip);
  }
  finish(JSON.stringify(obj));
}());
