import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, IExtensionDataManager, IExtensionDataService } from "azure-devops-extension-api";

export const USER_SCOPE = { scopeType: "User", scopeValue: "Me" };

let managerPromise: Promise<IExtensionDataManager> | null = null;

export function getUserExtensionDataManager(): Promise<IExtensionDataManager> {
  if (!managerPromise) {
    managerPromise = (async () => {
      const dataService = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);
      const accessToken = await SDK.getAccessToken();
      return dataService.getExtensionDataManager(SDK.getExtensionContext().id, accessToken);
    })().catch((err) => {
      managerPromise = null;
      throw err;
    });
  }
  return managerPromise;
}
