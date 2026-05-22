import { createHash } from 'crypto';
export async function sha256Hex(input: string): Promise<string> {
  return createHash('sha256').update(input).digest('hex');
}