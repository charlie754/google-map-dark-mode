/**
 * A minimal Firefox Remote Debugging Protocol (RDP) client.
 *
 * Why this exists: side-loading an unsigned XPI into `<profile>/extensions/` no
 * longer works on modern Gecko (the previous lane proved Firefox never even
 * records the add-on in `extensions.json` -- only `app-builtin` locations are
 * ever scanned). The supported route for an unsigned, unpacked add-on is the
 * DevTools `installTemporaryAddon` request, which is exactly what `web-ext run`
 * issues under the hood. Speaking RDP directly means the browser can still be a
 * Playwright-launched one, so `page.mouse.*` keeps working -- `web-ext run`
 * hands back a browser nothing can drive.
 *
 * Wire format (devtools/shared/transport): `<byteLength>:<utf8-json>`, framed on
 * a plain TCP socket. Each packet carries a `from` field naming the actor that
 * sent it. Requests to one actor must be serialised; requests to different
 * actors may overlap. Packets with no matching pending request are unsolicited
 * notifications and are buffered for inspection.
 */

import net from 'node:net';

export class RdpClient {
  constructor() {
    this.socket = null;
    /** @type {Map<string, Array<{resolve: Function, reject: Function}>>} */
    this.pending = new Map();
    /** @type {object[]} */
    this.notifications = [];
    this.buffer = Buffer.alloc(0);
    this.rootPacket = null;
    this.closed = false;
    this.traffic = [];
  }

  connect(port, host = '127.0.0.1', { timeoutMs = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ port, host });
      this.socket = sock;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        sock.destroy();
        reject(new Error(`RDP connect timed out after ${timeoutMs}ms on ${host}:${port}`));
      }, timeoutMs);

      sock.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
          return;
        }
        this._failAll(err);
      });

      sock.on('close', () => {
        this.closed = true;
        this._failAll(new Error('RDP socket closed'));
      });

      sock.on('data', (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this._drain();
        // The server greets with the root actor's packet; that is our "connected".
        if (!settled && this.rootPacket) {
          settled = true;
          clearTimeout(timer);
          resolve(this.rootPacket);
        }
      });
    });
  }

  _drain() {
    for (;;) {
      const colon = this.buffer.indexOf(0x3a); // ':'
      if (colon < 0) return;
      const lenStr = this.buffer.subarray(0, colon).toString('ascii');
      if (!/^\d+$/.test(lenStr)) throw new Error(`bad RDP length prefix: ${JSON.stringify(lenStr)}`);
      const len = Number(lenStr);
      if (this.buffer.length < colon + 1 + len) return;
      const body = this.buffer.subarray(colon + 1, colon + 1 + len).toString('utf8');
      this.buffer = this.buffer.subarray(colon + 1 + len);
      let packet;
      try {
        packet = JSON.parse(body);
      } catch {
        this.notifications.push({ __unparsable: body });
        continue;
      }
      this._dispatch(packet);
    }
  }

  _dispatch(packet) {
    this.traffic.push({ dir: 'in', packet });
    if (!this.rootPacket && packet.from === 'root') this.rootPacket = packet;
    const queue = this.pending.get(packet.from);
    if (queue && queue.length) {
      const { resolve, reject } = queue.shift();
      if (packet.error) reject(Object.assign(new Error(`${packet.error}: ${packet.message ?? ''}`), { packet }));
      else resolve(packet);
      return;
    }
    this.notifications.push(packet);
  }

  _failAll(err) {
    for (const [, queue] of this.pending) {
      while (queue.length) queue.shift().reject(err);
    }
    this.pending.clear();
  }

  request(message, { timeoutMs = 30000 } = {}) {
    if (!this.socket || this.closed) return Promise.reject(new Error('RDP socket not open'));
    const to = message.to;
    if (!to) return Promise.reject(new Error('RDP request needs a `to` actor'));
    return new Promise((resolve, reject) => {
      const queue = this.pending.get(to) ?? [];
      const timer = setTimeout(() => {
        reject(new Error(`RDP request timed out: ${JSON.stringify(message).slice(0, 200)}`));
      }, timeoutMs);
      queue.push({
        resolve: (p) => {
          clearTimeout(timer);
          resolve(p);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.pending.set(to, queue);
      const json = Buffer.from(JSON.stringify(message), 'utf8');
      this.traffic.push({ dir: 'out', packet: message });
      this.socket.write(`${json.length}:`);
      this.socket.write(json);
    });
  }

  close() {
    try {
      this.socket?.end();
      this.socket?.destroy();
    } catch {
      /* nothing useful to do */
    }
    this.closed = true;
  }
}

/** Poll-connect: the debugger server takes a moment to bind after launch. */
export async function connectWithRetry(port, { attempts = 40, delayMs = 500 } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    const client = new RdpClient();
    try {
      const root = await client.connect(port, '127.0.0.1', { timeoutMs: 4000 });
      return { client, root, attempt: i + 1 };
    } catch (err) {
      lastErr = err;
      client.close();
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`could not reach the Firefox debugger server on 127.0.0.1:${port} after ${attempts} attempts: ${lastErr?.message}`);
}

/**
 * Install an unpacked, unsigned add-on into a running Firefox.
 * @returns {Promise<{addon: object, addonsActor: string, listed: object[]}>}
 */
export async function installTemporaryAddon(client, addonPath) {
  const rootReply = await client.request({ to: 'root', type: 'getRoot' });
  const addonsActor = rootReply.addonsActor;
  if (!addonsActor) {
    throw new Error(
      `root actor exposes no addonsActor; getRoot returned keys [${Object.keys(rootReply).join(', ')}]`
    );
  }
  const installed = await client.request({
    to: addonsActor,
    type: 'installTemporaryAddon',
    addonPath,
    openDevTools: false,
  });
  const listed = await client.request({ to: 'root', type: 'listAddons' });
  return { addon: installed.addon ?? installed, addonsActor, listed: listed.addons ?? [], rootReply };
}
