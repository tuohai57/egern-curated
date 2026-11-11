// Native Egern equivalent of the archived fmz200 reject-img helper.
// The transparent GIF bytes are unchanged; no legacy $done global is needed.
const gif = [71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,33,249,4,1,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,1,68,0,59];

export default async function(ctx) {
  if (!ctx.request) return;
  return ctx.respond({status: 200, headers: {'Content-Type': 'image/gif', 'Content-Length': String(gif.length)}, body: new Uint8Array(gif)});
}
