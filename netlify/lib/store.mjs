// 저장소: 배포 환경에서는 Netlify Blobs, 로컬 개발·테스트에서는 파일(.data 폴더)
import { promises as fs } from 'node:fs';
import path from 'node:path';

let driver = null;

async function blobsDriver() {
  const { getStore } = await import('@netlify/blobs');
  const store = getStore({ name: 'jimi', consistency: 'strong' });
  return {
    async get(key) { return (await store.get(key, { type: 'json' })) ?? null; },
    async set(key, value) { await store.setJSON(key, value); },
    async del(key) { await store.delete(key); },
    async list(prefix) {
      // paginate 없이 호출하면 모든 페이지를 모아서 돌려줌
      const { blobs } = await store.list({ prefix });
      return blobs.map(b => b.key).sort();
    }
  };
}

function fileDriver(dir) {
  const file = key => path.join(dir, encodeURIComponent(key) + '.json');
  return {
    async get(key) {
      try { return JSON.parse(await fs.readFile(file(key), 'utf8')); }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    async set(key, value) {
      await fs.mkdir(dir, { recursive: true });
      const tmp = file(key) + '.' + process.pid + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(value));
      await fs.rename(tmp, file(key));
    },
    async del(key) { try { await fs.unlink(file(key)); } catch (e) { if (e.code !== 'ENOENT') throw e; } },
    async list(prefix) {
      let names = [];
      try { names = await fs.readdir(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
      return names.filter(n => n.endsWith('.json')).map(n => decodeURIComponent(n.slice(0, -5)))
        .filter(k => k.startsWith(prefix || '')).sort();
    }
  };
}

export async function store() {
  if (driver) return driver;
  driver = process.env.LOCAL_STORE_DIR ? fileDriver(process.env.LOCAL_STORE_DIR) : await blobsDriver();
  return driver;
}

/** 테스트용: 드라이버 초기화 */
export function _resetStore() { driver = null; }

export async function getJSON(key, fallback = null) { const v = await (await store()).get(key); return v == null ? fallback : v; }
export async function setJSON(key, value) { await (await store()).set(key, value); }
export async function delKey(key) { await (await store()).del(key); }
export async function listKeys(prefix) { return (await store()).list(prefix); }
