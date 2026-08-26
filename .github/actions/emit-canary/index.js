const crypto = require('crypto');
const fs = require('fs');

const delimiter = `pwnreq_${crypto.randomUUID()}`;
fs.appendFileSync(
  process.env.GITHUB_OUTPUT,
  `release_secret<<${delimiter}\n${process.env.INPUT_CANARY}\n${delimiter}\n`,
  { encoding: 'utf8' },
);
console.log('release-like action produced a masked output');
