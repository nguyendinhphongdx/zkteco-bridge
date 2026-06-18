// ZK protocol TCP client — minimal subset for our use case.
//
// Why a custom one (vs node-zklib / zkteco-js):
//   - Both libs have a hardcoded 10s per-packet timeout for getAttendances,
//     which the constructor's `inport` argument doesn't reach.
//   - More critically, both libs request EVERY chunk up-front in a tight
//     for-loop without awaiting. Some ZK firmwares drop requests pipelined
//     too eagerly — only chunk 1 gets answered, then the device falls
//     silent until our timer fires "TIME OUT !! N PACKETS REMAIN !".
//
// This client requests chunks SEQUENTIALLY: send → wait full chunk →
// next. Slower for tiny logs but reliable for thousands of records.
//
// Wire format (TCP-tunnelled UDP-style ZK protocol):
//   [magic 4][len 2][zero 2]   ← 8-byte TCP header
//   [cmd 2][checksum 2][session 2][replyId 2][payload...]
//
// References:
//   - constants pulled from node-zklib's source for compatibility
//   - record decoder matches `decodeRecordData40` (40 bytes per record)

import { Socket } from 'net';
import type { ZkAttendanceRecord } from '../poll/types';

// ── command codes ────────────────────────────────────────────────────────

const CMD = {
  CONNECT: 1000,
  EXIT: 1001,
  ENABLE_DEVICE: 1002,
  DISABLE_DEVICE: 1003,
  FREE_DATA: 1502,
  DATA_WRRQ: 1503,
  DATA_RDY: 1504,
  PREPARE_DATA: 1500,
  DATA: 1501,
  GET_FREE_SIZES: 50,
  ACK_OK: 2000,
} as const;

const TCP_MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d, 0x13, 0x00, 0x00, 0x00]);
const MAX_CHUNK = 65472;
const USHRT_MAX = 65535;
const REQ_GET_ATTENDANCE_LOGS = Buffer.from([
  0x01, 0x0d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const REQ_DISABLE_DEVICE = Buffer.from([0, 0, 0, 0]);

// ── protocol helpers ─────────────────────────────────────────────────────

function checksum(buf: Buffer): number {
  let chk = 0;
  for (let i = 0; i < buf.length; i += 2) {
    chk = (chk + (i === buf.length - 1 ? buf[i] : buf.readUInt16LE(i))) % USHRT_MAX;
  }
  return USHRT_MAX - chk - 1;
}

function buildPacket(cmd: number, sessionId: number, replyId: number, data: Buffer): Buffer {
  const payload = Buffer.alloc(8 + data.length);
  payload.writeUInt16LE(cmd, 0);
  payload.writeUInt16LE(0, 2); // checksum slot
  payload.writeUInt16LE(sessionId, 4);
  payload.writeUInt16LE(replyId, 6);
  data.copy(payload, 8);
  payload.writeUInt16LE(checksum(payload), 2);
  // Mimic node-zklib's "bug": bump replyId in the wire AFTER the
  // checksum is computed. Some ZK firmwares apparently expect this
  // post-bump value (or just don't validate checksum at all). Match the
  // exact bytes that `node-zklib` puts on the wire so device replies.
  payload.writeUInt16LE((replyId + 1) % USHRT_MAX, 6);

  const wire = Buffer.alloc(TCP_MAGIC.length + payload.length);
  TCP_MAGIC.copy(wire, 0);
  wire.writeUInt16LE(payload.length, 4);
  payload.copy(wire, TCP_MAGIC.length);
  return wire;
}

interface ParsedHeader {
  commandId: number;
  checksum: number;
  sessionId: number;
  replyId: number;
  payloadSize: number;
}

function parseTcpHeader(buf: Buffer): ParsedHeader {
  // Outer 8 bytes magic+len, then 8 bytes ZK header.
  return {
    payloadSize: buf.readUInt16LE(4),
    commandId: buf.readUInt16LE(8),
    checksum: buf.readUInt16LE(10),
    sessionId: buf.readUInt16LE(12),
    replyId: buf.readUInt16LE(14),
  };
}

function stripTcpMagic(buf: Buffer): Buffer {
  if (buf.length < 8 || buf.compare(TCP_MAGIC, 0, 4, 0, 4) !== 0) return buf;
  return buf.subarray(8);
}

function parseRecord40(rec: Buffer): ZkAttendanceRecord {
  return {
    userSn: rec.readUIntLE(0, 2),
    deviceUserId: rec
      .subarray(2, 11)
      .toString('ascii')
      .split('\0')
      .shift() ?? '',
    recordTime: parseTimestamp(rec.readUInt32LE(27)),
    state: rec[26],
  };
}

function parseTimestamp(t: number): Date {
  const second = t % 60;
  t = (t - second) / 60;
  const minute = t % 60;
  t = (t - minute) / 60;
  const hour = t % 24;
  t = (t - hour) / 24;
  const day = (t % 31) + 1;
  t = (t - (day - 1)) / 31;
  const month = t % 12;
  t = (t - month) / 12;
  const year = t + 2000;
  return new Date(year, month, day, hour, minute, second);
}

// ── connection-level packet stream ───────────────────────────────────────

interface ZkClientOptions {
  host: string;
  port: number;
  /** TCP socket connect timeout (ms). Default 60s. */
  connectTimeoutMs?: number;
  /** Per-packet receive timeout for non-streaming commands. Default 30s. */
  commandTimeoutMs?: number;
  /** Per-chunk receive timeout during getAttendances stream. Default 60s. */
  chunkTimeoutMs?: number;
  /** Max retries when a chunk times out. Default 2. */
  chunkRetries?: number;
  /** Optional log fn for protocol-level events. */
  log?: (msg: string) => void;
}

export class ZkClient {
  private readonly host: string;
  private readonly port: number;
  private readonly connectTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly chunkTimeoutMs: number;
  private readonly chunkRetries: number;
  private readonly log: (msg: string) => void;

  private socket: Socket | null = null;
  private sessionId = 0;
  private replyId = 0;
  /** Pending data resolver for the current command. Null when not waiting. */
  private waiter: {
    resolve: (buf: Buffer) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  /** Inbound buffer — TCP can split/merge packets. We accumulate until a
   *  full ZK packet (length from header) is available, then flush. */
  private rxBuffer = Buffer.alloc(0);

  constructor(opts: ZkClientOptions) {
    this.host = opts.host;
    this.port = opts.port;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 60_000;
    this.commandTimeoutMs = opts.commandTimeoutMs ?? 30_000;
    this.chunkTimeoutMs = opts.chunkTimeoutMs ?? 60_000;
    this.chunkRetries = opts.chunkRetries ?? 2;
    this.log = opts.log ?? (() => {});
  }

  // ── socket lifecycle ──────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.log(`[zk] opening socket to ${this.host}:${this.port}`);
    await this.openSocket();
    this.log(`[zk] socket open, sending CMD_CONNECT`);
    const reply = await this.executeCmd(CMD.CONNECT, Buffer.alloc(0), this.commandTimeoutMs);
    if (!reply || reply.length < 6) throw new Error('NO_REPLY_ON_CMD_CONNECT');
    // Session id sits at offset 4 of the ZK payload (after cmd+chk+session+reply
    // header). After we strip the 16-byte outer header, that's offset 4 of body.
    this.sessionId = reply.readUInt16LE(4);
    this.log(`[zk] connected, sessionId=${this.sessionId}`);
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = new Socket();
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error(`Connect timeout after ${this.connectTimeoutMs}ms`));
      }, this.connectTimeoutMs);
      sock.once('connect', () => {
        clearTimeout(timer);
        this.socket = sock;
        sock.on('data', (chunk) => this.onData(chunk));
        sock.on('close', () => this.onSocketClose());
        sock.on('error', () => {
          // Errors are already surfaced via waiter rejection or close.
        });
        resolve();
      });
      sock.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      sock.connect(this.port, this.host);
    });
  }

  private onSocketClose(): void {
    this.socket = null;
    if (this.waiter) {
      this.waiter.reject(new Error('Socket closed unexpectedly'));
      clearTimeout(this.waiter.timer);
      this.waiter = null;
    }
  }

  /**
   * Aggregate inbound TCP bytes into ZK packets and hand each completed
   * packet to the current waiter. ZK framing:
   *   [TCP_MAGIC 8][ZK_PAYLOAD payload_size]
   * The ZK payload is itself [cmd 2][chk 2][session 2][reply 2][data...].
   */
  private onData(chunk: Buffer): void {
    this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);
    while (this.rxBuffer.length >= 8) {
      const payloadSize = this.rxBuffer.readUInt16LE(4);
      const totalSize = 8 + payloadSize;
      if (this.rxBuffer.length < totalSize) return;
      const packet = this.rxBuffer.subarray(0, totalSize);
      this.rxBuffer = this.rxBuffer.subarray(totalSize);
      this.deliverPacket(packet);
    }
  }

  private deliverPacket(packet: Buffer): void {
    if (!this.waiter) return; // unsolicited / late — drop
    const w = this.waiter;
    this.waiter = null;
    clearTimeout(w.timer);
    w.resolve(packet);
  }

  private waitForPacket(timeoutMs: number): Promise<Buffer> {
    if (this.waiter) {
      return Promise.reject(new Error('A waiter is already pending'));
    }
    return new Promise<Buffer>((resolve, reject) => {
      // Closure-capture the waiter ref so a stale timer (whose
      // `clearTimeout` was called but already queued for execution)
      // can't clobber a newer waiter. Only act if we're still active.
      let self: NonNullable<ZkClient['waiter']>;
      const timer = setTimeout(() => {
        if (this.waiter !== self) return;
        this.waiter = null;
        reject(new Error(`Timeout waiting for ZK reply (${timeoutMs}ms)`));
      }, timeoutMs);
      self = { resolve, reject, timer };
      this.waiter = self;
    });
  }

  /**
   * Send a command frame and wait for one reply packet (any cmd id).
   * Return value is the FULL packet buffer (including 8-byte TCP magic).
   */
  private async executeCmd(
    cmd: number,
    data: Buffer,
    timeoutMs: number,
  ): Promise<Buffer> {
    if (!this.socket) throw new Error('Not connected');
    if (cmd === CMD.CONNECT) {
      this.sessionId = 0;
      this.replyId = 0;
    } else {
      this.replyId = (this.replyId + 1) % USHRT_MAX;
    }
    const frame = buildPacket(cmd, this.sessionId, this.replyId, data);
    const wait = this.waitForPacket(timeoutMs);
    try {
      this.socket.write(frame);
    } catch (err) {
      // Write failed before reply arrives → orphan waiter. Defuse so its
      // 60s timer doesn't crash us as an unhandled rejection later.
      this.cancelOrphanWaiter(wait);
      throw err;
    }
    const packet = await wait;
    return stripTcpMagic(packet);
  }

  /**
   * Send a chunk request without waiting (caller waits separately). Used
   * inside the streaming loop so we can sequence `send → recv → send`
   * cleanly.
   */
  private sendChunkRequest(start: number, size: number): void {
    if (!this.socket) throw new Error('Not connected');
    this.replyId = (this.replyId + 1) % USHRT_MAX;
    const data = Buffer.alloc(8);
    data.writeUInt32LE(start, 0);
    data.writeUInt32LE(size, 4);
    const frame = buildPacket(CMD.DATA_RDY, this.sessionId, this.replyId, data);
    this.socket.write(frame);
  }

  // ── public commands ───────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    if (this.socket) {
      try {
        await this.executeCmd(CMD.EXIT, Buffer.alloc(0), 2_000);
      } catch {
        // best-effort
      }
      try {
        this.socket.end();
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }

  async getInfo(): Promise<{
    userCounts: number;
    logCounts: number;
    logCapacity: number;
  }> {
    const reply = await this.executeCmd(CMD.GET_FREE_SIZES, Buffer.alloc(0), this.commandTimeoutMs);
    return {
      userCounts: reply.readUIntLE(24, 4),
      logCounts: reply.readUIntLE(40, 4),
      logCapacity: reply.readUIntLE(72, 4),
    };
  }

  async disableDevice(): Promise<void> {
    await this.executeCmd(CMD.DISABLE_DEVICE, REQ_DISABLE_DEVICE, this.commandTimeoutMs);
  }

  async enableDevice(): Promise<void> {
    await this.executeCmd(CMD.ENABLE_DEVICE, Buffer.alloc(0), this.commandTimeoutMs);
  }

  private async freeData(): Promise<void> {
    await this.executeCmd(CMD.FREE_DATA, Buffer.alloc(0), this.commandTimeoutMs);
  }

  /**
   * Pull all attendance records. Sequential chunk fetch — request chunk
   * N, await its data, repeat. Retries on chunk timeout up to
   * `chunkRetries` times before giving up with `partial = true`.
   */
  async getAttendances(
    onProgress?: (received: number, total: number) => void,
  ): Promise<{ data: ZkAttendanceRecord[]; partial: boolean; partialReason: string | null }> {
    this.log(`[zk] freeData (pre-fetch)`);
    await this.freeData();

    // 1. Kick off the data stream. Reply is either CMD_DATA (small payload
    //    fits in one packet) or CMD_PREPARE_DATA (multi-chunk follows).
    this.log(`[zk] sending DATA_WRRQ (GET_ATTENDANCE_LOGS)`);
    const initReply = await this.executeCmd(
      CMD.DATA_WRRQ,
      REQ_GET_ATTENDANCE_LOGS,
      this.commandTimeoutMs,
    );
    this.log(`[zk] DATA_WRRQ replied ${initReply.length} bytes, cmd=${initReply.readUInt16LE(0)}`);
    if (initReply.length < 8) {
      throw new Error('Empty reply for DATA_WRRQ');
    }
    const initCmdId = initReply.readUInt16LE(0);

    let recordsBytes: Buffer;
    let partial = false;
    let partialReason: string | null = null;

    if (initCmdId === CMD.DATA) {
      // Small dataset — payload is in this single packet (after the
      // 8-byte ZK header inside the stripped packet).
      recordsBytes = initReply.subarray(8);
    } else if (initCmdId === CMD.ACK_OK || initCmdId === CMD.PREPARE_DATA) {
      // Multi-chunk path. The first 4 bytes of payload after header are
      // status, then a UInt32LE size at offset 1.
      const meta = initReply.subarray(8);
      const totalSize = meta.readUIntLE(1, 4);
      const numFullChunks = Math.floor(totalSize / MAX_CHUNK);
      const remainder = totalSize % MAX_CHUNK;
      const totalChunks = numFullChunks + (remainder > 0 ? 1 : 0);

      const buffers: Buffer[] = [];
      let receivedSize = 0;

      for (let i = 0; i < totalChunks; i++) {
        const start = i * MAX_CHUNK;
        const size = i === numFullChunks - (remainder === 0 ? 1 : 0) && remainder === 0
          ? MAX_CHUNK
          : i === totalChunks - 1
            ? remainder || MAX_CHUNK
            : MAX_CHUNK;

        const chunk = await this.fetchChunk(i, start, size);
        if (chunk.err) {
          partial = true;
          partialReason = chunk.err;
          this.log(`[zk] chunk ${i + 1}/${totalChunks} failed: ${chunk.err}`);
          break;
        }
        // chunk.data is already the chunk's record bytes — fetchChunk
        // dropped the PREPARE_DATA subheader and the CMD_DATA frame's ZK
        // header for us. Concatenate as-is.
        buffers.push(chunk.data);
        receivedSize += chunk.data.length;
        onProgress?.(receivedSize, totalSize);
      }

      recordsBytes = Buffer.concat(buffers);
    } else {
      throw new Error(`Unexpected reply for DATA_WRRQ: cmd=${initCmdId}`);
    }

    await this.freeData().catch(() => {
      // best-effort cleanup
    });

    // First 4 bytes of recordsBytes are a record-count header — skip them.
    let cursor = recordsBytes.subarray(4);
    const records: ZkAttendanceRecord[] = [];
    const RECORD_SIZE = 40;
    while (cursor.length >= RECORD_SIZE) {
      records.push(parseRecord40(cursor.subarray(0, RECORD_SIZE)));
      cursor = cursor.subarray(RECORD_SIZE);
    }
    return { data: records, partial, partialReason };
  }

  /**
   * Send a chunk request and wait for the matching reply. Per ZK protocol,
   * each chunk arrives as TWO logical packets:
   *   1. CMD_PREPARE_DATA — 8-byte payload (chunk-level subheader, drop)
   *   2. CMD_DATA         — actual chunk bytes
   * For small datasets the device sends CMD_DATA directly. Returns the
   * record bytes (CMD_DATA payload, no headers).
   *
   * Retries on timeout up to `chunkRetries` times.
   */
  private async fetchChunk(
    index: number,
    start: number,
    size: number,
  ): Promise<{ data: Buffer; err: string | null }> {
    let lastErr: string | null = null;
    for (let attempt = 0; attempt <= this.chunkRetries; attempt++) {
      let wait1: Promise<Buffer> | null = null;
      try {
        wait1 = this.waitForPacket(this.chunkTimeoutMs);
        this.sendChunkRequest(start, size);
        const pkt1 = await wait1;
        wait1 = null;
        const zk1 = stripTcpMagic(pkt1);
        const cmd1 = zk1.readUInt16LE(0);

        if (cmd1 === CMD.DATA) {
          return { data: zk1.subarray(8), err: null };
        }
        if (cmd1 !== CMD.PREPARE_DATA && cmd1 !== CMD.ACK_OK) {
          throw new Error(`Unexpected cmd ${cmd1} for chunk ${index} (expected PREPARE_DATA)`);
        }

        // Wait for the actual CMD_DATA that follows PREPARE_DATA.
        const pkt2 = await this.waitForPacket(this.chunkTimeoutMs);
        const zk2 = stripTcpMagic(pkt2);
        const cmd2 = zk2.readUInt16LE(0);
        if (cmd2 !== CMD.DATA) {
          throw new Error(`Expected CMD_DATA after PREPARE for chunk ${index}, got ${cmd2}`);
        }
        return { data: zk2.subarray(8), err: null };
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        this.log(
          `[zk] chunk ${index + 1} attempt ${attempt + 1}/${this.chunkRetries + 1} failed: ${lastErr}`,
        );
        // If sendChunkRequest threw before we could await wait1, the waiter's
        // 60s timer is still armed. Cancel it + swallow the late rejection
        // so it doesn't surface as an unhandledRejection (process crash).
        this.cancelOrphanWaiter(wait1);
      }
    }
    return { data: Buffer.alloc(0), err: lastErr ?? 'unknown chunk error' };
  }

  /**
   * Defuse a waitForPacket promise that we created but never awaited (e.g.
   * because sendChunkRequest threw synchronously). Clears the timer so it
   * cannot reject 60s later, and attaches a noop catch so any in-flight
   * rejection is treated as handled.
   */
  private cancelOrphanWaiter(p: Promise<Buffer> | null): void {
    if (!p) return;
    if (this.waiter) {
      clearTimeout(this.waiter.timer);
      this.waiter = null;
    }
    p.catch(() => {});
  }
}

// ── high-level API matching the existing zk-client.ts surface ────────────

export async function fetchAttendances(
  host: string,
  port: number,
): Promise<{ data: ZkAttendanceRecord[]; err: string | null }> {
  // Per-step trace into stdout so poll.ts log shows exactly which command
  // hangs when the device misbehaves.
  const client = new ZkClient({
    host,
    port,
    log: (msg) => console.log(msg),
  });
  try {
    await client.connect();
    const { data, partial, partialReason } = await client.getAttendances();
    return { data, err: partial ? partialReason : null };
  } catch (err) {
    return { data: [], err: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      await client.disconnect();
    } catch {
      // best-effort
    }
  }
}

export async function probeZkDevice(
  host: string,
  port: number,
  connectTimeoutMs = 3_000,
): Promise<{
  reachable: boolean;
  userCount?: number;
  attendanceCount?: number;
  logCapacity?: number;
  error?: string;
}> {
  const client = new ZkClient({ host, port, connectTimeoutMs });
  try {
    await client.connect();
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const info = await client.getInfo();
    return {
      reachable: true,
      userCount: info.userCounts,
      attendanceCount: info.logCounts,
      logCapacity: info.logCapacity,
    };
  } catch {
    return { reachable: true };
  } finally {
    try {
      await client.disconnect();
    } catch {
      // best-effort
    }
  }
}
