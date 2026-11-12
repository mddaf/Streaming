import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const directory = dirname(fileURLToPath(import.meta.url));
const wrangler = join(directory, 'node_modules/wrangler/bin/wrangler.js');
const dryRun = process.argv.includes('--dry-run');

// Deploy the private service first so the proxy's service binding resolves.
for (const service of ['sniffer', 'proxy']) {
    const args = [wrangler, 'deploy', '--config', join(directory, `wrangler.${service}.jsonc`)];
    if (dryRun) args.push('--dry-run', '--outdir', join(directory, '.deploy-build', service));
    const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true, env: {
        ...process.env,
        WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || join(directory, '.wrangler', 'logs'),
        WRANGLER_SEND_METRICS: 'false'
    } });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) process.exit(result.status || 1);
}
console.log(dryRun ? 'Both deployment bundles passed.' : 'Sniffer and proxy deployed. Publish the frontend changes to enable automatic catalog refresh.');
