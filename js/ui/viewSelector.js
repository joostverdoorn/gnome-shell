// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gtk = imports.gi.Gtk;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Signals = imports.signals;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const AppDisplay = imports.ui.appDisplay;
const ContactDisplay = imports.ui.contactDisplay;
const Main = imports.ui.main;
const PlaceDisplay = imports.ui.placeDisplay;
const Search = imports.ui.search;
const SearchDisplay = imports.ui.searchDisplay;
const ShellEntry = imports.ui.shellEntry;
const Tweener = imports.ui.tweener;
const Wanda = imports.ui.wanda;
const WorkspacesView = imports.ui.workspacesView;

const ANIMATION_TIME;

const ViewSelector = new Lang.Class({
    Name: 'ViewSelector',

    _init : function() {
        ANIMATION_TIME = Main.overview.ANIMATION_TIME;

        this.actor = new St.BoxLayout({ name: 'viewSelector',
                                        vertical: true });

        this._pageArea = new Shell.Stack();
        this.actor.add(this._pageArea, { x_fill: true,
                                         y_fill: true,
                                         expand: true });
        this._activePage;

        this._workspacesDisplay = new WorkspacesView.WorkspacesDisplay();
        this._workspacesPage = new St.Bin({ child: this._workspacesDisplay.actor,
                                 x_align: St.Align.START,
                                 y_align: St.Align.START,
                                 x_fill: true,
                                 y_fill: true,
                                 style_class: 'view-tab-page' });        
        this._pageArea.add_actor(this._workspacesPage);

        this._appDisplay = new AppDisplay.AllAppDisplay();
        this._appsPage = new St.Bin({ child: this._appDisplay.actor,
                                 x_align: St.Align.START,
                                 y_align: St.Align.START,
                                 x_fill: true,
                                 y_fill: true,
                                 style_class: 'view-tab-page' });
        this._pageArea.add_actor(this._appsPage);

        this._searchSystem = new Search.SearchSystem();
        this._openSearchSystem = new Search.OpenSearchSystem();
        this._searchResults = new SearchDisplay.SearchResults(this._searchSystem, this._openSearchSystem);
        this._searchPage = new St.Bin({ child: this._searchResults.actor,
                                 x_align: St.Align.START,
                                 y_align: St.Align.START,
                                 x_fill: true,
                                 y_fill: true,
                                 style_class: 'view-tab-page' });
        this._pageArea.add_actor(this._searchPage);

        this.addSearchProvider(new Wanda.WandaSearchProvider());
        this.addSearchProvider(new AppDisplay.AppSearchProvider());
        this.addSearchProvider(new AppDisplay.SettingsSearchProvider());
        this.addSearchProvider(new PlaceDisplay.PlaceSearchProvider());
        this.addSearchProvider(new ContactDisplay.ContactSearchProvider());

        this._desktopFade = new St.Bin();
        global.overlay_group.add_actor(this._desktopFade);

        Main.overview.connect('showing', Lang.bind(this,
            function () {
                this.show();
            }));

        Main.overview.connect('shown', Lang.bind(this,
            function () {
                this.showDone();
            }));

        Main.overview.connect('hiding', Lang.bind(this,
            function () {
                this.hide();
            }));

        Main.overview.connect('hidden', Lang.bind(this,
            function() {
                this.hideDone();
            }));
                

        // Public constraints which may be used to tie actors' height or
        // vertical position to the current tab's content; as the content's
        // height and position depend on the view selector's style properties
        // (e.g. font size, padding, spacing, ...) it would be extremely hard
        // and ugly to get these from the outside. While it would be possible
        // to use position and height properties directly, outside code would
        // need to ensure that the content is properly allocated before
        // accessing the properties.
        this.constrainHeight = new Clutter.BindConstraint({ source: this._pageArea,
                                                            coordinate: Clutter.BindCoordinate.HEIGHT });
    },

    show: function() {
        this._activePage = this._workspacesPage;
        this._prevPage = null;

        this._appsPage.hide();
        this._searchPage.hide();
        this._workspacesDisplay.show();

        this._showPage(this._workspacesPage);

        if (!this._desktopFade.child)
            this._desktopFade.child = this._getDesktopClone();

        if (!this._workspacesDisplay.activeWorkspaceHasMaximizedWindows()) {
            this._desktopFade.opacity = 255;
            this._desktopFade.show();
            Tweener.addTween(this._desktopFade,
                             { opacity: 0,
                               time: ANIMATION_TIME,
                               transition: 'easeOutQuad'
                             });
        }
    },

    showDone: function() {
        this._desktopFade.hide();
    },

    hide: function() {
        this._showPage(this._workspacesPage);

        if (!this._workspacesDisplay.activeWorkspaceHasMaximizedWindows()) {
            this._desktopFade.opacity = 0;
            this._desktopFade.show();
            Tweener.addTween(this._desktopFade,
                             { opacity: 255,
                               time: ANIMATION_TIME,
                               transition: 'easeOutQuad' });
        }

        this._workspacesDisplay.zoomFromOverview();        
    },

    hideDone: function() {
        this._workspacesDisplay.hide();
        this._desktopFade.hide();
    },

    _getDesktopClone: function() {
        let windows = global.get_window_actors().filter(function(w) {
            return w.meta_window.get_window_type() == Meta.WindowType.DESKTOP;
        });
        if (windows.length == 0)
            return null;

        let clone = new Clutter.Clone({ source: windows[0].get_texture() });
        clone.source.connect('destroy', Lang.bind(this, function() {
            clone.destroy();
        }));
        return clone;
    },

    addSearchProvider: function(provider) {
        this._searchSystem.registerProvider(provider);
        this._searchResults.createProviderMeta(provider);
    },

    removeSearchProvider: function(provider) {
        this._searchSystem.unregisterProvider(provider);
        this._searchResults.destroyProviderMeta(provider);
    },

    _showPage: function(page) {
        if(page == this._activePage)
            return;

        if(this._activePage) {
            Tweener.addTween(this._activePage,
                             { opacity: 0,
                               time: 0.1,
                               transition: 'easeOutQuad',
                               onComplete: Lang.bind(this,
                                   function() {
                                       this._activePage.hide_all();
                                       this._prevPage = this._activePage;
                                       this._activePage = page;
                                   })
                             });
        }

        page.show_all();
        Tweener.addTween(page,
                         { opacity: 255,
                           time: 0.1,
                           transition: 'easeOutQuad'
                         });
    },

    toggleAppsPage: function(doShow) {
        if(doShow || (doShow == undefined && this._activePage != this._appsPage)) {
            this._showPage(this._appsPage);
        } else if(this._prevPage) {
            this._showPage(this._prevPage);
        }
    },

    doSearch: function(text) {
        this._showPage(this._searchPage);
        this._searchResults.doSearch(text);        
    },

    resetSearch: function() {
        if(this._prevPage && this._prevPage != this._searchPage) {
            this._showPage(this._prevPage);
        }
    }
});
Signals.addSignalMethods(ViewSelector.prototype);
