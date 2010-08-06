/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/
 */

// Test basic functionality of the data manager

Components.utils.import("resource://gre/modules/Services.jsm");

// happen to match what's used in Data Manager itself
var gLocSvc = {
  cookie: Components.classes["@mozilla.org/cookiemanager;1"]
                    .getService(Components.interfaces.nsICookieManager2),
  fhist: Components.classes["@mozilla.org/satchel/form-history;1"]
                   .getService(Components.interfaces.nsIFormHistory2),
  pwd: Components.classes["@mozilla.org/login-manager;1"]
                 .getService(Components.interfaces.nsILoginManager),
}

const DATAMAN_LOADED = "dataman-loaded";
const TEST_DONE = "dataman-test-done";

function test() {
  // Preload data.
  // Note that all that should be set before that are permissions for
  // getpersonas.com and addons.mozilla.org to install addons.
  let now_epoch = parseInt(Date.now() / 1000);

  // Add cookie: not secure, non-HTTPOnly, session
  gLocSvc.cookie.add("bar.example.com", "", "name0", "value0",
                     false, false, true, now_epoch + 600);
  // Add cookie: not secure, HTTPOnly, session
  gLocSvc.cookie.add("foo.example.com", "", "name1", "value1",
                     false, true, true, now_epoch + 600);
  // Add cookie: secure, HTTPOnly, session
  gLocSvc.cookie.add("secure.example.com", "", "name2", "value2",
                     true, true, true, now_epoch + 600);
  // Add cookie: secure, non-HTTPOnly, expiry in an hour
  gLocSvc.cookie.add("mochi.test", "", "name3", "value3",
                     true, false, false, now_epoch + 3600);

  // Add a few form history entries
  gLocSvc.fhist.addEntry("akey", "value0");
  gLocSvc.fhist.addEntry("ekey", "value1");
  gLocSvc.fhist.addEntry("ekey", "value2");
  gLocSvc.fhist.addEntry("bkey", "value3");
  gLocSvc.fhist.addEntry("bkey", "value4");
  gLocSvc.fhist.addEntry("ckey", "value5");

  // Add a few passwords
  let loginInfo1 = Components.classes["@mozilla.org/login-manager/loginInfo;1"]
                             .createInstance(Components.interfaces.nsILoginInfo);
  loginInfo1.init("http://www.example.com", "http://www.example.com", null,
                  "dataman", "mysecret", "user", "pwd");
  gLocSvc.pwd.addLogin(loginInfo1);
  let loginInfo2 = Components.classes["@mozilla.org/login-manager/loginInfo;1"]
                             .createInstance(Components.interfaces.nsILoginInfo);
  loginInfo2.init("gopher://example.com:4711", null, "foo",
                  "dataman", "mysecret", "", "");
  gLocSvc.pwd.addLogin(loginInfo2);

  //Services.prefs.setBoolPref("data_manager.debug", true);

  // Open the Data Manager, testing the menu item.
  let menuitem = document.getElementById("tasksDataman") ||
                 document.getElementById("menu_openDataman");
  menuitem.click();

  var testIndex = 0;
  var win;

  let testObs = {
    observe: function(aSubject, aTopic, aData) {
      if (aTopic == DATAMAN_LOADED) {
        Services.obs.removeObserver(testObs, DATAMAN_LOADED);
        ok(true, "Data Manager should be loaded");
        // Workaround for bug 583567: select about:data tab.
        for (let i = 0; i < gBrowser.browsers.length; i++) {
          if (gBrowser.browsers[i].currentURI.spec == "about:data") {
            gBrowser.tabContainer.selectedIndex = i;
          }
        }

        win = content.wrappedJSObject;
        Services.obs.addObserver(testObs, TEST_DONE, false);
        // Trigger the first test now!
        Services.obs.notifyObservers(window, TEST_DONE, null);
      }
      else {
        // TEST_DONE triggered, run next test
        ok(true, "run test #" + (testIndex + 1) + " of " + testFuncs.length +
                 " (" + testFuncs[testIndex].name + ")");
        testFuncs[testIndex++](win);

        if (testIndex >= testFuncs.length) {
          // Finish this up!
          Services.obs.removeObserver(testObs, TEST_DONE);
          gLocSvc.cookie.removeAll();
          gLocSvc.fhist.removeAllEntries();
          finish();
        }
      }
    }
  };
  waitForExplicitFinish();
  Services.obs.addObserver(testObs, DATAMAN_LOADED, false);
}

var testFuncs = [
function test_open_state(aWin) {
  is(aWin.document.documentElement.id, "dataman-page",
     "The active tab is the Data Manager");
  is(aWin.gDomains.tree.view.rowCount, 5,
     "The correct number of domains is listed");
  is(aWin.gTabs.activePanel, "formdataPanel",
     "Form data panel is selected");

  aWin.document.getElementById("domainSearch").value = "mo";
  aWin.document.getElementById("domainSearch").doCommand();
  is(aWin.gDomains.tree.view.selection.count, 0,
     "In search, non-matching selection is lost");
  is(aWin.gDomains.tree.view.rowCount, 2,
     "In search, the correct number of domains is listed");
  is(aWin.gDomains.displayedDomains.join(","), "mochi.test,mozilla.org",
     "In search, the correct domains are listed");

  aWin.gDomains.tree.view.selection.select(0);
  aWin.document.getElementById("domainSearch").value = "";
  aWin.document.getElementById("domainSearch").doCommand();
  is(aWin.gDomains.tree.view.rowCount, 5,
     "After search, the correct number of domains is listed");
  is(aWin.gDomains.tree.view.selection.count, 1,
     "After search, number of selections is correct");
  is(aWin.gDomains.selectedDomain.title, "mochi.test",
     "After search, matching selection is kept correctly");

  aWin.gDomains.tree.view.selection.select(0);
  is(aWin.gDomains.selectedDomain.title, "*",
     "* domain is selected again");
  Services.obs.notifyObservers(window, TEST_DONE, null);
},

function test_fdata_panel(aWin) {
  is(aWin.gTabs.activePanel, "formdataPanel",
     "Form data panel is selected");
  is(aWin.gFormdata.tree.view.rowCount, 6,
     "The correct number of form data entries is listed");

  aWin.gFormdata.tree.view.selection.rangedSelect(0, 1, true); // idx: 0, 3
  aWin.document.getElementById("fdataSearch").value = "b"; // idx 3, 4 match
  aWin.document.getElementById("fdataSearch").doCommand();
  is(aWin.gFormdata.tree.view.selection.count, 1,
     "In search, non-matching part of selection is lost");
  is(aWin.gFormdata.displayedFormdata[aWin.gFormdata.tree.currentIndex], 3,
     "In search, matching part selection is kept correctly");
  is(aWin.gFormdata.tree.view.rowCount, 2,
     "In search, the correct number of form data entries is listed");
  is(aWin.gFormdata.displayedFormdata.join(","), "3,4",
     "In search, the correct domains are listed");

  aWin.document.getElementById("fdataSearch").value = "";
  aWin.document.getElementById("fdataSearch").doCommand();
  is(aWin.gFormdata.tree.view.rowCount, 6,
     "After search, the correct number of form data entries is listed");
  is(aWin.gFormdata.tree.view.selection.count, 1,
     "After search, number of selections is correct");
  is(aWin.gFormdata.displayedFormdata[aWin.gFormdata.tree.currentIndex], 3,
     "After search, matching selection is kept correctly");

  aWin.gFormdata.tree.view.selection.clearSelection();
  is(aWin.document.getElementById("fdataRemove").disabled, true,
     "The remove button is disabled");
  aWin.gFormdata.tree.view.selection.rangedSelect(0, 1, true); // value0, value3
  aWin.gFormdata.tree.view.selection.rangedSelect(3, 3, true); // value5
  aWin.gFormdata.tree.view.selection.rangedSelect(5, 5, true); // value2
  is(aWin.gFormdata.tree.view.selection.count, 4,
     "The correct number of items is selected");
  is(aWin.document.getElementById("fdataRemove").disabled, false,
     "After selecting, the remove button is enabled");

  gLocSvc.fhist.removeEntry("ckey", "value5");
  is(aWin.gFormdata.tree.view.rowCount, 5,
     "After remove, the correct number of form data entries is listed");
  is(aWin.gFormdata.tree.view.selection.count, 3,
     "After remove, the correct number of items is selected");

  gLocSvc.fhist.addEntry("dkey", "value6");
  is(aWin.gFormdata.tree.view.rowCount, 6,
     "After add, the correct number of form data entries is listed");
  is(aWin.gFormdata.tree.view.selection.count, 3,
     "After add, the correct number of items is selected");

  aWin.document.getElementById("fdataValueCol").click();
  is(aWin.gFormdata.tree.view.selection.count, 3,
     "After sort, the correct number of items is selected");
  let selvalues = "";
  let selections = aWin.gDataman.getTreeSelections(aWin.gFormdata.tree);
  for (let i = 0; i < selections.length; i++) {
    selvalues += aWin.gFormdata.formdata[aWin.gFormdata.displayedFormdata[selections[i]]].value;
  }
  is(selvalues, "value0value2value3",
     "After sort, correct items are selected");

   // Select only one for testing remove button, as catching the prompt is hard.
  aWin.gFormdata.tree.view.selection.select(5);
  aWin.document.getElementById("fdataRemove").click();
  is(aWin.gFormdata.tree.view.rowCount, 5,
     "After remove button, the correct number of form data entries is listed");
  is(aWin.gFormdata.tree.view.selection.count, 0,
     "After remove button, no items are selected");
  Services.obs.notifyObservers(window, TEST_DONE, null);
},

function test_cookies_panel(aWin) {
  aWin.gDomains.tree.view.selection.select(1);
  is(aWin.gDomains.selectedDomain.title, "example.com",
     "For cookie tests 1, correct domain is selected");
  is(aWin.gTabs.activePanel, "cookiesPanel",
     "Cookies panel is selected");
  is(aWin.gCookies.tree.view.rowCount, 3,
     "The correct number of cookies is listed");

  aWin.gCookies.tree.view.selection.select(0);
  is(aWin.document.getElementById("cookieInfoSendType").value,
     "Any type of connection",
     "Correct send type for first cookie");
  is(aWin.document.getElementById("cookieInfoExpires").value,
     "At end of session",
     "Correct expiry label for first cookie");

  aWin.gCookies.tree.view.selection.select(1);
  is(aWin.document.getElementById("cookieInfoSendType").value,
     "Any type of connection, no script access",
     "Correct send type for second cookie");

  aWin.gCookies.tree.view.selection.select(2);
  is(aWin.document.getElementById("cookieInfoSendType").value,
     "Encrypted connections only and no script access",
     "Correct send type for third cookie");

  aWin.gDomains.tree.view.selection.select(3);
  is(aWin.gDomains.selectedDomain.title, "mochi.test",
     "For cookie tests 2, correct domain is selected");
  is(aWin.gTabs.activePanel, "cookiesPanel",
     "Cookies panel is selected");
  is(aWin.gCookies.tree.view.rowCount, 1,
     "The correct number of cookies is listed");
  aWin.gCookies.updateContext(); // don't actually open it, would be async
  is(aWin.document.getElementById("cookies-context-selectall").disabled, false,
     "The select all context menu item is enabled");
  is(aWin.document.getElementById("cookies-context-remove").disabled, true,
     "The remove context menu item is disabled");

  aWin.document.getElementById("cookies-context-selectall").click();
  is(aWin.document.getElementById("cookieInfoSendType").value,
     "Encrypted connections only",
     "Correct send type for third cookie");
  isnot(aWin.document.getElementById("cookieInfoExpires").value,
        "At end of session",
        "Expiry label for this cookie is not session");
  aWin.gCookies.updateContext(); // don't actually open it, would be async
  is(aWin.document.getElementById("cookies-context-selectall").disabled, true,
     "After selecting, the select all context menu item is disabled");
  is(aWin.document.getElementById("cookies-context-remove").disabled, false,
     "After selecting, the remove context menu item is enabled");

  aWin.document.getElementById("cookies-context-remove").click();
  is(aWin.gDomains.tree.view.rowCount, 4,
     "The domain has been removed from the list");
  is(aWin.gTabs.activePanel, null,
     "No panel is active");
  is(aWin.gTabs.tabbox.selectedTab.disabled, true,
     "The selected panel is disabled");
  Services.obs.notifyObservers(window, TEST_DONE, null);
},

function test_permissions_panel(aWin) {
  aWin.gDomains.tree.view.selection.select(2);
  is(aWin.gDomains.selectedDomain.title, "getpersonas.com",
     "For permissions tests, correct domain is selected");
  is(aWin.gTabs.activePanel, "permissionsPanel",
     "Permissions panel is selected");
  Services.perms.add(Services.io.newURI("http://cookie.getpersonas.com/", null, null),
                     "cookie", Components.interfaces.nsICookiePermission.ACCESS_SESSION);
  Services.perms.add(Services.io.newURI("http://cookie2.getpersonas.com/", null, null),
                     "cookie", Services.perms.DENY_ACTION);
  Services.perms.add(Services.io.newURI("http://geo.getpersonas.com/", null, null),
                     "geo", Services.perms.ALLOW_ACTION);
  Services.perms.add(Services.io.newURI("http://image.getpersonas.com/", null, null),
                     "image", Services.perms.DENY_ACTION);
  Services.perms.add(Services.io.newURI("http://install.getpersonas.com/", null, null),
                     "install", Services.perms.ALLOW_ACTION);
  Services.perms.add(Services.io.newURI("http://popup.getpersonas.com/", null, null),
                     "popup", Services.perms.ALLOW_ACTION);
  Services.perms.add(Services.io.newURI("http://test.getpersonas.com/", null, null),
                     "test", Services.perms.DENY_ACTION);
  gLocSvc.pwd.setLoginSavingEnabled("password.getpersonas.com", false);
  is(aWin.gPerms.list.children.length, 9,
     "The correct number of permissions is displayed in the list");
  for (let i = 1; i < aWin.gPerms.list.children.length; i++) {
    let perm = aWin.gPerms.list.children[i];
    switch (perm.type) {
      case "cookie":
        is(perm.labelElement.value, "Set Cookies",
           "Correct label for type: " + perm.type);
        is(perm.capability, perm.host == "cookie.getpersonas.com" ? 8 : 2,
           "Correct capability for: " + perm.host);
        perm.useDefault(true);
        is(perm.capability, 1,
           "Set back to correct default");
        break;
      case "geo":
        is(perm.labelElement.value, "Share Location",
           "Correct label for type: " + perm.type);
        is(perm.capability, 1,
           "Correct capability for: " + perm.host);
        perm.useDefault(true);
        is(perm.capability, 2,
           "Set back to correct default");
        break;
      case "image":
        is(perm.labelElement.value, "Load Images",
           "Correct label for type: " + perm.type);
        is(perm.capability, 2,
           "Correct capability for: " + perm.host);
        perm.useDefault(true);
        is(perm.capability, 1,
           "Set back to correct default");
        break;
      case "install":
        is(perm.labelElement.value, "Install Add-ons",
           "Correct label for type: " + perm.type);
        is(perm.capability, 1,
           "Correct capability for: " + perm.host);
        perm.useDefault(true);
        is(perm.capability, 2,
           "Set back to correct default");
        break;
      case "password":
        is(perm.labelElement.value, "Save Passwords",
           "Correct label for type: " + perm.type);
        is(perm.capability, 2,
           "Correct capability for: " + perm.host);
        perm.useDefault(true);
        is(perm.capability, 1,
           "Set back to correct default");
        break;
      case "popup":
        is(perm.labelElement.value, "Open Popup Windows",
           "Correct label for type: " + perm.type);
        is(perm.capability, 1,
           "Correct capability for: " + perm.host);
        perm.useDefault(true);
        is(perm.capability, 1,
           "Set back to correct default");
        break;
      default:
        is(perm.labelElement.value, perm.type,
           "Correct default label for type: " + perm.type);
        is(perm.capability, 2,
           "Correct capability for: " + perm.host);
        perm.useDefault(true);
        // For some reason (TM bug?) .capability comes across as a string atm.
        is(perm.capability.toString(), false.toString(),
           "Set to correct default");
       break;
    }
  }

  aWin.gDomains.tree.view.selection.select(0); // Switch to * domain.
  aWin.gDomains.tree.view.selection.select(2); // Switch back to rebuild the perm list.
  is(aWin.gPerms.list.children.length, 1,
     "After the test, the correct number of permissions is displayed in the list");
  Services.obs.notifyObservers(window, TEST_DONE, null);
},

function test_prefs_panel(aWin) {
  Services.contentPrefs.setPref("my.mochi.test", "data_manager.test", "foo");
  Services.contentPrefs.setPref("mochi.test", "data_manager.test", "bar");
  is(aWin.gDomains.tree.view.rowCount, 5,
     "The domain for prefs tests has been added from the list");
  aWin.gDomains.tree.view.selection.select(3);
  is(aWin.gDomains.selectedDomain.title, "mochi.test",
     "For prefs tests, correct domain is selected");
  is(aWin.gTabs.activePanel, "preferencesPanel",
     "Preferences panel is selected");
  is(aWin.gPrefs.tree.view.rowCount, 2,
     "The correct number of prefs is listed");

  aWin.gDomains.updateContext(); // don't actually open it, would be async
  is(aWin.document.getElementById("domain-context-forget").disabled, false,
     "The domain's forget context menu item is enabled");

  aWin.document.getElementById("domain-context-forget").click();
  is(aWin.gTabs.activePanel, "forgetPanel",
     "Forget panel is selected");
  is(aWin.document.getElementById("forgetTab").disabled, false,
     "Forget panel is enabled");
  is(aWin.document.getElementById("forgetTab").hidden, false,
     "Forget panel is unhidden");

  aWin.gDomains.tree.view.selection.select(2);
  isnot(aWin.gDomains.selectedDomain.title, "mochi.test",
        "Switching away goes to a different domain: " + aWin.gDomains.selectedDomain.title);
  isnot(aWin.gTabs.activePanel, "forgetPanel",
        "Forget panel is not selected any more: " + aWin.gTabs.activePanel);
  is(aWin.document.getElementById("forgetTab").disabled, true,
     "Forget panel is disabled");
  is(aWin.document.getElementById("forgetTab").hidden, true,
     "Forget panel is disabled");

  aWin.gDomains.tree.view.selection.select(3);
  is(aWin.gDomains.selectedDomain.title, "mochi.test",
     "Correct domain is selected again");
  aWin.document.getElementById("domain-context-forget").click();
  is(aWin.gTabs.activePanel, "forgetPanel",
     "Forget panel is selected again");
  is(aWin.document.getElementById("forgetTab").disabled, false,
     "Forget panel is enabled again");
  is(aWin.document.getElementById("forgetTab").hidden, false,
     "Forget panel is unhidden again");

  is(aWin.document.getElementById("forgetPreferences").disabled, false,
     "Forget preferences checkbox is enabled");
  aWin.document.getElementById("forgetPreferences").click();
  is(aWin.document.getElementById("forgetPreferences").checked, true,
     "Forget preferences checkbox is checked");
  is(aWin.document.getElementById("forgetButton").disabled, false,
     "Forget button is enabled");

  aWin.document.getElementById("forgetButton").click();
  is(aWin.document.getElementById("forgetButton").hidden, true,
     "Forget button is hidden");
  is(aWin.document.getElementById("forgetPreferences").hidden, true,
     "Forget preferences checkbox is hidden");
  is(aWin.document.getElementById("forgetPreferencesLabel").hidden, false,
     "Forget preferences label is shown");
  is(aWin.document.getElementById("forgetTab").hidden, true,
     "Forget tab is hidden again");
  is(aWin.document.getElementById("forgetTab").disabled, true,
     "Forget panel is disabled again");

  is(aWin.gDomains.tree.view.rowCount, 4,
     "The domain for prefs tests has been removed from the list");
  is(aWin.gDomains.tree.view.selection.count, 0,
     "No domain is selected");

  aWin.gDomains.updateContext(); // don't actually open it, would be async
  is(aWin.document.getElementById("domain-context-forget").disabled, true,
     "The domain's forget context menu item is disabled");
  Services.obs.notifyObservers(window, TEST_DONE, null);
},

function test_passwords_panel(aWin) {
  aWin.gDomains.tree.view.selection.select(1);
  is(aWin.gDomains.selectedDomain.title, "example.com",
     "For passwords tests, correct domain is selected");
  is(aWin.gTabs.activePanel, "cookiesPanel",
     "Cookies panel is selected");

  aWin.gDomains.updateContext(); // don't actually open it, would be async
  is(aWin.document.getElementById("domain-context-forget").disabled, false,
     "The domain's forget context menu item is enabled");

  aWin.document.getElementById("domain-context-forget").click();
  is(aWin.gTabs.activePanel, "forgetPanel",
     "Forget panel is selected");
  is(aWin.document.getElementById("forgetTab").disabled, false,
     "Forget panel is enabled");
  is(aWin.document.getElementById("forgetTab").hidden, false,
     "Forget panel is unhidden");
  is(aWin.document.getElementById("forgetPreferences").hidden, false,
     "Forget preferences checkbox is shown");
  is(aWin.document.getElementById("forgetPreferences").disabled, true,
     "Forget preferences checkbox is disabled");
  is(aWin.document.getElementById("forgetPreferencesLabel").hidden, true,
     "Forget preferences label is hidden");
  is(aWin.document.getElementById("forgetCookies").hidden, false,
     "Forget cookies checkbox is shown");
  is(aWin.document.getElementById("forgetCookies").disabled, false,
     "Forget cookies checkbox is enabled");
  is(aWin.document.getElementById("forgetCookiesLabel").hidden, true,
     "Forget cookies label is hidden");
  is(aWin.document.getElementById("forgetPasswords").hidden, false,
     "Forget passwords checkbox is shown");
  is(aWin.document.getElementById("forgetPasswords").disabled, false,
     "Forget passwords checkbox is enabled");
  is(aWin.document.getElementById("forgetPasswordsLabel").hidden, true,
     "Forget passwords label is hidden");
  is(aWin.document.getElementById("forgetButton").hidden, false,
     "Forget button is shown");
  is(aWin.document.getElementById("forgetButton").disabled, false,
     "Forget button is enabled");

  aWin.gTabs.tabbox.selectedTab = aWin.document.getElementById("passwordsTab");
  is(aWin.gTabs.activePanel, "passwordsPanel",
     "Passwords panel is selected");
  is(aWin.gPasswords.tree.view.rowCount, 2,
     "The correct number of passwords is listed");
  is(aWin.document.getElementById("pwdRemove").disabled, true,
     "The remove button is disabled");

  aWin.gPasswords.tree.view.selection.select(0);
  is(aWin.document.getElementById("pwdRemove").disabled, false,
     "After selecting, the remove button is enabled");

  aWin.document.getElementById("pwdRemove").click();
  is(aWin.gPasswords.tree.view.rowCount, 1,
     "After deleting, the correct number of passwords is listed");
  is(aWin.gPasswords.tree.view.selection.count, 0,
     "After deleting, no passwords are selected");
  is(aWin.document.getElementById("pwdRemove").disabled, true,
     "After deleting, the remove button is disabled");

  aWin.gPasswords.tree.view.selection.select(0);
  aWin.document.getElementById("pwdRemove").click();
  is(aWin.gTabs.activePanel, "cookiesPanel",
     "After deleting last password, cookies panel is selected again");
  Services.obs.notifyObservers(window, TEST_DONE, null);
},

function test_close(aWin) {
  function dmWindowClosedListener() {
    aWin.removeEventListener("unload", dmWindowClosedListener, false);
    isnot(content.document.documentElement.id, "dataman-page",
       "The active tab is not the Data Manager");
    Services.obs.notifyObservers(window, TEST_DONE, null);
  }
  aWin.addEventListener("unload", dmWindowClosedListener, false);
  if (gBrowser.browsers.length < 2)
    gBrowser.addTab("about:blank");
  aWin.close();
}
];