/**
 * Native Web API Gzip Compression Utilities
 * Supported across all modern mobile & desktop browsers (Safari 16.4+, Chrome 80+, Firefox 113+, Node 18+)
 */

/**
 * Native Web API Gzip Compression Utilities
 * Supported across all modern mobile & desktop browsers (Safari 16.4+, Chrome 80+, Firefox 113+, Node 18+)
 */

export function isGzipSupported(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 32768; // Safe chunk size below JS argument stack limits
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + chunkSize, len)) as any
    );
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function compressGzip(inputStr: string): Promise<string> {
  const stream = new Blob([inputStr]).stream().pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return uint8ArrayToBase64(new Uint8Array(buffer));
}

export async function decompressGzip(base64Str: string): Promise<string> {
  const bytes = base64ToUint8Array(base64Str);
  const stream = new Blob([bytes as any]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}
