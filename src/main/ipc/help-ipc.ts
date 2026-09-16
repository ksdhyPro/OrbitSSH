import { ipcMain, shell } from "electron";

import {
  HELP_CHANGELOG_URL,
  HELP_FEEDBACK_URL,
} from "../../shared/help-links.js";

export type HelpLinkType = "feedback" | "changelog";

const helpLinkByType: Record<HelpLinkType, string> = {
  feedback: HELP_FEEDBACK_URL,
  changelog: HELP_CHANGELOG_URL,
};

/** 使用系统默认浏览器打开固定帮助链接，Renderer 不接触任意外部 URL。 */
export async function openHelpLink(type: HelpLinkType): Promise<boolean> {
  await shell.openExternal(helpLinkByType[type]);
  return true;
}

export function registerHelpIpc(): void {
  ipcMain.handle("help:open-feedback", () => openHelpLink("feedback"));
  ipcMain.handle("help:open-changelog", () => openHelpLink("changelog"));
}
