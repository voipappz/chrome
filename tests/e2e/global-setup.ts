import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export default async function globalSetup() {
  const manifestPath = path.resolve(__dirname, '../../angular/dist/manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.log('\n[e2e setup] Building extension...');
    execSync('npm run build', {
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, NODE_OPTIONS: '--openssl-legacy-provider' },
    });
  }
}
