import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<number>;
  declare username: string;
  declare passwordHash: string;
  declare createdAt: CreationOptional<Date>;
}

export class Config extends Model<InferAttributes<Config>, InferCreationAttributes<Config>> {
  declare key: string;
  declare value: string;
  declare updatedAt: CreationOptional<Date>;
}

export type DeviceLastStatus = 'ok' | 'zk_error' | 'api_error' | 'partial' | null;

export class Device extends Model<InferAttributes<Device>, InferCreationAttributes<Device>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare host: string;
  declare port: CreationOptional<number>;
  declare deviceToken: string;
  declare lastEventLogId: CreationOptional<number>;
  declare lastSyncAt: CreationOptional<Date | null>;
  declare lastStatus: CreationOptional<DeviceLastStatus>;
  declare lastError: CreationOptional<string | null>;
  declare enabled: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export class EventQueue extends Model<
  InferAttributes<EventQueue>,
  InferCreationAttributes<EventQueue>
> {
  declare id: CreationOptional<number>;
  declare deviceId: number;
  declare payloadJson: string;
  declare enqueuedAt: CreationOptional<Date>;
  declare attempts: CreationOptional<number>;
  declare lastError: CreationOptional<string | null>;
}

export type CycleStatus = 'ok' | 'zk_error' | 'api_error' | 'partial';

export class CycleLog extends Model<
  InferAttributes<CycleLog>,
  InferCreationAttributes<CycleLog>
> {
  declare id: CreationOptional<number>;
  declare deviceId: number;
  declare deviceName: string;
  declare startedAt: CreationOptional<Date>;
  declare finishedAt: CreationOptional<Date | null>;
  declare eventsPolled: CreationOptional<number | null>;
  declare eventsPushed: CreationOptional<number | null>;
  declare eventsQueued: CreationOptional<number | null>;
  declare status: CycleStatus;
  declare errorMessage: CreationOptional<string | null>;
}

export function defineModels(sequelize: Sequelize): void {
  User.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      username: { type: DataTypes.STRING, unique: true, allowNull: false },
      passwordHash: { type: DataTypes.STRING, allowNull: false, field: 'password_hash' },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
      },
    },
    { sequelize, tableName: 'users', timestamps: false },
  );

  Config.init(
    {
      key: { type: DataTypes.STRING, primaryKey: true },
      value: { type: DataTypes.TEXT, allowNull: false },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at',
      },
    },
    { sequelize, tableName: 'config', timestamps: false },
  );

  Device.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING, allowNull: false },
      host: { type: DataTypes.STRING, allowNull: false },
      port: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 4370 },
      deviceToken: { type: DataTypes.TEXT, allowNull: false, field: 'device_token' },
      lastEventLogId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'last_event_log_id',
      },
      lastSyncAt: { type: DataTypes.DATE, allowNull: true, field: 'last_sync_at' },
      lastStatus: { type: DataTypes.STRING, allowNull: true, field: 'last_status' },
      lastError: { type: DataTypes.TEXT, allowNull: true, field: 'last_error' },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at',
      },
    },
    { sequelize, tableName: 'devices', timestamps: false },
  );

  EventQueue.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      deviceId: { type: DataTypes.INTEGER, allowNull: false, field: 'device_id' },
      payloadJson: { type: DataTypes.TEXT, allowNull: false, field: 'payload_json' },
      enqueuedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'enqueued_at',
      },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      lastError: { type: DataTypes.TEXT, allowNull: true, field: 'last_error' },
    },
    {
      sequelize,
      tableName: 'event_queue',
      timestamps: false,
      indexes: [{ fields: ['device_id'] }],
    },
  );

  CycleLog.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      deviceId: { type: DataTypes.INTEGER, allowNull: false, field: 'device_id' },
      deviceName: { type: DataTypes.STRING, allowNull: false, field: 'device_name' },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'started_at',
      },
      finishedAt: { type: DataTypes.DATE, allowNull: true, field: 'finished_at' },
      eventsPolled: { type: DataTypes.INTEGER, allowNull: true, field: 'events_polled' },
      eventsPushed: { type: DataTypes.INTEGER, allowNull: true, field: 'events_pushed' },
      eventsQueued: { type: DataTypes.INTEGER, allowNull: true, field: 'events_queued' },
      status: { type: DataTypes.STRING, allowNull: false },
      errorMessage: { type: DataTypes.TEXT, allowNull: true, field: 'error_message' },
    },
    {
      sequelize,
      tableName: 'cycle_log',
      timestamps: false,
      indexes: [{ fields: ['device_id'] }, { fields: ['started_at'] }],
    },
  );
}

export async function bootstrapModels(): Promise<void> {
  await User.sequelize!.sync();
}
