import {readFile} from 'node:fs/promises';

import {compile, run} from '@mdx-js/mdx';
import * as runtime from 'react/jsx-runtime';

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const body = event.pull_request?.body ?? '';
const override = body
  .split('BEGIN_COMMIT_OVERRIDE')[1]
  ?.split('END_COMMIT_OVERRIDE')[0];
const note = override?.split('BREAKING CHANGE: ')[1]?.split('\n')[0];

if (!note) {
  throw new Error('The controlled BREAKING CHANGE note is missing');
}

const changelog = `# Changelog\n\n* ${note}\n`.replaceAll('{', '\\{');
console.log(`CONTROL_HAS_CRCR=${changelog.includes('\r\r')}`);

const compiled = String(await compile(changelog, {outputFormat: 'function-body'}));
console.log(`CONTROL_MDX_EXPORT_COMPILED=${compiled.includes('execFileSync')}`);
await run(compiled, {...runtime, baseUrl: import.meta.url});
