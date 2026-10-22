/**
 * Native Web API Gzip Compression Utilities
 * Supported across all modern mobile & desktop browsers (Safari 16.4+, Chrome 80+, Firefox 113+, Node 18+)
 */

export function isGzipSupported(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

export async function compressGzip(inputStr: string): Promise<Uint8Array> {
  const stream = new Blob([inputStr]).stream().pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function decompressGzip(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  const stream = new Blob([buffer as any]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}
