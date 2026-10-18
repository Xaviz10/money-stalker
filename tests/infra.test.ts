import { describe, expect, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { MoneyStalkerStack } from '../infra/stack';
describe('infrastructure safeguards', () => {
  it('keeps the frontend off AWS and provisions private data, scoped auth, recovery, and cost alerts', () => {
    const app = new App(), stack = new MoneyStalkerStack(app, 'Test', { env: { account: '111111111111', region: 'us-east-1' }, frontendUrl: 'https://example.github.io/money-stalker/', budgetEmail: 'alerts@example.invalid' });
    const t = Template.fromStack(stack);
    t.resourceCountIs('AWS::CloudFront::Distribution', 0); t.resourceCountIs('AWS::S3::Bucket', 1); t.resourceCountIs('AWS::EC2::NatGateway', 0);
    t.hasResourceProperties('AWS::S3::Bucket', { PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true } });
    t.hasResourceProperties('AWS::Cognito::UserPool', { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true }, UserPoolTier: 'ESSENTIALS' });
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', { GenerateSecret: false, AllowedOAuthFlows: ['code'], CallbackURLs: ['https://example.github.io/money-stalker/'] });
    t.hasResourceProperties('AWS::ApiGatewayV2::Api', { CorsConfiguration: Match.objectLike({ AllowOrigins: ['https://example.github.io'], AllowMethods: Match.arrayWith(['OPTIONS', 'GET', 'POST', 'PATCH', 'DELETE']) }) });
    t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'ANY /{proxy+}', AuthorizationType: 'JWT', AuthorizationScopes: ['openid'] });
    t.hasResourceProperties('AWS::DynamoDB::Table', { BillingMode: 'PAY_PER_REQUEST', PointInTimeRecoverySpecification: Match.objectLike({ PointInTimeRecoveryEnabled: true }) });
    t.hasResourceProperties('AWS::Budgets::Budget', { Budget: Match.objectLike({ BudgetLimit: { Amount: 5, Unit: 'USD' } }), NotificationsWithSubscribers: Match.arrayWith([Match.objectLike({ Notification: Match.objectLike({ Threshold: 4 }) })]) });
    expect(Object.values(t.findResources('AWS::Lambda::Function')).every((r: any) => r.Properties.ReservedConcurrentExecutions === undefined)).toBe(true);
  });
});
