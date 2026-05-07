import type { AttendanceEvent, ZkAttendanceRecord } from './types';

export function translateZkRecord(r: ZkAttendanceRecord): AttendanceEvent {
  return {
    eventLogId: String(r.userSn),
    employeeCode: r.deviceUserId,
    timestamp: new Date(r.recordTime).toISOString(),
    type: r.state === 2 ? 'OUT' : 'IN',
  };
}
