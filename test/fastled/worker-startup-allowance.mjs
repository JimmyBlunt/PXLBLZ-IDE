// Diagnostic workaround for this Windows host's measured 163.7-second jsdom
// import. Changes only two worker-initialization watchdogs in this process.
// Dependency files, test bodies, assertion timeouts and teardown limits stay
// unchanged. Deliberately tied to the exact inspected Vitest 4.1.7 source.
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { registerHooks } from 'node:module';
import process from 'node:process';

const expectedSha256 = '6c67544c5b2084a308acc75e7ace514953e16b6d86a1d8ad13e84849a91f1b06';
const substitutions = [
  ['const START_TIMEOUT = 6e4;', 'const START_TIMEOUT = 300000;'],
  ['const WORKER_START_TIMEOUT = 9e4;', 'const WORKER_START_TIMEOUT = 300000;'],
];

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!/\/vitest\/dist\/chunks\/cli-api\.[^/]+\.js$/.test(url)) return result;
    let source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
    const digest = createHash('sha256').update(source).digest('hex');
    if (digest !== expectedSha256) throw new Error('Vitest source changed: inspect and reauthorize the startup allowance before use.');
    for (const [before, after] of substitutions) {
      if (source.split(before).length !== 2) throw new Error('Expected exactly one occurrence of each Vitest startup watchdog.');
      source = source.replace(before, after);
    }
    process.stderr.write('[FastLED verification] Adapted worker initialization allowance: 300000 ms; test/assertion timeouts unchanged.\n');
    return { ...result, source };
  },
});
