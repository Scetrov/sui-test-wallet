const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const manifestPath = path.join(__dirname, '..', 'manifest.json');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const nextVersion = packageJson.version;

if (process.argv.includes('--check')) {
  if (manifest.version !== nextVersion) {
    console.error(
      `Version mismatch: package.json is ${nextVersion} but manifest.json is ${manifest.version}`,
    );
    process.exit(1);
  }

  console.log(`Version metadata is aligned at ${nextVersion}`);
  process.exit(0);
}

if (manifest.version !== nextVersion) {
  manifest.version = nextVersion;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  try {
    execFileSync('git', ['add', manifestPath], { stdio: 'ignore' });
  } catch {
    // Ignore environments without git or without an initialized repository.
  }

  console.log(`Updated manifest.json to version ${nextVersion}`);
} else {
  console.log(`manifest.json already matches version ${nextVersion}`);
}