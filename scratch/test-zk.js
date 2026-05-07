// Standalone ZK connectivity test — không phụ thuộc bridge runtime / DB.
// Mục đích: minimal repro để debug khi nghi ngờ partial read, mismatch
// firmware, hoặc compare timing với CLI/UI.
//
// Cách dùng:
//   cd services/zk-bridge
//   node scratch/test-zk.js                    # default 192.168.0.112:4370
//   node scratch/test-zk.js 192.168.1.201      # custom host
//   node scratch/test-zk.js 192.168.1.201 4370 # custom host + port
//
// Yêu cầu: đã `pnpm install` ở zk-bridge (cần node-zklib 1.3+).
//
// node-zklib 1.3 surface (verified): createSocket, getInfo, getUsers,
// getAttendances(ip, onProgress), getRealTimeLogs, clearAttendanceLog,
// disconnect. KHÔNG có getSerialNumber / getDeviceName / getMacAddress
// / getDeviceVersion / getTime — folklore từ 1.x cũ.

const ZKLib = require('node-zklib');

const HOST = process.argv[2] || '192.168.0.112';
const PORT = Number(process.argv[3] || 4370);
const CONNECT_TIMEOUT_MS = 60_000;
const INPORT_TIMEOUT_MS = 30_000;
const SHOW_LAST_N = 10;

function fmtTime(t) {
  const d = t instanceof Date ? t : new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

async function main() {
  console.log(`[test-zk] target = ${HOST}:${PORT}`);
  console.log(`[test-zk] timeouts = connect ${CONNECT_TIMEOUT_MS}ms, inport ${INPORT_TIMEOUT_MS}ms`);

  const zk = new ZKLib(HOST, PORT, CONNECT_TIMEOUT_MS, INPORT_TIMEOUT_MS);

  console.log('[test-zk] connecting…');
  const t0 = Date.now();
  await zk.createSocket();
  console.log(`[test-zk] connected in ${Date.now() - t0}ms`);

  // Device info — only stat-style fields exist on 1.3.
  console.log('[test-zk] getInfo:');
  let info = null;
  try {
    info = await zk.getInfo();
    console.log(`  users:       ${info?.userCounts ?? '?'}`);
    console.log(`  logCounts:   ${info?.logCounts ?? '?'}   (firmware-reported, có thể là lifetime counter)`);
    console.log(`  logCapacity: ${info?.logCapacity ?? '?'}`);
  } catch (err) {
    console.log(`  (failed) ${err.message ?? err}`);
  }

  // Pull all attendance records.
  console.log('[test-zk] fetching attendances…');
  const tFetch = Date.now();
  // 1.3: progress callback (percent, total) → trace để biết stream
  // dừng ở đâu nếu bị partial.
  let lastPercent = 0;
  const att = await zk.getAttendances(undefined, (percent, _total) => {
    // Throttle log ra mỗi 10% để không spam.
    if (percent - lastPercent >= 10 || percent === 100) {
      console.log(`  [progress] ${percent}%`);
      lastPercent = percent;
    }
  });
  const fetchMs = Date.now() - tFetch;
  const records = att?.data ?? [];
  const err = att?.err;
  console.log(`[test-zk] received ${records.length} record(s) in ${fetchMs}ms`);
  if (err) {
    console.log(`[test-zk] WARN partial read — ${err.message ?? err}`);
  }

  // Mismatch warning if getInfo differed significantly.
  if (info?.logCounts && records.length < info.logCounts * 0.8) {
    console.log(
      `[test-zk] WARN: pulled ${records.length} but device reported ${info.logCounts} → có thể stream bị cắt.`,
    );
  }

  // Show last N (sorted by userSn desc — newest first).
  if (records.length > 0) {
    const sorted = [...records].sort((a, b) => Number(b.userSn) - Number(a.userSn));
    const recent = sorted.slice(0, SHOW_LAST_N);
    console.log(`[test-zk] last ${recent.length} record(s) (newest first):`);
    console.log('  userSn       deviceUserId    recordTime              state');
    console.log('  -----------  --------------  --------------------    -----');
    for (const r of recent) {
      const sn = String(r.userSn).padEnd(11);
      const uid = String(r.deviceUserId ?? '').padEnd(14);
      const ts = fmtTime(r.recordTime).padEnd(20);
      console.log(`  ${sn}  ${uid}  ${ts}    ${r.state}`);
    }
  }

  await zk.disconnect();
  console.log('[test-zk] done.');
}

main().catch((err) => {
  console.error('[test-zk] FATAL:', err.message ?? err);
  process.exit(1);
});
