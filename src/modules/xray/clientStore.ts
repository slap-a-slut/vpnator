export interface XrayClientStore {
  sync(serverId: string): Promise<void>;
  addUser(serverId: string, userUuid: string): Promise<void>;
  removeUser(serverId: string, userUuid: string): Promise<void>;
}
