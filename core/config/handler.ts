import {
  BrowserSerializedContinueConfig,
  ContinueConfig,
  ContinueRcJson,
  IContextProvider,
  IDE,
  ILLM,
} from "../index.js";
import { IdeSettings } from "../protocol/ideWebview.js";
import { Telemetry } from "../util/posthog.js";
import { finalToBrowserConfig, loadFullConfigNode } from "./load.js";

export class ConfigHandler {
  private savedConfig: ContinueConfig | undefined;
  private savedBrowserConfig?: BrowserSerializedContinueConfig;
  private additionalContextProviders: IContextProvider[] = [];

  constructor(
    private readonly ide: IDE,
    private ideSettingsPromise: Promise<IdeSettings>,
    private readonly writeLog: (text: string) => Promise<void>,
  ) {
    this.ide = ide;
    this.ideSettingsPromise = ideSettingsPromise;
    this.writeLog = writeLog;
    try {
      this.loadConfig();
    } catch (e) {
      console.error("Failed to load config: ", e);
    }
  }

  updateIdeSettings(ideSettings: IdeSettings) {
    this.ideSettingsPromise = Promise.resolve(ideSettings);
    this.reloadConfig();
  }

  private updateListeners: (() => void)[] = [];
  onConfigUpdate(listener: () => void) {
    this.updateListeners.push(listener);
  }

  reloadConfig() {
    this.savedConfig = undefined;
    this.savedBrowserConfig = undefined;
    this.loadConfig();
    for (const listener of this.updateListeners) {
      listener();
    }
  }

  async getSerializedConfig(): Promise<BrowserSerializedContinueConfig> {
    if (!this.savedBrowserConfig) {
      this.savedConfig = await this.loadConfig();
      this.savedBrowserConfig = finalToBrowserConfig(this.savedConfig);
    }
    return this.savedBrowserConfig;
  }

  async loadConfig(): Promise<ContinueConfig> {
    if (this.savedConfig) {
      return this.savedConfig;
    }

    let workspaceConfigs: ContinueRcJson[] = [];
    try {
      workspaceConfigs = await this.ide.getWorkspaceConfigs();
    } catch (e) {
      console.warn("Failed to load workspace configs");
    }

    const ideInfo = await this.ide.getIdeInfo();
    const uniqueId = await this.ide.getUniqueId();

    this.savedConfig = await loadFullConfigNode(
      this.ide,
      workspaceConfigs,
      await this.ideSettingsPromise,
      ideInfo.ideType,
      uniqueId,
      this.writeLog,
    );
    this.savedConfig.allowAnonymousTelemetry =
      this.savedConfig.allowAnonymousTelemetry &&
      (await this.ide.isTelemetryEnabled());

    // Setup telemetry only after (and if) we know it is enabled
    await Telemetry.setup(
      this.savedConfig.allowAnonymousTelemetry ?? true,
      await this.ide.getUniqueId(),
      ideInfo.extensionVersion,
    );

    (this.savedConfig.contextProviders ?? []).push(
      ...this.additionalContextProviders,
    );

    return this.savedConfig;
  }

  async llmFromTitle(title?: string): Promise<ILLM> {
    const config = await this.loadConfig();
    const model =
      config.models.find((m) => m.title === title) || config.models[0];
    if (!model) {
      throw new Error("No model found");
    }

    return model;
  }

  registerCustomContextProvider(contextProvider: IContextProvider) {
    this.additionalContextProviders.push(contextProvider);
    this.reloadConfig();
  }
}
