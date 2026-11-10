// Compatibility repair: exact author-supplied gRPC frames; no original script edited.
const frames = [{"match": "^https:\\/\\/grpc\\.biliapi\\.net\\/bilibili\\.app\\.interface\\.v1\\.Teenagers\\/ModeStatus$", "bytes": [0, 0, 0, 0, 19, 10, 17, 8, 2, 18, 9, 116, 101, 101, 110, 97, 103, 101, 114, 115, 32, 2, 42, 0]}, {"match": "^https:\\/\\/grpc\\.biliapi\\.net\\/bilibili\\.app\\.interface\\.v1\\.Search\\/DefaultWords$", "bytes": [0, 0, 0, 0, 33, 26, 29, 230, 144, 156, 231, 180, 162, 232, 167, 134, 233, 162, 145, 227, 128, 129, 231, 149, 170, 229, 137, 167, 230, 136, 150, 117, 112, 228, 184, 187, 40, 1]}, {"match": "^https:\\/\\/grpc\\.biliapi\\.net\\/bilibili\\.app\\.(?:view\\.v1\\.View\\/TFInfo|viewunite\\.v1\\.View\\/(?:PlayPause|ViewEndPage))$", "bytes": [0, 0, 0, 0, 0]}];
const frame = frames.find(row => new RegExp(row.match).test($request.url));
if (frame) {
  $done({response: {status: 200, headers: {"content-type": "application/grpc", "grpc-status": "0", "content-length": String(frame.bytes.length)}, body: new Uint8Array(frame.bytes)}});
} else {
  $done({});
}
