import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const forbiddenFiles = [
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)(?:credentials|secrets?)(?:\/|$)/i,
  /\.(?:pem|key|p12|pfx|mobileprovision|shortcut)$/i,
];
const allowedFiles = new Set([".env.example"]);
const contentRules = [
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[opusr]_[A-Za-z0-9]{30,}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["Stripe live secret", /\bsk_live_[A-Za-z0-9]{20,}\b/],
  ["hardcoded bearer token", /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/],
  ["absolute macOS home path", /\/Users\/[^/\s"']+\//],
  ["absolute Linux home path", /\/home\/[^/\s"']+\//],
  ["AWS account ARN", /\barn:aws(?:-[a-z]+)?:[^:\s]*:[^:\s]*:\d{12}:/],
];

const findings = [];
for (const file of files) {
  if (!allowedFiles.has(file) && forbiddenFiles.some((rule) => rule.test(file))) {
    findings.push(`${file}: forbidden sensitive filename`);
    continue;
  }
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  for (const [label, rule] of contentRules) {
    if (rule.test(text)) findings.push(`${file}: ${label}`);
  }
}

if (findings.length) {
  console.error("Repository safety check failed:\n" + findings.join("\n"));
  process.exit(1);
}
console.log(`Repository safety check passed for ${files.length} files.`);
