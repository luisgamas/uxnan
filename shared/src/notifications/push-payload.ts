/**
 * Push notification payload sent from the bridge to the relay (POST /push/notify).
 *
 * Source: architecture/02a-system-architecture.md §5.10.2.
 */

export type PushPlatform = 'ios' | 'android';

export interface PushNotifyRequest {
  sessionId: string;
  /** Secret that authenticates the bridge to the relay for this session. */
  notificationSecret: string;
  threadId: string;
  turnId: string;
  title: string;
  body: string;
}

export interface PushRegisterRequest {
  pushToken: string;
  platform: PushPlatform;
}

export interface PushRegisterResult {
  registered: boolean;
  notificationSecret: string;
}
