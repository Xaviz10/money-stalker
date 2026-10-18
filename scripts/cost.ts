// Planning inputs, not a live pricing quote. Revalidate rates and taxes before deployment.
const usage = { httpRequests: 10000, lambdaRequests: 20000, lambdaGBSeconds: 2000, writes: 100000, reads: 200000,
  dynamoGB: .1, pitrGB: .1, s3GB: .5, s3Writes: 1000, s3Reads: 10000, sqsRequests: 30000,
  logIngestGB: .05, logStorageGB: .02, transferGB: .5, alarms: 1 };
const costs = {
  'GitHub Pages': 0,
  'HTTP API': usage.httpRequests / 1e6,
  'Lambda (before free allowance)': usage.lambdaRequests * .2 / 1e6 + usage.lambdaGBSeconds * .0000166667,
  'DynamoDB requests': usage.writes * .625 / 1e6 + usage.reads * .125 / 1e6,
  'DynamoDB storage / PITR': usage.dynamoGB * .25 + usage.pitrGB * .20,
  'S3 storage / requests': usage.s3GB * .023 + usage.s3Writes * .005 / 1000 + usage.s3Reads * .0004 / 1000,
  'SQS (before free allowance)': usage.sqsRequests * .4 / 1e6,
  'CloudWatch logs / alarm': usage.logIngestGB * .5 + usage.logStorageGB * .03 + usage.alarms * .1,
  'Transfer (conservative placeholder)': usage.transferGB * .09,
  'Cognito (requires unused direct-sign-in allowance)': 0,
};
for (const [name, value] of Object.entries(costs)) console.log(`${name}: USD ${value.toFixed(3)}`);
const subtotal = Object.values(costs).reduce((a, b) => a + b, 0);
console.log(`\nIllustrative subtotal: USD ${subtotal.toFixed(2)}`);
console.log(`With 100% uncertainty margin and illustrative 19% tax: USD ${(subtotal * 2 * 1.19).toFixed(2)}`);
console.log('Not a guarantee or live quote. Verify actual pricing, free allowance sharing, region, tax treatment, log size, restore costs and real usage. Alerts are not a hard cap.');
