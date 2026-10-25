/**
 * pictureHub.js - hands the live feed's picture to the radio screen, in memory, on loopback only.
 *
 * The live feeder ffmpeg writes JPEG frames (fd 3); `push()` splits them and the hub serves them as
 * multipart MJPEG at http://127.0.0.1:<port>/live.mjpeg, which the screen shows inside the Signal
 * frame with an <img>. Only the latest frame is kept. Nothing is written to disk and the server
 * binds 127.0.0.1, so the feed is never recorded or re-hosted (#202 item 5).
 */
import http from "node:http";

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const BOUNDARY = "scoopframe";

/** Incremental JPEG splitter: feed chunks, get whole frames. */
export function createJpegSplitter(onFrame, { maxBuffer = 8 * 1024 * 1024 } = {}) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
    for (;;) {
      const s = buf.indexOf(SOI);
      if (s < 0) { buf = buf.subarray(Math.max(0, buf.length - 1)); return; }
      const e = buf.indexOf(EOI, s + 2);
      if (e < 0) { if (s > 0) buf = buf.subarray(s); if (buf.length > maxBuffer) buf = Buffer.alloc(0); return; }
      onFrame(Buffer.from(buf.subarray(s, e + 2)));
      buf = buf.subarray(e + 2);
    }
  };
}

export async function startPictureHub() {
  const clients = new Set();
  let latest = null;
  const sendTo = (res, frame) => {
    res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
    res.write(frame); res.write("\r\n");
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/live.mjpeg") { res.statusCode = 404; return res.end(); }
    res.writeHead(200, { "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`, "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*", Connection: "close" });
    clients.add(res);
    if (latest) sendTo(res, latest);
    req.on("close", () => clients.delete(res));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address();
  const push = createJpegSplitter((frame) => {
    latest = frame;
    for (const res of clients) { if (res.writableLength < frame.length * 4) sendTo(res, frame); }
  });
  return {
    url: `http://127.0.0.1:${port}/live.mjpeg`,
    push,
    clear() { latest = null; },
    get clients() { return clients.size; },
    close: () => new Promise((r) => { for (const c of clients) { try { c.destroy(); } catch { /* gone */ } } clients.clear(); server.close(() => r()); }),
  };
}
