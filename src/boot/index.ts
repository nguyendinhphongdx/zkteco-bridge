import * as linuxBoot from './linux-systemd';
import * as macBoot from './macos-launchd';
import * as winBoot from './windows-service';

export interface AutostartProvider {
  install(): Promise<void>;
  uninstall(): Promise<void>;
  isInstalled(): Promise<boolean>;
  describe(): string;
}

export function getAutostartProvider(): AutostartProvider {
  switch (process.platform) {
    case 'linux':
      return linuxBoot;
    case 'win32':
      return winBoot;
    case 'darwin':
      return macBoot;
    default:
      return {
        install: async () => {
          throw new Error(`Auto-start is not supported on platform "${process.platform}".`);
        },
        uninstall: async () => undefined,
        isInstalled: async () => false,
        describe: () => `unsupported (${process.platform})`,
      };
  }
}
