import { createServer, type ServerResponse } from 'node:http';
import { ApiError } from './errors';
import type { Reply } from './http';
import { dispatch, errorReply } from './router';

const MAX_BODY_BYTES = 64 * 1024 * 1024;

function send(res: ServerResponse, reply: Reply): void {
  if (reply.status === 204) {
    res.writeHead(204).end();
    return;
  }
  const payload = reply.raw ?? JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) tooLarge = true;
    else chunks.push(chunk);
  });
  req.on('error', () => res.destroy());
  req.on('end', () => {
    if (tooLarge) {
      send(res, errorReply(new ApiError(413, 'payload_too_large', 'request body is too large')));
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      send(res, errorReply(new ApiError(404, 'not_found', 'invalid request target')));
      return;
    }
    send(
      res,
      dispatch({
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        rawBody: Buffer.concat(chunks).toString('utf8'),
      }),
    );
  });
});

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n' +
    '{"error":{"code":"malformed_request","message":"malformed HTTP request"}}');
});

const port = Number(process.env.PORT) || 8080;
server.listen(port, '0.0.0.0', () => console.log(`pocketful listening on ${port}`));
