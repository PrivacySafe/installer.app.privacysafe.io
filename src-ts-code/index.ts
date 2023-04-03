/*
 Copyright (C) 2021 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/


class InfoStorage {
  private readonly fs = w3n.storage!.getAppSyncedFS();

  async getPlatformChannel(): Promise<string|undefined> {
    const fs = await this.fs;
    const channel = await fs.readTxtFile(`channels/platform`)
    .catch((exc: web3n.files.FileException) => {
      if (exc.notFound) { return undefined; } else { throw exc; }
    });
    return channel;
  }

  async savePlatformChannel(channel: string): Promise<void> {
    const fs = await this.fs;
    await fs.writeTxtFile(`channels/platform`, channel);
  }

  async getAppChannel(appId: string): Promise<string|undefined> {
    const fs = await this.fs;
    const channel = await fs.readTxtFile(`channels/apps/${appId}`)
    .catch((exc: web3n.files.FileException) => {
      if (exc.notFound) { return undefined; } else { throw exc; }
    });
    return channel;
  }

  async saveAppChannel(appId: string, channel: string): Promise<void> {
    const fs = await this.fs;
    await fs.writeTxtFile(`channels/apps/${appId}`, channel);
  }

}


function logInfo(msg: string, cause?: any): void {
  console.info(msg, cause);
}

function logError(msg: string, err: any): void {
  console.error(msg, err);
}

interface ProgressDisplay {
  renderIn(newElem: HTMLDivElement): void;  
}


class PlatformUpdater {

  private elem: HTMLElement;
  private version: string;
  private channel: string|undefined;
  private distChannels: web3n.ui.DistChannels|undefined;
  private availableUpdates: Map<string, string> | undefined | 'none-found' | 'up-to-date';
  private appliedVersion: string|undefined;
  private actionInProcess: ProgressDisplay|undefined;

  constructor(
    private readonly storage: InfoStorage
  ) {}

  private setElem(newElem: HTMLElement): void {
    if (!this.elem) {
      this.elem = document.getElementById("platform-display") as HTMLElement;
    }
    this.elem.replaceWith(newElem);
    this.elem = newElem;
  }

  async setupAndRender(): Promise<void> {
    this.version = await w3n.apps!.platform!.getCurrentVersion();
    this.channel = await this.storage.getPlatformChannel();
    this.render();
  }

  private render(): void {
    if (!this.version) {
      throw new Error(`Platform info elements are not set`);
    }
    const newElem = makeFromTemplate("platform-template");
    (newElem.querySelector(".platform-version") as HTMLDivElement)
    .textContent = `Current version ${this.version}`;
    this.addUpdatesDisplayTo(newElem);
    if (this.actionInProcess) {
      this.actionInProcess.renderIn(
        newElem.querySelector(".platform-progress") as HTMLDivElement);
    } else {
      this.addActionsDisplayTo(newElem);
    }
    this.setElem(newElem);
  }

  private addUpdatesDisplayTo(newElem: HTMLElement): void {
    (newElem.querySelector(".platform-channel") as HTMLDivElement)
    .textContent = (this.channel ? `Update channel ${this.channel}` : null);
    const updatesElem = newElem.querySelector(".platform-available-updates") as HTMLDivElement;
    if (this.appliedVersion) {
      updatesElem.textContent = `New version ${this.appliedVersion} is ready to run after restart`;
    } else if (this.availableUpdates) {
      if (this.availableUpdates === 'up-to-date') {
        updatesElem.textContent = `Platform is up-to-date`;
      } else if (this.availableUpdates === 'none-found') {
        updatesElem.textContent = `Update information not found`;
      } else {
        for (const [channel, ver] of this.availableUpdates.entries()) {
          const verElem = document.createElement('div') as HTMLDivElement;
          verElem.textContent = `${channel} channel has newer version ${ver}`;
          updatesElem.appendChild(verElem);
        }
      }
    }
  }

  private addActionsDisplayTo(newElem: HTMLElement): void {
    const actions = newElem.querySelector(".platform-actions") as HTMLDivElement;
    if (this.appliedVersion) {
      console.error(`don't have simple restart function to add restart action`);
    } else if (!this.availableUpdates) {
      const checkUpdatesBtn = document.createElement('button') as HTMLButtonElement;
      checkUpdatesBtn.textContent = `Check Platform Updates`;
      checkUpdatesBtn.onclick = ev => this.checkForUpdate();
      actions.appendChild(checkUpdatesBtn);
    } else if (typeof this.availableUpdates === 'object') {
      for (const [channel, ver] of this.availableUpdates.entries()) {
        const updateBtn = document.createElement('button') as HTMLButtonElement;
        updateBtn.textContent = ((this.channel === channel) ?
          `Update to version ${ver}` :
          `Update to version ${ver} in ${channel} channel`);
        updateBtn.onclick = ev => this.downloadAndApplyUpdate(channel, ver);
        actions.appendChild(updateBtn);
      }
    }
  }

  async checkForUpdate(): Promise<void> {
    if (this.actionInProcess) { return; }
    this.actionInProcess = new StaticTextProgressComponent(
      `Checking for Platform update ...`);
    this.render();
    try {
      const availableVersions = new Map<string, string>();
      if (this.channel) {
        try {
          const ver = await w3n.apps!.platform!.getLatestVersion(this.channel);
          availableVersions.set(this.channel, ver);
        } catch (err) {
          logInfo(`Can't get latest version in platform channel ${this.channel}`, err);
        }
      } else {
        await this.initDistributionChannelsInfo();
        const channels = (this.distChannels ?
          Object.keys(this.distChannels.channels) : []);
        for (const channel of channels) {
          try {
            const ver = await w3n.apps!.platform!.getLatestVersion(channel);
            availableVersions.set(channel, ver);
          } catch (err) {
            logInfo(`Can't get latest version in platform channel ${channel}`, err);
          }
        }
      }
      if (availableVersions.size > 0) {
        const newVersions = new Map<string, string>();
        const currentSymVer = toSymVer(this.version)!;
        for (const [channel, ver] of availableVersions.entries()) {
          const symVer = toSymVer(ver);
          if (symVer && (compareVersions(symVer, currentSymVer) > 0)) {
            newVersions.set(channel, ver);
          }
        }
        this.availableUpdates = ((newVersions.size > 0) ?
          newVersions : 'up-to-date');
      } else if (!this.availableUpdates) {
        this.availableUpdates = 'none-found';
      }
    } finally {
      this.actionInProcess = undefined;
      this.render();
    }
  }

  private async initDistributionChannelsInfo(): Promise<boolean> {
    try {
      this.distChannels = await w3n.apps!.platform!.getChannels();
      return true;
    } catch (err) {
      logInfo(`Can't fetch platform distribution channels`, err);
      return false;
    }
  }

  private async downloadAndApplyUpdate(
    channel: string, version: string
  ): Promise<void> {
    if (this.actionInProcess || this.appliedVersion) { return; }
    const actionInProcess = new PlatformDownloadAndApplyingProgress(channel);
    this.actionInProcess = actionInProcess;
    this.render();
    try {
      await (new Promise<void>((
        complete, error
      ) => w3n.apps!.platform!.downloadAndApplyUpdate(channel, {
        next: p => actionInProcess.update(p),
        error,
        complete
      })));
      this.appliedVersion = version;
      if (this.channel !== channel) {
        this.channel = channel;
        await this.storage.savePlatformChannel(this.channel);
      }
    } finally {
      this.actionInProcess = undefined;
      this.render();
    }
  }

}


class StaticTextProgressComponent implements ProgressDisplay {

  private elem: HTMLDivElement;

  constructor(
    private txt: string
  ) {}

  renderIn(newElem: HTMLDivElement): void {
    this.elem = newElem;
    this.elem.textContent = this.txt;
  }
}


function makeFromTemplate(templateId: string): HTMLElement {
  const template = document.getElementById(templateId) as HTMLTemplateElement;
  // note that content.cloneNode(true) produces document fragment
  return template.content.firstElementChild!.cloneNode(true) as HTMLElement;
}

type SemVersion = [ number, number, number ];

function compareVersions(v1: SemVersion, v2: SemVersion): number {
  for (let i=0; i<3; i+=1) {
    const delta = v1[i] - v2[i];
    if (delta === 0) { continue; }
    else if (delta > 0) { return 1; }
    else if (delta < 0) { return -1; }
  }
  return 0;
}

const symVerRegExp = /\d+\.\d+\.\d+/;

function toSymVer(v: string): SemVersion|undefined {
  const match = v.match(symVerRegExp);
  if (!match) { return; }
  return match[0].split('.').map((s: any) => parseInt(s)) as SemVersion;
}

function appStateFromInfo(info: web3n.ui.AppInfo): AppUpdater['state'] {
  if (info.installed) {
    return 'installed';
  } else if (info.bundled) {
    return 'bundled';
  } else if (info.packs) {
    return 'downloaded';
  } else {
    throw new Error(`Application ${info.id} is neither installed, nor bundled, nor downloaded`);
  }
}

function latestVersionIn(versions: string[]): string {
  if (versions.length === 0) {
    throw new Error(`Versions array is empty`);
  } else {
    let latest = versions[versions.length-1];
    let latestSV = toSymVer(latest);
    for (let i=versions.length-2; i>=0; i-=1) {
      const v = versions[i];
      const sv = toSymVer(v);
      if (latestSV) {
        if (sv && (compareVersions(sv, latestSV) > 1)) {
          latest = v;
          latestSV = sv;
        }
      } else {
        if (sv || (latest < v)) {
          latest = v;
        }
      }
    }
    return latest;
  }
}


class AppUpdater {

  private info: web3n.ui.AppInfo;
  private state: 'installed' | 'bundled' | 'downloaded';
  private elem: HTMLElement = makeFromTemplate("app-template");
  private channel: string|undefined;
  private distChannels: web3n.ui.DistChannels|undefined;
  private availableUpdates: Map<string, string> | undefined | 'none-found' | 'up-to-date';
  private actionInProcess: ProgressDisplay|undefined;

  constructor(
    private readonly storage: InfoStorage
  ) {}

  private setElem(newElem: HTMLElement): void {
    if (this.elem) {
      this.elem.replaceWith(newElem);
    }
    this.elem = newElem;
  }

  get displayElem(): HTMLElement {
    return this.elem;
  }

  get id(): string {
    return this.info.id;
  }

  private render(): void {
    const newElem = makeFromTemplate("app-template");
    newElem.querySelector(".app-domain")!.textContent = this.id;
    newElem.querySelector(".app-version")!.textContent = (this.info.installed ?
      `Installed version ${this.info.installed[0].version}` :
      (this.info.bundled ?
        `Bundled version ${this.info.bundled![0].version}` :
        `Downloaded version(s) ${
          this.info.packs!.map(info => info.version).join(', ')}`));
    this.addUpdatesDisplayTo(newElem);
    if (this.actionInProcess) {
      this.actionInProcess.renderIn(
        newElem.querySelector(".app-progress") as HTMLDivElement);
    } else {
      this.addActionsDisplayTo(newElem);
    }
    this.setElem(newElem);
  }

  private addUpdatesDisplayTo(newElem: HTMLElement): void {
    const updatesElem = newElem.querySelector(".app-available-updates") as HTMLDivElement;
    if (this.state === 'installed') {
      (newElem.querySelector(".app-channel") as HTMLDivElement)
      .textContent = (this.channel ? `Update channel ${this.channel}` : null);
      if (this.availableUpdates) {
        if (this.availableUpdates === 'up-to-date') {
          updatesElem.textContent = `${this.id} is up-to-date`;
        } else if (this.availableUpdates === 'none-found') {
          updatesElem.textContent = `Update information not found`;
        } else {
          for (const [channel, ver] of this.availableUpdates.entries()) {
            const verElem = document.createElement('div') as HTMLDivElement;
            verElem.textContent = `${channel} channel has newer version ${ver}`;
            updatesElem.appendChild(verElem);
          }
        }
      }
    } else {
      if (this.availableUpdates) {
        if (this.availableUpdates === 'up-to-date') {
          updatesElem.textContent = `Local version is the latest`;
        } else if (this.availableUpdates === 'none-found') {
          updatesElem.textContent = `Update information not found`;
        } else {
          for (const [channel, ver] of this.availableUpdates.entries()) {
            const verElem = document.createElement('div') as HTMLDivElement;
            verElem.textContent = `${channel} channel has newer version ${ver}`;
            updatesElem.appendChild(verElem);
          }
        }
      }
    }
  }

  private addActionsDisplayTo(newElem: HTMLElement): void {
    const actions = newElem.querySelector(".app-actions") as HTMLDivElement;
    if (this.state !== 'installed') {
      const installBtn = document.createElement('button') as HTMLButtonElement;
      const localVersion = this.latestVersionFromInfo();
      installBtn.textContent = `Install ${this.id} version ${localVersion}`;
      if (this.state === 'bundled') {
        installBtn.onclick = ev => this.installBundled(localVersion);
      } else if (this.state === 'downloaded') {
        installBtn.onclick = ev => this.installDownloaded(localVersion);
      }
      actions.appendChild(installBtn);
    }
    if (!this.availableUpdates) {
      const checkUpdatesBtn = document.createElement('button') as HTMLButtonElement;
      checkUpdatesBtn.textContent = ((this.state === 'installed') ?
        `Check ${this.id} Updates` :
        `Check ${this.id} other version(s)`);
      checkUpdatesBtn.onclick = ev => this.checkForUpdate();
      actions.appendChild(checkUpdatesBtn);
    } else if (typeof this.availableUpdates === 'object') {
      for (const [channel, ver] of this.availableUpdates.entries()) {
        const updateBtn = document.createElement('button') as HTMLButtonElement;
        updateBtn.textContent = ((this.channel === channel) ?
          `Update to version ${ver}` :
          `Update to version ${ver} in ${channel} channel`);
        updateBtn.onclick = ev => this.downloadAndInstallUpdate(channel, ver);
        actions.appendChild(updateBtn);
      }
    }
  }

  async setInfoAndRender(info: web3n.ui.AppInfo): Promise<void> {
    this.info = info;
    this.state = appStateFromInfo(this.info);
    this.channel = await this.storage.getAppChannel(this.id);
    this.render();
  }

  private async refreshInfoAndRender(): Promise<void> {
    const refreshedInfo = await w3n.apps!.opener!.getAppInfo(this.id);
    this.setInfoAndRender(refreshedInfo!);
  }

  async checkForUpdate(): Promise<void> {
    if (this.actionInProcess) { return; }
    this.actionInProcess = new StaticTextProgressComponent(
      `Checking for ${this.id} update ...`);
    this.render();
    try {
      const currentVersion = this.latestVersionFromInfo();
      const availableVersions = new Map<string, string>();
      if (this.channel) {
        try {
          const ver = await w3n.apps!.downloader!.getLatestAppVersion(
            this.id, this.channel);
          availableVersions.set(this.channel, ver);
        } catch (err) {
          logInfo(`Can't get latest version in ${this.id} channel ${this.channel}`, err);
        }
      } else {
        await this.initDistributionChannelsInfo();
        const channels = (this.distChannels ?
          Object.keys(this.distChannels.channels) : []);
        for (const channel of channels) {
          try {
            const ver = await w3n.apps!.downloader!.getLatestAppVersion(
              this.id, channel);
            availableVersions.set(channel, ver);
          } catch (err) {
            logInfo(`Can't get latest version in ${this.id} channel ${channel}`, err);
          }
        }
      }
      if (availableVersions.size > 0) {
        const newVersions = new Map<string, string>();
        const currentSymVer = toSymVer(currentVersion)!;
        for (const [channel, ver] of availableVersions.entries()) {
          const symVer = toSymVer(ver);
          if (symVer && (compareVersions(symVer, currentSymVer) > 0)) {
            newVersions.set(channel, ver);
          }
        }
        this.availableUpdates = ((newVersions.size > 0) ?
          newVersions : 'up-to-date');
      } else if (!this.availableUpdates) {
        this.availableUpdates = 'none-found';
      }
    } finally {
      this.actionInProcess = undefined;
      this.refreshInfoAndRender();
    }
  }

  private latestVersionFromInfo(): string {
    if (this.state === 'installed') {
      return this.info.installed![0].version;
    } else if (this.state === 'bundled') {
      return this.info.bundled![0].version;
    } else if (this.state === 'downloaded') {
      return latestVersionIn(this.info.packs!.map(p => p.version));
    } else {
      throw new Error(`This point in code shouldn't be reached`);
    }
  }

  private async initDistributionChannelsInfo(): Promise<boolean> {
    try {
      this.distChannels = await w3n.apps!.downloader!.getAppChannels(this.id);
      return true;
    } catch (err) {
      logInfo(`Can't fetch platform distribution channels`, err);
      return false;
    }
  }

  private async downloadAndInstallUpdate(
    channel: string, version: string
  ): Promise<void> {
    if (this.actionInProcess) { return; }
    const actionInProcess = new AppDownloadAndInstallProgress(version);
    this.actionInProcess = actionInProcess;
    this.render();
    try {
      const alreadyDownloaded = !!this.info.packs?.find(
        p => ((p.platform === 'web') && (p.version === version))
      );
      if (!alreadyDownloaded) {
        await (new Promise<void>((
          complete, error
        ) => w3n.apps!.downloader!.downloadWebApp(this.id, version, {
          next: p => actionInProcess.update(p),
          error,
          complete
        })));
      }
      actionInProcess.switchToCompletion();
      await w3n.apps!.installer!.installWebApp(this.id, version);
      if (this.channel !== channel) {
        this.channel = channel;
        await this.storage.saveAppChannel(this.id, this.channel);
      }
    } finally {
      this.actionInProcess = undefined;
      this.refreshInfoAndRender();
    }
  }

  private async installDownloaded(version: string): Promise<void> {
    if (this.actionInProcess) { return; }
    this.actionInProcess = new StaticTextProgressComponent(
      `Installing downloaded ...`);
    this.render();
    try {
      await w3n.apps!.installer!.installWebApp(this.id, version);
    } finally {
      this.actionInProcess = undefined;
      this.refreshInfoAndRender();
    }
  }

  private async installBundled(version: string): Promise<void> {
    if (this.actionInProcess) { return; }
    const actionInProcess = new AppInstallBundledProgress();
    this.actionInProcess = actionInProcess;
    this.render();
    try {
      const alreadyUnpacked = !!this.info.packs?.find(
        p => ((p.platform === 'web') && (p.version === version))
      );
      if (!alreadyUnpacked) {
        await (new Promise<void>((
          complete, error
        ) => w3n.apps!.installer!.unpackBundledWebApp(this.id, {
          next: p => actionInProcess.update(p),
          error,
          complete
        })));
      }
      actionInProcess.switchToCompletion();
      await w3n.apps!.installer!.installWebApp(this.id, version);
    } finally {
      this.actionInProcess = undefined;
      this.refreshInfoAndRender();
    }
  }

}


abstract class ProgressComponent<T> implements ProgressDisplay {

  stage: 'start' | 'process' | 'completion' = 'start';
  protected progress: T;
  protected elem: HTMLDivElement;
  protected progressBar: HTMLProgressElement|undefined;
  protected progressTxt1: HTMLDivElement|undefined;
  protected progressTxt2: HTMLDivElement|undefined;

  renderIn(newElem: HTMLDivElement): void {
    if (newElem) {
      this.elem = newElem;
      this.progressBar = undefined;
      this.progressTxt1 = undefined;
      this.progressTxt2 = undefined;
    }
    this.render();
  }

  private render(): void {
    if (this.stage === 'start') {
      this.renderOnStart();
    } else if (this.progress && (this.stage === 'process')) {
      const percent = this.progressPercentage();
      this.elem.textContent = null;
      if (!this.progressBar) {
        this.progressBar = document.createElement('progress');
        this.progressBar.max = 100;
        this.progressBar.value = percent;
        this.elem.appendChild(this.progressBar);
      }
      if (!this.progressTxt1) {
        this.progressTxt1 = document.createElement('div');
        this.elem.appendChild(this.progressTxt1);
      }
      if (!this.progressTxt2) {
        this.progressTxt2 = document.createElement('div');
        this.elem.appendChild(this.progressTxt2);
      }
      this.progressBar.value = percent;
      this.renderOnProcess();
    } else if (this.stage === 'completion') {
      if (this.progressBar) {
        this.progressBar.hidden = true;
        this.progressBar = undefined;
      }
      if (this.progressTxt1) {
        this.progressTxt1.hidden = true;
        this.progressTxt1 = undefined;
      }
      if (this.progressTxt2) {
        this.progressTxt2.hidden = true;
        this.progressTxt2 = undefined;
      }
      this.renderOnCompletion();
    }
  }

  protected abstract renderOnCompletion(): void;

  protected abstract renderOnStart(): void;

  protected abstract progressPercentage(): number;

  protected abstract renderOnProcess(): void;

  update(p: T): void {
    this.stage = 'process';
    
    // DEBUG log
    console.log(p);
    
    this.progress = p;
    this.render();
  }

  switchToCompletion(): void {
    this.stage = 'completion';
    this.render();
  }

}


class AppInstallBundledProgress
extends ProgressComponent<web3n.ui.BundleUnpackProgress> {

  protected renderOnStart(): void {
    this.elem.textContent = `Installing bundled ...`;
  }

  protected renderOnCompletion(): void {
    this.elem.textContent = `Installing unpacked ...`;
  }

  protected progressPercentage(): number {
    return Math.floor(
      100*this.progress.numOfProcessed/this.progress.numOfFiles);
  }

  protected renderOnProcess(): void {
    this.progressTxt1!.textContent = `unpacked ${this.progress.numOfProcessed} of ${this.progress.numOfFiles} files`;
    this.progressTxt2!.textContent = (this.progress.fileInProgress ?
      `unpacking ${this.progress.fileInProgress}` :
      null);
  }

}


class AppDownloadAndInstallProgress
extends ProgressComponent<web3n.ui.DownloadProgress> {

  constructor(
    private version: string
  ) {
    super();
  }

  protected renderOnStart(): void {
    this.elem.textContent = `Downloading version ${this.version} ...`;
  }

  protected renderOnCompletion(): void {
    this.elem.textContent = `Installing downloaded ...`;
  }

  protected progressPercentage(): number {
    const bytesDownloaded = this.progress.totalBytes - this.progress.bytesLeft;
    return Math.floor(
      100*bytesDownloaded/this.progress.totalBytes);
  }

  protected renderOnProcess(): void {
    const downloadedFiles = this.progress.totalFiles - this.progress.filesLeft;
    this.progressTxt1!.textContent = `downloaded ${downloadedFiles} of ${this.progress.totalFiles} files`;
    this.progressTxt2!.textContent = (this.progress.fileInProgress ?
      `downloading ${this.progress.currentFileSize} bytes of ${this.progress.fileInProgress}` :
      null);
  }

}


class PlatformDownloadAndApplyingProgress
extends ProgressComponent<web3n.ui.PlatformDownloadProgress> {

  private totalMBs: number|undefined;

  constructor(
    private channel: string
  ) {
    super();
  }

  protected renderOnStart(): void {
    this.elem.textContent = `Downloading from ${this.channel} channel ...`;
  }

  protected renderOnCompletion(): void {}

  protected progressPercentage(): number {
    return ((this.progress &&
      (this.progress.event === 'download-progress') &&
      (typeof this.progress.percent === 'number')) ?
      this.progress.percent : 0);
  }

  protected renderOnProcess(): void {
    if (this.progress.event === 'checking-for-update') {
      this.progressTxt1!.textContent = `Connecting ...`;
    } else if (this.progress.event === 'update-available') {
      this.totalMBs = this.progress.totalSizeMBs;
      this.progressTxt1!.textContent = `Update is ${this.totalMBs}MB`;
    } else if (this.progress.event === 'download-progress') {
      this.progressTxt1!.textContent = `${this.progress.percent}% of ${this.totalMBs}MB downloaded`;
    }
  }

}


class AllApps {

  private apps: AppUpdater[] = [];
  private elem: HTMLElement;

  constructor(
    private readonly storage: InfoStorage
  ) {}

  async refreshAndRenderAll(): Promise<void> {
    const infos = await w3n.apps!.opener!.listApps();
    const container = document.createElement('div');
    const installed = infos.filter(app => !!app.installed);
    const onlyBundled = infos.filter(app => (
      !installed.includes(app) && !!app.bundled));
    const onlyDownloaded = infos.filter(app => (
      !installed.includes(app) && !onlyBundled.includes(app) && !!app.packs));
    this.apps = [];
    for(const info of installed.concat(onlyBundled, onlyDownloaded)) {
      const app = new AppUpdater(this.storage);
      await app.setInfoAndRender(info);
      container.appendChild(app.displayElem);
      this.apps.push(app);
    }
    this.setElem(container);
  }

  private setElem(newElem: HTMLElement): void {
    if (!this.elem) {
      this.elem = document.getElementById("apps-display") as HTMLElement;
    }
    this.elem.replaceWith(newElem);
    this.elem = newElem;
  }

  async checkForAllUpdates(): Promise<void> {
    for (const app of this.apps) {
      await app.checkForUpdate()
      .catch(err => logError(`Error in checking updates for ${app.id}`, err));
    }
  }

}


class AppsSearch {

  constructor(
    private readonly storage: InfoStorage,
    private readonly knownApps: AllApps
  ) {}

  async findApp(): Promise<void> {
    console.error(`findApp() is not implemeted, yet`);
  }
  
}


const storage = new InfoStorage();
const platform = new PlatformUpdater(storage);
const apps = new AllApps(storage);
const searches = new AppsSearch(storage, apps);

apps.refreshAndRenderAll();
platform.setupAndRender();

async function checkForAllUpdates(): Promise<void> {
  await platform.checkForUpdate();
  await apps.checkForAllUpdates();
}

