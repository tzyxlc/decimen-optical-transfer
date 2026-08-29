// Home page script: init the locale layer, then wire the share dialog.
import { initI18n } from "../shared/i18n";
import { wireShareDialog } from "../shared/share-dialog";

// No top-level await: Safari 14 / iOS 14 cannot parse it, so the page
// script never runs on those phones.
function isLanOrigin(): boolean {
  const host = location.hostname;
  return host === "localhost" || host === "127.0.0.1" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

void initI18n().then(() => {
  document.getElementById("share-open")!.addEventListener("click", wireShareDialog());
  const cert = document.getElementById("lan-cert");
  if (cert && !isLanOrigin()) cert.hidden = true;
});
