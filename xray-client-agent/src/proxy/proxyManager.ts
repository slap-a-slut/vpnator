export interface ProxyResult {
  applied: boolean;
  method: string;
  message: string;
  instructions?: string[];
}

export interface ProxyManager {
  enable(host: string, port: number): Promise<ProxyResult>;
  disable(): Promise<ProxyResult>;
}
