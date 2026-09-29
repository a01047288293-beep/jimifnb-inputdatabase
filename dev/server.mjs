// 로컬 확인용 서버: npm run dev → http://localhost:8888
// Netlify 없이 화면과 API를 그대로 돌려 본다 (저장소는 .data 폴더, 기본 데모 모드)
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.LOCAL_STORE_DIR ||= path.join(root, '.data');
process.env.ADMIN_PASSWORD ||= 'jimi-local-1234';
process.env.SESSION_SECRET ||= 'local-dev-secret-change-me-please';

const { default: api } = await import('../netlify/functions/api.mjs');
const { runSync } = await import('../netlify/lib/sync.mjs');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const port = Number(process.env.PORT || 8888);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const r = await api(request);
      const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
      res.writeHead(r.status, headers); res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let file = path.join(root, 'public', decodeURIComponent(url.pathname));
    if (!file.startsWith(path.join(root, 'public'))) { res.writeHead(403); res.end(); return; }
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    const buf = await fs.readFile(file).catch(() => null);
    if (!buf) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(buf);
  } catch (e) { console.error(e); res.writeHead(500); res.end('error'); }
});
server.listen(port, () => {
  console.log(`지미 운영 시스템 로컬 서버: http://localhost:${port}`);
  console.log(`로그인 비밀번호: ${process.env.ADMIN_PASSWORD}`);
});
if (process.env.LOCAL_SYNC !== 'off') setInterval(() => runSync('local').catch(e => console.error('sync', e.message)), 15 * 60000);
