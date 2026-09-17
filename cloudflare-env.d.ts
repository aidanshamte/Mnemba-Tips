declare namespace Cloudflare {
  interface Env {
    MNEMBA_RUNTIME_MODE?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
