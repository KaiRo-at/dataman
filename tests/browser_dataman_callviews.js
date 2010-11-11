/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/
 */

// Test loading views in data manager

Components.utils.import("resource://gre/modules/Services.jsm");

// happen to match what's used in Data Manager itself
var gLocSvc = {
  cookie: Components.classes["@mozilla.org/cookiemanager;1"]
                    .getService(Components.interfaces.nsICookieManager2),
}

const DATAMAN_LOADED = "dataman-loaded";

function test() {
  // Add cookie
  gLocSvc.cookie.add("getpersonas.com", "", "name0", "value0",
                     false, false, true, parseInt(Date.now() / 1000) + 600);

  //Services.prefs.setBoolPref("data_manager.debug", true);

  var win;
  var testIndex = 0;

  gBrowser.addTab();
  toDataManager("example.org");

  let testObs = {
    observe: function(aSubject, aTopic, aData) {
      if (aTopic == DATAMAN_LOADED) {
        ok(true, "Data Manager is loaded");

        win = content.wrappedJSObject;
        is(win.gDomains.tree.view.selection.count, 1,
          "One domain is selected");
        if (testIndex == 0) {
          is(win.gDomains.selectedDomain.title, "example.org",
            "The correct domain is selected");
          win.close();
          testIndex++;
          gBrowser.addTab();
          toDataManager("getpersonas.com:permissions");
        }
        else {
          Services.obs.removeObserver(testObs, DATAMAN_LOADED);
          is(win.gDomains.selectedDomain.title, "getpersonas.com",
            "The correct domain is selected");
          is(win.gTabs.activePanel, "permissionsPanel",
            "Permissions panel is selected");
          win.close();
          gLocSvc.cookie.remove("getpersonas.com", "name0", "value0", false);
          finish();
        }
      }
    }
  };
  waitForExplicitFinish();
  Services.obs.addObserver(testObs, DATAMAN_LOADED, false);
}
