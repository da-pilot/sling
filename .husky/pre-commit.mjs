import { exec } from "node:child_process";

const run = (cmd) => new Promise((resolve, reject) => exec(
  cmd,
  (error, stdout, stderr) => {
    if (error) reject(error);
    if (stderr) reject(new Error(stderr));
    resolve(stdout);
  }
));

try {
  const changeset = await run('git diff --cached --name-only --diff-filter=ACMR');
  const modifiedFiles = changeset.split('\n').filter(Boolean);

  // check if there are any model files staged
  const modifledPartials = modifiedFiles.filter((file) => file.match(/^ue\/models\/.*\.json/));
  if (modifledPartials.length > 0) {
    console.log('UE model files changed, rebuilding component JSON files...');
    const output = await run('npm run build:json --silent');
    if (output) console.log(output);
    await run('git add component-models.json component-definition.json component-filters.json');
    console.log('Component JSON files rebuilt and staged.');
  }
} catch (error) {
  console.error('Pre-commit hook failed:', error.message || error);
  process.exit(1);
}


