const crypto = require('node:crypto');

const expected =
  'PWNREQ_WIREIT_FUTURE_SECRET_20260827_7d4f7ebc5c76419aa3d4';
const observed = process.env.INPUT_TOKEN ?? '';

console.log('WIREIT_POISONED_ACTION_EXECUTED=true');
console.log(`FUTURE_SECRET_MATCH=${observed === expected}`);
console.log(
  `FUTURE_SECRET_SHA256=${crypto.createHash('sha256').update(observed).digest('hex')}`,
);
