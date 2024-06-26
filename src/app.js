import { WebSocketClient } from "../lib/clients/websocketClient.js";
import { Client } from "../lib/clients/client.js";
import EventType from "../lib/models/eventType.js";
import { ComponentExt } from "../lib/utils/componentExt.js";
import { LangSelect } from "../lib/utils/langSelect.js";
import { Utils } from "../lib/utils/utils.js";
import { EditForm } from "../lib/editForm.js";
import { LoginBL } from "./forms/login.js";
import ChromeTabs from "../lib/chrometab.js";
export class App {
    static DefaultFeature = Utils.HeadChildren.layout?.content || "index";
    static FeatureLoaded = false;
    static Main() {
        var el = document.querySelector('.chrome-tabs')
        if (el != null) {
            ChromeTabs.init(el);
        }
        if (!LangSelect.Culture) {
            LangSelect.Culture = "vi";
        }
        App.InitApp();
    }

    static InitApp() {
        Client.ModelNamespace = 'TMS.Models.';
        LoginBL.Instance.Render();
        App.LoadByFromUrl();
        Client.SignOutEventHandler.add((x) => {
            EditForm.NotificationClient?.Close();
        });
    }

    static InitPortal() {
        LoginBL.Instance.SignedInHandler += (x) => window.location.reload();
        App.LoadByFromUrl();
        // NotificationBL.Instance.Render();
        EditForm.NotificationClient = new WebSocketClient("task");
        window.addEventListener(EventType.PopState, (e) => {
            App.LoadByFromUrl();
        });
    }

    /**
     * @returns {string}
     */
    static LoadByFromUrl() {
        const fName = App.GetFeatureNameFromUrl() || App.DefaultFeature;
        ComponentExt.InitFeatureByName(fName, true).Done();
        return fName;
    }

    /**
     * @returns {string|null}
     */
    static GetFeatureNameFromUrl() {
        let feature = window.location.pathname.toLowerCase().replace(Client.BaseUri.toLowerCase(), "");
        if (feature.startsWith(Utils.Slash)) {
            feature = feature.substring(1);
        }
        if (!feature.trim()) {
            return null;
        }
        return feature;
    }
}
App.Main();