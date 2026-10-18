import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { DomainError } from '../domain/model';
import { MAX_FILE_BYTES } from './imports';
export interface Files {
  get(key: string): Promise<Uint8Array>; put(key: string, bytes: Uint8Array, type?: string): Promise<void>;
  upload(key: string): Promise<{ url: string; fields: Record<string, string>; local?: boolean }>;
}
export class MemoryFiles implements Files {
  values = new Map<string, Uint8Array>();
  async get(key: string) { const data = this.values.get(key); if (!data) throw new DomainError('Archivo no disponible', 404); return data; }
  async put(key: string, bytes: Uint8Array) { this.values.set(key, bytes); }
  async upload(key: string) { return { url: '/api/local-upload', fields: { key }, local: true }; }
}
const s3 = new S3Client({});
export class S3Files implements Files {
  constructor(private bucket = process.env.UPLOAD_BUCKET!) {}
  async get(key: string) {
    const result = await s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if ((result.ContentLength ?? 0) > 20 * 1024 * 1024) throw new DomainError('Archivo demasiado grande');
    return await result.Body!.transformToByteArray();
  }
  async put(key: string, bytes: Uint8Array, type = 'application/json') { await s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: type, CacheControl: 'no-store', ServerSideEncryption: 'AES256' })); }
  async upload(key: string) {
    return await createPresignedPost(s3, { Bucket: this.bucket, Key: key, Expires: 300,
      Fields: { 'x-amz-server-side-encryption': 'AES256' }, Conditions: [['content-length-range', 1, MAX_FILE_BYTES], ['eq', '$x-amz-server-side-encryption', 'AES256']] });
  }
}
