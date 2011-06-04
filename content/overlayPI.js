/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is KaiRo's data manager.
 *
 * The Initial Developer of the Original Code is
 * Robert Kaiser <kairo@kairo.at>.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Robert Kaiser <kairo@kairo.at> (original author)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either of the GNU General Public License Version 2 or later (the "GPL"),
 * or the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

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
