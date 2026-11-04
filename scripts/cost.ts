// Planning estimate, us-east-1, USD; reviewed 2026-11-02. No deployed-state queries.
// Sources and exclusions: ARCHITECTURE.md section 9. Includes mortgage and MCP usage.
export function calculateCosts(users: number) {
  return {
    "HTTP API": (users * 1090) / 1e6,
    Lambda:
      ((users * 1590 + 30) * 0.2) / 1e6 + (users * 162.5 + 3) * 0.0000133334,
    "DynamoDB requests": (users * (4220 * 0.625 + 109000 * 0.125)) / 1e6,
    "DynamoDB storage + PITR": users * 0.0102 * (0.25 + 0.2),
    S3: users * (0.0205 * 0.023 + (15 * 0.005) / 1000 + (110 * 0.0004) / 1000),
    SQS: ((users * 1000 + 300000) * 0.4) / 1e6,
    CloudWatch: users * (0.005 * 0.5 + 0.001 * 0.03) + 0.1,
    Transfer: users * 0.0205 * 0.09,
    Cognito: Math.max(0, users - 10000) * 0.015,
    "KMS signing": 1 + (users * 4 * 0.03) / 10000,
  };
}
for (const users of [1, 100, 1000, 10000, 100000]) {
  const costs = calculateCosts(users),
    subtotal = Object.values(costs).reduce((a, b) => a + b, 0),
    frontend = users === 1 ? 0 : 20;
  console.log(
    JSON.stringify({
      users,
      services: costs,
      subtotal,
      frontend,
      base: subtotal + frontend,
      planning: subtotal * 1.5 + 1 + frontend,
    }),
  );
}
console.log(
  "Estimates, not measured bills. Excludes tax, frontend overages, paid Maps usage, restores and abuse; AWS free allowances excluded except the available Cognito direct-sign-in allowance. No deployment actions.",
);
