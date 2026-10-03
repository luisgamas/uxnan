/**
 * Push platform of a phone's FCM/APNs registration (`notifications/register`).
 *
 * Background push is delivered by the bridge alone, straight to FCM
 * (architecture/02a §5.10.2); the relay carries no push traffic.
 */

export type PushPlatform = 'ios' | 'android';
