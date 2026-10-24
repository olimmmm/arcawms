/**
 * Native Web API Gzip Compression Utilities
 * Supported across all modern mobile & desktop browsers (Safari 16.4+, Chrome 80+, Firefox 113+, Node 18+)
 */

export function isGzipSupported(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

/**
 * Robust, stack-safe Uint8Array to Base64 conversion
 * Uses 8192-byte chunks to stay well within JavaScriptCore / iOS argument limits
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192; // Safe chunk size below JS argument stack limits across all mobile engines
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as any);
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
  const blob = await new Response(stream).blob();

  // Primary fast path in browsers: native FileReader DataURL (handles multi-megabyte blobs in browser C++ code)
  if (typeof FileReader !== 'undefined') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        try {
          const res = reader.result as string;
          const commaIdx = res.indexOf(',');
          resolve(commaIdx >= 0 ? res.substring(commaIdx + 1) : res);
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(reader.error || new Error('FileReader error during compression'));
      reader.readAsDataURL(blob);
    });
  }

  // Fallback for Node.js / non-DOM environments
  const buffer = await blob.arrayBuffer();
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }
  return uint8ArrayToBase64(new Uint8Array(buffer));
}

export async function decompressGzip(base64Str: string): Promise<string> {
  // If running in Node.js
  if (typeof Buffer !== 'undefined' && typeof window === 'undefined') {
    const rawBuffer = Buffer.from(base64Str, 'base64');
    const decompStream = new Blob([rawBuffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(decompStream).text();
  }

  const bytes = base64ToUint8Array(base64Str);
  const stream = new Blob([bytes as any]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

