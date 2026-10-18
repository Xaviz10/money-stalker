import type { APIGatewayProxyEventV2WithJWTAuthorizer, DynamoDBStreamEvent, SQSEvent } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createAPI } from './api';
import { DynamoRepository, type Job } from './repository';
import { S3Files } from './storage';
import { processJob } from './processing';
const repo = new DynamoRepository(), files = new S3Files(), api = createAPI(repo, files), sqs = new SQSClient({});
export async function http(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  let body: unknown;
  try {
    const text = event.body ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8').toString('utf8') : '';
    if (Buffer.byteLength(text) > 16384) return { statusCode: 413, body: JSON.stringify({ error: 'Solicitud demasiado grande' }) };
    body = text ? JSON.parse(text) : undefined;
  } catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) }; }
  const result = await api({ method: event.requestContext.http.method, path: event.rawPath,
    body, query: event.queryStringParameters, token: event.headers.authorization?.replace(/^Bearer /i, ''),
    subject: event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined });
  const binary = Buffer.isBuffer(result.body);
  return { statusCode: result.status, headers: { 'content-type': result.type ?? 'application/json', 'cache-control': 'no-store',
    ...(result.filename ? { 'content-disposition': `attachment; filename="${result.filename}"` } : {}) },
    body: binary ? (result.body as Buffer).toString('base64') : JSON.stringify(result.body), isBase64Encoded: binary };
}
const send = (householdId: string, id: string) => sqs.send(new SendMessageCommand({ QueueUrl: process.env.WORK_QUEUE_URL!, MessageBody: JSON.stringify({ householdId, id }) }));
export async function dispatch(event: DynamoDBStreamEvent) {
  const failed: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    const image = record.dynamodb?.NewImage;
    if (record.eventName !== 'INSERT' || image?.workPk?.S !== 'PENDING') continue;
    try { await send(image.pk.S!.slice(2), image.sk.S!.slice(4)); }
    catch { failed.push({ itemIdentifier: record.dynamodb!.SequenceNumber! }); }
  }
  return { batchItemFailures: failed };
}
export async function work(event: SQSEvent) {
  const failed: { itemIdentifier: string }[] = [];
  for (const record of event.Records) try {
    const { householdId, id } = JSON.parse(record.body) as { householdId: string; id: string };
    await processJob(repo, files, householdId, id);
  } catch { failed.push({ itemIdentifier: record.messageId }); }
  return { batchItemFailures: failed };
}
export async function recover() {
  const jobs: Job[] = await repo.pendingJobs();
  for (const job of jobs) await send(job.householdId, job.id);
  return { queued: jobs.length };
}
