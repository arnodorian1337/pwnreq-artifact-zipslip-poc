#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

if (process.argv.length !== 4) {
  console.error('usage: upload-raw-artifact.js ARTIFACT_NAME ZIP_FILE')
  process.exit(2)
}

const artifactName = process.argv[2]
const zipFile = path.resolve(process.argv[3])

const artifactEntry = require.resolve('@actions/artifact')
const artifactRoot = path.resolve(path.dirname(artifactEntry), '..')
const fromArtifact = relativePath => require(path.join(artifactRoot, 'lib', relativePath))

const {internalArtifactTwirpClient} = fromArtifact('internal/shared/artifact-twirp-client.js')
const {getBackendIdsFromToken} = fromArtifact('internal/shared/util.js')
const {uploadZipToBlobStorage} = fromArtifact('internal/upload/blob-upload.js')
const {StringValue} = fromArtifact('generated/google/protobuf/wrappers.js')

async function main() {
  const backendIds = getBackendIdsFromToken()
  const artifactClient = internalArtifactTwirpClient()

  const createResponse = await artifactClient.CreateArtifact({
    workflowRunBackendId: backendIds.workflowRunBackendId,
    workflowJobRunBackendId: backendIds.workflowJobRunBackendId,
    name: artifactName,
    version: 4
  })
  if (!createResponse.ok) {
    throw new Error('CreateArtifact returned ok=false')
  }

  const upload = await uploadZipToBlobStorage(
    createResponse.signedUploadUrl,
    fs.createReadStream(zipFile)
  )

  const finalizeRequest = {
    workflowRunBackendId: backendIds.workflowRunBackendId,
    workflowJobRunBackendId: backendIds.workflowJobRunBackendId,
    name: artifactName,
    size: String(upload.uploadSize || 0)
  }
  if (upload.sha256Hash) {
    finalizeRequest.hash = StringValue.create({value: `sha256:${upload.sha256Hash}`})
  }

  const finalizeResponse = await artifactClient.FinalizeArtifact(finalizeRequest)
  if (!finalizeResponse.ok) {
    throw new Error('FinalizeArtifact returned ok=false')
  }

  console.log(`finalized raw artifact ${artifactName} as id ${finalizeResponse.artifactId}`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
