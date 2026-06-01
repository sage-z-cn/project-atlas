const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const outDir = path.join(root, "build");
const vsixName = `${pkg.name}-${pkg.version}.vsix`;
const vsixPath = path.join(outDir, vsixName);

fs.mkdirSync(outDir, { recursive: true });

console.log(`Packaging ${vsixName} ...`);
execSync(`npx @vscode/vsce package -o "${vsixPath}"`, { cwd: root, stdio: "inherit" });

console.log(`Installing ${vsixName} ...`);
execSync(`code --install-extension "${vsixPath}" --force`, { cwd: root, stdio: "inherit" });
