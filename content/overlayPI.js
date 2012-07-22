/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/Services.jsm");

Services.obs.addObserver(DataManagerPageInfoLoad, "page-info-dialog-loaded", false);
window.addEventListener("unload", DataManagerPageInfoUnload, false);

function toDataManager(aView) {
  Services.obs.addObserver(function loadview(aSubject, aTopic, aData) {
    Services.obs.notifyObservers(null, "dataman-loadview", aView);
    Services.obs.removeObserver(loadview, "dataman-exists");
  }, "dataman-exists", false);
  Services.obs.notifyObservers(null, "dataman-exist-request", "");
  Services.wm.getMostRecentWindow("navigator:browser")
             .switchToTabHavingURI("about:data", true);
}

function DataManagerPageInfoLoad() {
  if (/navigator/.test(window.location)) {
    // Services.console.logStringMessage("SeaMonkey detected");
    var info = security._getSecurityInfo();
    document.getElementById("security-view-cookies").disabled = !hostHasCookies(info.hostName);
    document.getElementById("security-view-password").disabled = !realmHasPasswords(info.fullLocation);
  }
  else {
    // Services.console.logStringMessage("Firefox detected");
    var uri = gDocument.documentURIObject;
    document.getElementById("security-view-cookies").disabled = !hostHasCookies(uri);
    document.getElementById("security-view-password").disabled = !realmHasPasswords(uri);
  }
}

function DataManagerPageInfoUnload() {
  Services.obs.removeObserver(DataManagerPageInfoLoad, "page-info-dialog-loaded");
}

/**
 * Open the cookie manager window
 */
security.viewCookies = function() {
  toDataManager(this._getSecurityInfo().hostName + '|cookies');
}

/**
 * Open the login manager window
 */
security.viewPasswords = function() {
  toDataManager(this._getSecurityInfo().hostName + '|passwords');
}
