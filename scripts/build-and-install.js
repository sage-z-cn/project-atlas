const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const outDir = path.join(root, "build");
const vsixName = `${pkg.name}-${pkg.version}.vsix`;
const vsixPath = path.join(outDir, vsixName);

console.log("Compiling ...");
execSync("npm run compile", { cwd: root, stdio: "inherit" });

fs.mkdirSync(outDir, { recursive: true });

console.log(`Packaging ${vsixName} ...`);
// --no-dependencies: root dependencies are empty (vite bundles everything).
// npm workspaces hoist webview deps into root node_modules; vsce's
// `npm list --production` then reports them as extraneous/invalid and fails.
execSync(`npx @vscode/vsce package --no-dependencies -o "${vsixPath}"`, {
  cwd: root,
  stdio: "inherit",
});

console.log(`Installing ${vsixName} ...`);
execSync(`code --install-extension "${vsixPath}" --force`, { cwd: root, stdio: "inherit" });
