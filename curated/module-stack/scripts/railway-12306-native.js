// Egern native rewrite; operation evidence: RuCu6/QuanX and 可莉's 12306 LPX.
// Never buffer the shared booking gateway's request body.
const gateway = /^https:\/\/mobile\.12306\.cn\/otsmobile\/app\/mgs\/mgw\.htm(?:\?[^#]*)?$/i;
const promotional = new Set([
  'com.cars.otsmobile.integration.activityBanner',
  'com.cars.otsmobile.newHomePageBussData',
  'com.cars.otsmobile.paySuccBuss.bussEntryShow',
]);

export default async function(ctx) {
  const request = ctx.request;
  if (!request || !gateway.test(request.url)) return;
  const operation = request.headers.get('operation-type');
  if (!promotional.has(operation)) return;
  // Explicit HTTP response: no fake gateway success and no script abort.
  return ctx.respond({status: 404, headers: {'Cache-Control': 'no-store'}, body: ''});
}
