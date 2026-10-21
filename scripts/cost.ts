// Planning estimate, us-east-1, USD; reviewed 2026-10-21. No deployed-state queries.
// Sources and exclusions: ARCHITECTURE.md section 9. Includes mortgage usage.
export function calculateCosts(users: number) {
  return {
    "HTTP API": (users * 1040) / 1e6,
    Lambda:
      ((users * 1540 + 30) * 0.2) / 1e6 + (users * 160 + 3) * 0.0000133334,
    "DynamoDB requests": (users * (4200 * 0.625 + 105000 * 0.125)) / 1e6,
    "DynamoDB storage + PITR": users * 0.0101 * (0.25 + 0.2),
    S3: users * (0.0205 * 0.023 + (15 * 0.005) / 1000 + (110 * 0.0004) / 1000),
    SQS: ((users * 1000 + 300000) * 0.4) / 1e6,
    CloudWatch: users * (0.005 * 0.5 + 0.001 * 0.03) + 0.1,
    Transfer: users * 0.0205 * 0.09,
    Cognito: Math.max(0, users - 10000) * 0.015,
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
