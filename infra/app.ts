import { App } from 'aws-cdk-lib';
import { MoneyStalkerStack } from './stack';
const app = new App();
if (app.node.tryGetContext('deployment') && (!app.node.tryGetContext('frontendUrl') || !app.node.tryGetContext('budgetEmail')))
  throw new Error('Deployment requires -c frontendUrl=https://OWNER.github.io/REPO/ -c budgetEmail=YOUR_EMAIL');
new MoneyStalkerStack(app, 'MoneyStalker', {
  env: { region: 'us-east-1', account: process.env.CDK_DEFAULT_ACCOUNT },
  frontendUrl: app.node.tryGetContext('frontendUrl') ?? 'https://example.github.io/money-stalker/',
  budgetEmail: app.node.tryGetContext('budgetEmail'),
});
