/**
 * A four-endpoint stand-in for the Cloud Storage JSON API.
 *
 * `@google-cloud/storage` sends every request to `STORAGE_EMULATOR_HOST` when
 * that variable is set, and skips credentials entirely, so a probe can watch
 * the real client issue real list and delete calls without a service account.
 *
 * This exists for one assertion that cannot be made any other way: that
 * deleting an account deletes the *object* holding the member's photograph, not
 * just the row pointing at it. Asserting on the column is asserting on the part
 * that was never in doubt.
 *
 *   const gcs = await startFakeGcs();
 *   process.env.STORAGE_EMULATOR_HOST = gcs.emulatorHost;   // before require()
 *   gcs.put('bucket', 'member-reference/<id>/reference.jpg', bytes);
 *   gcs.list('bucket', 'member-reference/<id>/')            // -> [names]
 *
 * `gcs.failMode = 'delete'` makes every delete fail, which is how the "we will
 * not erase the account while a photo of them survives" path gets exercised.
 * It answers 401 rather than 503 on purpose: the client retries 5xx with
 * exponential backoff, so a probe asserting on the give-up path would spend
 * half a minute waiting to observe something a permission error shows instantly.
 */
import http from 'node:http';

export async function startFakeGcs({ port = 0 } = {}) {
  /** bucket -> Map(objectName -> Buffer) */
  const buckets = new Map();
  const requests = [];

  const bucketOf = (name) => {
    if (!buckets.has(name)) buckets.set(name, new Map());
    return buckets.get(name);
  };

  const state = {
    failMode: null, // null | 'delete' | 'list'
    requests,
    put(bucket, name, bytes = Buffer.from('jpeg')) {
      bucketOf(bucket).set(name, Buffer.from(bytes));
    },
    list(bucket, prefix = '') {
      return [...bucketOf(bucket).keys()].filter((n) => n.startsWith(prefix)).sort();
    },
    has(bucket, name) {
      return bucketOf(bucket).has(name);
    },
    /** Every list/delete the client actually made, for ordering assertions. */
    calls(kind) {
      return requests.filter((r) => r.kind === kind);
    },
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    // /storage/v1/b/<bucket>/o          list
    // /storage/v1/b/<bucket>/o/<name>   get metadata / delete
    const match = url.pathname.match(/^\/storage\/v1\/b\/([^/]+)\/o(?:\/(.+))?$/);
    if (!match) return json(404, { error: { message: `unhandled ${req.method} ${url.pathname}` } });

    const bucket = decodeURIComponent(match[1]);
    const object = match[2] ? decodeURIComponent(match[2]) : null;

    if (req.method === 'GET' && object === null) {
      requests.push({ kind: 'list', bucket, prefix: url.searchParams.get('prefix') });
      if (state.failMode === 'list') return json(401, { error: { message: 'fake credentials failure' } });

      const prefix = url.searchParams.get('prefix') || '';
      return json(200, {
        kind: 'storage#objects',
        items: state.list(bucket, prefix).map((name) => ({
          kind: 'storage#object',
          id: `${bucket}/${name}`,
          name,
          bucket,
          size: String(bucketOf(bucket).get(name).length),
        })),
      });
    }

    if (req.method === 'GET') {
      requests.push({ kind: 'get', bucket, object });
      if (!state.has(bucket, object)) return json(404, { error: { message: 'Not Found' } });
      return json(200, { kind: 'storage#object', name: object, bucket });
    }

    if (req.method === 'DELETE' && object !== null) {
      requests.push({ kind: 'delete', bucket, object });
      if (state.failMode === 'delete') return json(401, { error: { message: 'fake credentials failure' } });
      if (!bucketOf(bucket).delete(object)) return json(404, { error: { message: 'Not Found' } });
      res.writeHead(204).end();
      return;
    }

    return json(405, { error: { message: `unhandled ${req.method}` } });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = server.address().port;

  // Assign onto `state` rather than spreading it: the server closure reads
  // `state.failMode`, and a copy would leave the caller flipping a flag nothing
  // ever looks at.
  return Object.assign(state, {
    port: actual,
    emulatorHost: `http://127.0.0.1:${actual}/storage/v1`,
    close: () => new Promise((resolve) => server.close(resolve)),
  });
}
