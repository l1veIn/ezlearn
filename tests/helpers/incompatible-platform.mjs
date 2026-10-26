import { createServer } from 'node:http';
let rpcRequests = 0;
let authenticatedRequests = 0;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.headers.authorization) authenticatedRequests++;
  if (request.url === '/health') {
    response.end(JSON.stringify({ ok: true, version: '0.1.0' }));
    return;
  }
  if (request.url === '/counts') {
    response.end(
      JSON.stringify({ rpc_requests: rpcRequests, authenticated_requests: authenticatedRequests }),
    );
    return;
  }
  rpcRequests++;
  response.statusCode = 501;
  response.end(JSON.stringify({ ok: false, error: { code: 'UNEXPECTED_RPC' } }));
});
server.listen(Number(process.argv[2]), '127.0.0.1');
