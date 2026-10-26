import { startLocalPlatform } from '../../src/platform/local.js';
await startLocalPlatform({ dataDir: process.argv[2], port: Number(process.argv[3]) });
process.stdout.write('PLATFORM_READY\n');
