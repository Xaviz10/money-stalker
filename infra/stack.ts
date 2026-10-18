import { Stack, Duration, RemovalPolicy, CfnOutput, Tags, type StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { DynamoEventSource, SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as events from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

export class MoneyStalkerStack extends Stack {
  constructor(scope: Construct, name: string, props: StackProps & { frontendUrl: string; budgetEmail?: string }) {
    super(scope, name, props);
    const url = new URL(props.frontendUrl);
    if (url.protocol !== 'https:' || !url.pathname.endsWith('/') || url.hash || url.search) throw new Error('frontendUrl must be the exact HTTPS app root with trailing slash');
    Tags.of(this).add('Project', 'money-stalker');
    const ledger = new dynamodb.Table(this, 'Ledger', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }, sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true, recoveryPeriodInDays: 7 },
    });
    const intake = new dynamodb.Table(this, 'Intake', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }, sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, removalPolicy: RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_IMAGE, timeToLiveAttribute: 'expiresAt',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true, recoveryPeriodInDays: 7 },
    });
    intake.addGlobalSecondaryIndex({ indexName: 'pending', partitionKey: { name: 'workPk', type: dynamodb.AttributeType.STRING }, sortKey: { name: 'workSk', type: dynamodb.AttributeType.STRING }, projectionType: dynamodb.ProjectionType.ALL });
    const uploads = new s3.Bucket(this, 'PrivateUploads', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, encryption: s3.BucketEncryption.S3_MANAGED, enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN, cors: [{ allowedOrigins: [url.origin], allowedMethods: [s3.HttpMethods.POST], allowedHeaders: ['*'], maxAge: 300 }],
      lifecycleRules: [{ prefix: 'original/', expiration: Duration.days(30), abortIncompleteMultipartUploadAfter: Duration.days(1) }],
    });
    const pool = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: false, signInAliases: { email: true }, autoVerify: { email: true },
      featurePlan: cognito.FeaturePlan.ESSENTIALS, removalPolicy: RemovalPolicy.RETAIN,
      mfa: cognito.Mfa.OPTIONAL, mfaSecondFactor: { otp: true, sms: false }, accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: { minLength: 14, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: true },
    });
    const client = pool.addClient('Web', { generateSecret: false, preventUserExistenceErrors: true, enableTokenRevocation: true,
      accessTokenValidity: Duration.minutes(15), idTokenValidity: Duration.minutes(15), refreshTokenValidity: Duration.days(7),
      oAuth: { flows: { authorizationCodeGrant: true }, scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE], callbackUrls: [props.frontendUrl], logoutUrls: [props.frontendUrl] },
    });
    const domain = pool.addDomain('Login', { cognitoDomain: { domainPrefix: `money-stalker-${this.account}-${this.region}` } });
    const dlq = new sqs.Queue(this, 'DeadLetters', { retentionPeriod: Duration.days(14), encryption: sqs.QueueEncryption.SQS_MANAGED });
    const queue = new sqs.Queue(this, 'Work', { visibilityTimeout: Duration.minutes(6), retentionPeriod: Duration.days(4), encryption: sqs.QueueEncryption.SQS_MANAGED, deadLetterQueue: { queue: dlq, maxReceiveCount: 3 } });
    const make = (id: string, handler: string, seconds: number) => new NodejsFunction(this, id, {
      entry: 'server/handlers.ts', handler, runtime: lambda.Runtime.NODEJS_22_X, architecture: lambda.Architecture.ARM_64,
      memorySize: 512, timeout: Duration.seconds(seconds),
      logGroup: new logs.LogGroup(this, `${id}Logs`, { retention: logs.RetentionDays.ONE_WEEK, removalPolicy: RemovalPolicy.DESTROY }),
      bundling: { minify: true, sourceMap: false, externalModules: [], target: 'node22' },
      environment: { LEDGER_TABLE: ledger.tableName, INTAKE_TABLE: intake.tableName, UPLOAD_BUCKET: uploads.bucketName, WORK_QUEUE_URL: queue.queueUrl },
    });
    const http = make('API', 'http', 29), worker = make('Worker', 'work', 60), dispatcher = make('Dispatcher', 'dispatch', 30), recovery = make('Recovery', 'recover', 60);
    for (const fn of [http, worker]) { ledger.grantReadWriteData(fn); intake.grantReadWriteData(fn); uploads.grantReadWrite(fn); }
    intake.grantReadData(recovery); queue.grantSendMessages(recovery); queue.grantSendMessages(dispatcher);
    dispatcher.addEventSource(new DynamoEventSource(intake, { startingPosition: lambda.StartingPosition.TRIM_HORIZON, batchSize: 10, retryAttempts: 3, bisectBatchOnError: true, reportBatchItemFailures: true,
      filters: [lambda.FilterCriteria.filter({ eventName: lambda.FilterRule.isEqual('INSERT'), dynamodb: { NewImage: { workPk: { S: lambda.FilterRule.isEqual('PENDING') } } } })] }));
    worker.addEventSource(new SqsEventSource(queue, { batchSize: 1, reportBatchItemFailures: true }));
    new events.Rule(this, 'DailyRecovery', { schedule: events.Schedule.rate(Duration.days(1)), targets: [new LambdaFunction(recovery, { retryAttempts: 1 })] });
    const api = new apigw.HttpApi(this, 'HttpAPI', {
      corsPreflight: { allowOrigins: [url.origin], allowHeaders: ['authorization', 'content-type'], allowMethods: [apigw.CorsHttpMethod.OPTIONS, apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.PATCH, apigw.CorsHttpMethod.DELETE], exposeHeaders: ['content-disposition'], maxAge: Duration.minutes(5) },
    });
    const stage = api.defaultStage!.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingBurstLimit: 10, throttlingRateLimit: 2 };
    const integration = new HttpLambdaIntegration('APIIntegration', http);
    api.addRoutes({ path: '/capture-events', methods: [apigw.HttpMethod.POST], integration });
    const authorizer = new HttpUserPoolAuthorizer('UserAuthorizer', pool, { userPoolClients: [client] });
    api.addRoutes({ path: '/{proxy+}', methods: [apigw.HttpMethod.OPTIONS], integration });
    api.addRoutes({ path: '/{proxy+}', methods: [apigw.HttpMethod.ANY], integration, authorizer, authorizationScopes: ['openid'] });
    if (props.budgetEmail) {
      new budgets.CfnBudget(this, 'MonthlyBudget', {
        budget: { budgetName: 'money-stalker-monthly', budgetType: 'COST', timeUnit: 'MONTHLY', budgetLimit: { amount: 5, unit: 'USD' },
          // Whole-account alerts avoid hiding untagged, tax, or shared-service costs.
        }, notificationsWithSubscribers: [1, 3, 4].map(amount => ({ notification: { comparisonOperator: 'GREATER_THAN', notificationType: 'ACTUAL', threshold: amount, thresholdType: 'ABSOLUTE_VALUE' }, subscribers: [{ subscriptionType: 'EMAIL', address: props.budgetEmail! }] })),
      });
      const topic = new sns.Topic(this, 'Operations'); topic.addSubscription(new subscriptions.EmailSubscription(props.budgetEmail));
      const alarm = new cloudwatch.Alarm(this, 'DeadLetterAlarm', { metric: dlq.metricApproximateNumberOfMessagesVisible(), threshold: 1, evaluationPeriods: 1, comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD });
      alarm.addAlarmAction(new actions.SnsAction(topic));
    }
    new CfnOutput(this, 'FrontendURL', { value: props.frontendUrl });
    new CfnOutput(this, 'APIURL', { value: api.apiEndpoint });
    new CfnOutput(this, 'CognitoAuthority', { value: pool.userPoolProviderUrl });
    new CfnOutput(this, 'CognitoClientID', { value: client.userPoolClientId });
    new CfnOutput(this, 'CognitoDomain', { value: domain.baseUrl() });
    new CfnOutput(this, 'UserPoolID', { value: pool.userPoolId });
    new CfnOutput(this, 'LedgerTableName', { value: ledger.tableName });
    new CfnOutput(this, 'IntakeTableName', { value: intake.tableName });
    new CfnOutput(this, 'DeadLetterQueueURL', { value: dlq.queueUrl });
  }
}
