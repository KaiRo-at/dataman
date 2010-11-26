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
        ok(true, "Step " + (testIndex + 1) + ": Data Manager is loaded");

        win = content.wrappedJSObject;
        if (testIndex == 0) {
          is(win.gDomains.tree.view.selection.count, 1,
            "Step " + (testIndex + 1) + ": One domain is selected");
          is(win.gDomains.selectedDomain.title, "example.org",
            "Step " + (testIndex + 1) + ": The correct domain is selected");
          testIndex++;
          toDataManager("getpersonas.com:cookies");
        }
        else if (testIndex == 1) {
          is(win.gDomains.tree.view.selection.count, 1,
            "Step " + (testIndex + 1) + ": One domain is selected");
          is(win.gDomains.selectedDomain.title, "getpersonas.com",
            "Step " + (testIndex + 1) + ": The correct domain is selected");
          is(win.gTabs.activePanel, "cookiesPanel",
            "Step " + (testIndex + 1) + ": Cookies panel is selected");
          win.close();
          testIndex++;
          gBrowser.addTab();
          toDataManager("www.getpersonas.com:permissions");
        }
        else if (testIndex == 2) {
          is(win.gDomains.tree.view.selection.count, 1,
            "Step " + (testIndex + 1) + ": One domain is selected");
          is(win.gDomains.selectedDomain.title, "getpersonas.com",
            "Step " + (testIndex + 1) + ": The correct domain is selected");
          is(win.gTabs.activePanel, "permissionsPanel",
            "Step " + (testIndex + 1) + ": Permissions panel is selected");
          win.close();
          testIndex++;
          gBrowser.addTab();
          toDataManager(":cookies");
        }
        else if (testIndex == 3) {
          is(win.gDomains.selectfield.value, "Cookies",
            "Step " + (testIndex + 1) + ": The correct menulist item is selected");
          is(win.gDomains.tree.view.rowCount, 1,
            "Step " + (testIndex + 1) + ": The correct number of domains is listed");
          win.gDomains.tree.view.selection.select(0);
          is(win.gDomains.selectedDomain.title, "getpersonas.com",
            "Step " + (testIndex + 1) + ": The listed domain is correct");
          testIndex++;
          toDataManager("www.getpersonas.com");
        }
        else if (testIndex == 4) {
          is(win.gDomains.selectfield.value, "all",
            "Step " + (testIndex + 1) + ": The correct menulist item is selected");
          is(win.gDomains.tree.view.selection.count, 1,
            "Step " + (testIndex + 1) + ": One domain is selected");
          is(win.gDomains.selectedDomain.title, "getpersonas.com",
            "Step " + (testIndex + 1) + ": The correct domain is selected");
          win.close();
          testIndex++;
          gBrowser.addTab();
          toDataManager("sub.getpersonas.com:permissions:add:popup");
        }
        else if (testIndex == 5) {
          is(win.gDomains.tree.view.selection.count, 1,
            "Step " + (testIndex + 1) + ": One domain is selected");
          is(win.gDomains.selectedDomain.title, "getpersonas.com",
            "Step " + (testIndex + 1) + ": The correct domain is selected");
          is(win.gTabs.activePanel, "permissionsPanel",
            "Step " + (testIndex + 1) + ": Permissions panel is selected");
          is(win.gPerms.addSelBox.hidden, false,
            "Step " + (testIndex + 1) + ": The addition box is shown");
          is(win.gPerms.addHost.value, "sub.getpersonas.com",
            "Step " + (testIndex + 1) + ": The correct host has been entered");
          is(win.gPerms.addType.value, "popup",
            "Step " + (testIndex + 1) + ": The correct permission type has been selected");
          testIndex++;
          toDataManager("foo.geckoisgecko.org:permissions:add:image");
        }
        else {
          Services.obs.removeObserver(testObs, DATAMAN_LOADED);
          is(win.gDomains.tree.view.selection.count, 1,
            "Step " + (testIndex + 1) + ": One domain is selected");
          is(win.gDomains.selectedDomain.title, "*",
            "Step " + (testIndex + 1) + ": The correct domain is selected");
          is(win.gTabs.activePanel, "permissionsPanel",
            "Step " + (testIndex + 1) + ": Permissions panel is selected");
          is(win.gPerms.addSelBox.hidden, false,
            "Step " + (testIndex + 1) + ": The addition box is shown");
          is(win.gPerms.addHost.value, "foo.geckoisgecko.org",
            "Step " + (testIndex + 1) + ": The correct host has been entered");
          is(win.gPerms.addType.value, "image",
            "Step " + (testIndex + 1) + ": The correct permission type has been selected");
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
