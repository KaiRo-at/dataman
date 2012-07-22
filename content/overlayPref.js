/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/Services.jsm");

window.addEventListener("paneload", loadDatamanFFprefsOverrides, false);

function toDataManager(aView) {
  var win = Services.wm.getMostRecentWindow("navigator:browser");
  if (!win)
    win = Services.ww.openWindow("_blank",
                                 _getBrowserURL(),
                                 null,
                                 "chrome,all,dialog=no",
                                 null);
  Services.obs.addObserver(function loadview(aSubject, aTopic, aData) {
    Services.obs.notifyObservers(null, "dataman-loadview", aView);
    Services.obs.removeObserver(loadview, "dataman-exists");
  }, "dataman-exists", false);
  Services.obs.notifyObservers(null, "dataman-exist-request", "");
  win.switchToTabHavingURI("about:data", true);
}

function _getBrowserURL() {
  try {
    var url = Services.prefs.getCharPref("browser.chromeURL");
    if (url)
      return url;
  } catch(e) {
  }
  return "chrome://browser/content/browser.xul";
}

// Firefox
function loadDatamanFFprefsOverrides() {
  if (!/browser/.test(window.location))
    return;

  Services.console.logStringMessage("paneload start!");
  if ("gContentPane" in window) {
    gContentPane.showPopupExceptions = function() {
      toDataManager("|permissions");
    }
    gContentPane.showImageExceptions = function() {
      toDataManager("|permissions");
    }
  }
  if ("gPrivacyPane" in window) {
    gPrivacyPane.showCookieExceptions = function() {
      toDataManager("|permissions");
    }
    gPrivacyPane.showCookies = function() {
      toDataManager("|cookies");
    }
  }
  if ("gSecurityPane" in window) {
    gSecurityPane.showAddonExceptions = function() {
      toDataManager("|permissions");
    }
    gSecurityPane.showPasswordExceptions = function() {
      toDataManager("|permissions");
    }
    gSecurityPane.showPasswords= function() {
      toDataManager("|passwords");
    }
  }
}

// SeaMonkey
function openCookieViewer(viewerType) {
  toDataManager("|cookies");
}

function showPermissionsManager(viewerType, host) {
  if (host)
    toDataManager(host + "|permissions|add|" + viewerType);
  else
    toDataManager("|permissions");
}
