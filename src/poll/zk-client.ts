// Thin re-export of our custom ZK client. Replaces node-zklib for our
// streaming use case — see ../zklib/client.ts for the why and how.
export { fetchAttendances, probeZkDevice, ZkClient } from '../zklib/client';
export type { ZkAttendanceRecord } from './types';

export interface ZkDeviceInfo {
  reachable: boolean;
  userCount?: number;
  attendanceCount?: number;
  logCapacity?: number;
  error?: string;
}
