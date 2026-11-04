import { checkCognitoDiscovery } from './mcp-discovery';

// Deliberately no dotenv loading, AWS SDK calls, token exchange, or cloud mutation.
const issuer = process.env.MCP_COGNITO_ISSUER ?? process.env.VITE_COGNITO_AUTHORITY;
if (!issuer) {
  console.error('PENDING: set MCP_COGNITO_ISSUER or VITE_COGNITO_AUTHORITY to the public Cognito issuer URL.');
  process.exitCode = 2;
} else {
  try {
    const report = await checkCognitoDiscovery(issuer);
    console.log(`MCP discovery: ${report.status}`);
    for (const check of report.checks) console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}`);
    for (const pending of report.pending) console.log(`PENDING ${pending}`);
    console.log('Metadata compatibility does not prove OAuth linking or token validity.');
    if (report.status !== 'metadata_compatible') process.exitCode = 1;
  } catch {
    console.error('Invalid Cognito issuer configuration. Use an HTTPS Cognito user-pool issuer without credentials or query parameters.');
    process.exitCode = 2;
  }
}
