/**
 * The few browser type names that files the server imports mention, declared
 * for a Node typecheck. The server is typechecked without the DOM library on
 * purpose — with it, `Uint8Array` and `BufferSource` stop agreeing with Node's
 * own WebCrypto types — so these stand in for the handful of DOM names that
 * `supabase/functions/_shared/webpush.ts` and `web/src/lib/zip.ts` use. Only
 * the shapes those files touch are declared; `FileReader` never runs on Node
 * (the zip reader uses `Blob.arrayBuffer`, which Node has).
 */
type JsonWebKey = import("node:crypto").webcrypto.JsonWebKey;
type BlobPart = ArrayBuffer | Blob | import("node:crypto").BinaryLike;

declare class FileReader {
  result: string | ArrayBuffer | null;
  error: Error | null;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  readAsArrayBuffer(blob: Blob): void;
}
