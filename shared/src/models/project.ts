/**
 * Project models exchanged over JSON-RPC (project/* methods).
 */

export interface Project {
  id: string;
  name: string;
  /** Absolute working directory on the PC (never sent verbatim to mobile if sensitive). */
  cwd: string;
  agentId?: string;
}

export interface AuthStatus {
  agentId: string;
  requiresLogin: boolean;
  loginInProgress: boolean;
  authenticatedProvider?: string;
  displayName?: string;
  transportMode: 'local' | 'relay';
  platform: NodeJS.Platform | string;
}
