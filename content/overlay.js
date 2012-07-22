/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// General calling function, also overrides existing function in SeaMonkey.
function toDataManager(aView)
{
  Services.obs.addObserver(function loadview(aSubject, aTopic, aData) {
    Services.obs.notifyObservers(null, "dataman-loadview", aView);
    Services.obs.removeObserver(loadview, "dataman-exists");
  }, "dataman-exists", false);
  Services.obs.notifyObservers(null, "dataman-exist-request", "");
  switchToTabHavingURI("about:data", true);
}

// Override password manager calling function in SeaMonkey.
function toPasswordManager()
{
  toDataManager("|passwords");
}
