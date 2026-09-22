import { Linking, Platform } from "react-native";

// this plugin typechecks without the DOM library, so declare only what this module uses.
// the desktop app runs as web inside electron and exposes its opener on window.paseoDesktop;
// window.open there lands in an in-app webview, so prefer the host opener when present
declare const window: {
  open(url: string, target: string, features: string): unknown;
  paseoDesktop?: { opener?: { openUrl?: (url: string) => Promise<void> } };
};

export async function openExternal(url: string): Promise<void> {
  if (!/^https?:/.test(url)) return;
  if (Platform.OS === "web") {
    const openUrl = window.paseoDesktop?.opener?.openUrl;
    if (typeof openUrl === "function") {
      await openUrl(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(url);
}
