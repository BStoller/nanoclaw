export interface EnvState {
  filePath: string;
  content: string;
  values: Record<string, string>;
}

export interface TlsCertificatePaths {
  certPath: string;
  keyPath: string;
}

export interface SlackOauthResult {
  botToken: string;
  teamId?: string;
  teamName?: string;
  botUserId?: string;
  scope?: string;
  appId?: string;
}
