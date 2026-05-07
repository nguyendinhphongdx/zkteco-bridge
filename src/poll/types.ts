export type AttendanceEventType = 'IN' | 'OUT';

export interface AttendanceEvent {
  eventLogId: string;
  employeeCode: string;
  timestamp: string;
  type?: AttendanceEventType;
  note?: string;
}

export interface PushAttendanceBody {
  token: string;
  events: AttendanceEvent[];
}

export interface ZkAttendanceRecord {
  userSn: number;
  deviceUserId: string;
  recordTime: string | Date;
  state: number;
}
