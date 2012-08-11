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
const Main = imports.ui.main;
const PlaceDisplay = imports.ui.placeDisplay;
const Search = imports.ui.search;
const SearchDisplay = imports.ui.searchDisplay;
const ShellEntry = imports.ui.shellEntry;
const Tweener = imports.ui.tweener;
const Wanda = imports.ui.wanda;
const WorkspacesView = imports.ui.workspacesView;


const SearchEntry = new Lang.Class({
    Name: 'SearchEntry',

    _init: function() {
        this.actor = new St.Entry({ name: 'searchEntry',
                                     hint_text: _("Type to search..."),
                                     track_hover: true,
                                     can_focus: true });
        ShellEntry.addContextMenu(this.actor);

        this._inactiveIcon = new St.Icon({ style_class: 'search-entry-icon',
                                           icon_name: 'edit-find',
                                           icon_type: St.IconType.SYMBOLIC });
        this._activeIcon = new St.Icon({ style_class: 'search-entry-icon',
                                         icon_name: 'edit-clear',
                                         icon_type: St.IconType.SYMBOLIC });
        this.actor.set_secondary_icon(this._inactiveIcon);

        this._text = this.actor.clutter_text;

        this.active = false;
        this.prevActive = false;

        this._text.connect('key-press-event', Lang.bind(this, this._onKeyPress));
        this.actor.connect('notify::mapped', Lang.bind(this, this._onMapped));

        this._text.connect('text-changed', Lang.bind(this, this._onTextChanged));
    },

    hide: function() {
        if(this.active)
            this.reset();
    },

    reset: function() {
        global.stage.set_key_focus(null);

        this.actor.text = '';

        this._text.set_cursor_visible(true);
        this._text.set_selection(0, 0);

        this.emit('reset');
    },

    _isActivated: function() {
        return this._text.text == this.actor.get_text();
    },

    _onMapped: function() {
        if (this.actor.mapped) {
            // Enable 'find-as-you-type'
            this._capturedEventId = global.stage.connect('captured-event',
                                 Lang.bind(this, this._onCapturedEvent));
            this._text.set_cursor_visible(true);
            this._text.set_selection(0, 0);
        } else {
           // Disable 'find-as-you-type'
            if (this._capturedEventId > 0)
                global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }
    },

    get appearFocused() {
        return this.actor.has_style_pseudo_class('focus');
    },

    set appearFocused(focus) {
        this._text.set_cursor_visible(focus);
        if (focus)
            this.actor.add_style_pseudo_class('focus');
        else
            this.actor.remove_style_pseudo_class('focus');
    },

    _onTextChanged: function (se, prop) {
        this.prevActive = this.active;
        this.active = this.actor.get_text() != '';

        if (this.active) {
            this.actor.set_secondary_icon(this._activeIcon);

            if (this._iconClickedId == 0) {
                this._iconClickedId = this.actor.connect('secondary-icon-clicked',
                    Lang.bind(this, function() {
                        this.reset();
                    }));
            }
        } else {
            this.actor.set_secondary_icon(this._inactiveIcon);
            if (this._iconClickedId > 0)
                this.actor.disconnect(this._iconClickedId);
            this._iconClickedId = 0;
        }
    },

    _onKeyPress: function(entry, event) {
        let symbol = event.get_key_symbol();
        if (symbol == Clutter.Escape) {
            if (this._isActivated()) {
                this.reset();
                return true;
            }
        } else if (symbol == Clutter.Return || symbol == Clutter.KP_Enter) {
            // Define our own 'activate' signal here, because search providers
            // might want to do something with the modifiers in activateDefault,
            // which ClutterText::activate doesn't allow
            this.emit('activate');
            return true;
        }
        return false;
    },

    _onCapturedEvent: function(actor, event) {
        if (event.type() == Clutter.EventType.BUTTON_PRESS) {
            let source = event.get_source();
            if (source != this._text && this._text.text == '' &&
                !Main.layoutManager.keyboardBox.contains(source)) {
                // the user clicked outside after activating the entry, but
                // with no search term entered and no keyboard button pressed
                // - cancel the search
                this.reset();
            }
        }

        return false;
    }
});
Signals.addSignalMethods(SearchEntry.prototype);


const ViewSelector = new Lang.Class({
    Name: 'ViewSelector',

    _init : function(searchEntry, showAppsButton) {
        this.actor = new St.BoxLayout({ name: 'viewSelector',
                                        vertical: true });

        this._showAppsButton = showAppsButton;
        this._showAppsButton.connect('notify::checked', Lang.bind(this,
            function() {
                this.showAppsPage(this._showAppsButton.checked);
            }));

        this._searchEntry = searchEntry;
        this._searchEntry.connect('reset', Lang.bind(this,
            function() {
                this.showAppsPage(this._showAppsButton.checked);
            }));
        this._searchEntry.connect('activate', Lang.bind(this,
            function() {
                if (this._searchTimeoutId > 0) {
                    Mainloop.source_remove(this._searchTimeoutId);
                    this._doSearch();
                }
                this._searchResults.activateDefault();
            }));

        this.entryActor = this._searchEntry.actor;
        this.entryActor.clutter_text.connect('key-focus-in', Lang.bind(this,
            function() {
                this._searchResults.highlightDefault(true);
            }));
        this.entryActor.clutter_text.connect('key-focus-out', Lang.bind(this,
            function() {
                this._searchResults.highlightDefault(false);
            }));
        global.stage.connect('notify::key-focus', Lang.bind(this,
            function() {
                let focus = global.stage.get_key_focus();
                let appearFocused = (this.entryActor.contains(focus) ||
                                     this._searchResults.actor.contains(focus));
                this._searchEntry.appearFocused = appearFocused;
            }));
        this.entryActor.clutter_text.connect('text-changed', Lang.bind(this, this._onTextChanged));
        this.entryActor.clutter_text.connect('key-press-event', Lang.bind(this, this._onKeyPress));

        this._pageArea = new Shell.Stack();
        this.actor.add(this._pageArea, { x_fill: true,
                                         y_fill: true,
                                         expand: true });
        this._activePage;

        this._workspacesDisplay = new WorkspacesView.WorkspacesDisplay();
        this._workspacesPage = this._createPage(this._workspacesDisplay.actor);
        this._pageArea.add_actor(this._workspacesPage);

        this._appDisplay = new AppDisplay.AllAppDisplay();
        this._appsPage = this._createPage(this._appDisplay.actor);
        this._pageArea.add_actor(this._appsPage);

        this._searchSystem = new Search.SearchSystem();
        this._openSearchSystem = new Search.OpenSearchSystem();
        this._searchResults = new SearchDisplay.SearchResults(this._searchSystem, this._openSearchSystem);
        this._searchPage = this._createPage(this._searchResults.actor);
        this._pageArea.add_actor(this._searchPage);

        // Default search providers
        // Wanda comes obviously first
        this.addSearchProvider(new Wanda.WandaSearchProvider());
        this.addSearchProvider(new AppDisplay.AppSearchProvider());
        this.addSearchProvider(new AppDisplay.SettingsSearchProvider());
        this.addSearchProvider(new PlaceDisplay.PlaceSearchProvider());

        Main.ctrlAltTabManager.addGroup(this._searchEntry.actor, _("Search"), 'edit-find');
        Main.ctrlAltTabManager.addGroup(this._appDisplay.actor, _("Applications"), 'system-run',
                                        { proxy: this.actor,
                                          focusCallback: Lang.bind(this,
                                              function() {
                                                  this._a11yFocusPage(this._appsPage);
                                              })
                                        });;
        Main.ctrlAltTabManager.addGroup(this._workspacesDisplay.actor, _("Windows"), 'text-x-generic',
                                        { proxy: this.actor,
                                          focusCallback: Lang.bind(this,
                                              function() {
                                                  this._a11yFocusPage(this._workspacesPage);
                                              })
                                        });

        Main.overview.connect('item-drag-begin',
                              Lang.bind(this, this._resetShowAppsButton));

        this._stageKeyPressId = 0;
        Main.overview.connect('showing', Lang.bind(this,
            function () {
                this._resetShowAppsButton();
                this._stageKeyPressId = global.stage.connect('key-press-event',
                                                             Lang.bind(this, this._onStageKeyPress));
            }));
        Main.overview.connect('hiding', Lang.bind(this,
            function () {
                this._resetShowAppsButton();
                if (this._stageKeyPressId != 0) {
                    global.stage.disconnect(this._stageKeyPressId);
                    this._stageKeyPressId = 0;
                }
            }));

        global.focus_manager.add_group(this._searchResults.actor);

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

        this._appsPage.hide();
        this._searchPage.hide();
        this._workspacesDisplay.show();

        if (!this._workspacesDisplay.activeWorkspaceHasMaximizedWindows())
            Main.overview.fadeOutDesktop();

        this._showPage(this._workspacesPage);
    },

    zoomFromOverview: function() {
        if (!this._workspacesDisplay.activeWorkspaceHasMaximizedWindows())
            Main.overview.fadeInDesktop();

        this._workspacesDisplay.zoomFromOverview();
    },

    hide: function() {
        this._workspacesDisplay.hide();
    },

    _createPage: function(actor) {
        return new St.Bin({ child: actor,
                            x_align: St.Align.START,
                            y_align: St.Align.START,
                            x_fill: true,
                            y_fill: true,
                            style_class: 'view-tab-page' });
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

    _a11yFocusPage: function(page) {
        this._showAppsButton.checked = page == this._appsPage;
        if(this._activePage == this._searchPage) {
            this._searchEntry.reset();
        } else {
            this._showPage(page);
        }
        page.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
    },

    showAppsPage: function(doShow) {
        if (this._searchEntry.active)
            this._searchEntry.reset();
        else
            this._showPage(doShow ? this._appsPage : this._workspacesPage);
    },

    _resetShowAppsButton: function() {
        this._showAppsButton.checked = false;
    },

    _onStageKeyPress: function(actor, event) {
        let modifiers = event.get_state();
        let symbol = event.get_key_symbol();

        if (symbol == Clutter.Escape) {
            if (this._searchEntry.active)
                this._searchEntry.reset();
            else
                Main.overview.hide();
            return true;
        } else if (Clutter.keysym_to_unicode(symbol) ||
                   (symbol == Clutter.BackSpace && this._searchEntry.active)) {
            let text = this._searchEntry.actor.clutter_text;
            global.stage.set_key_focus(text);
            text.event(event, false);
        } else if (!this._searchEntry.active) {
            if (symbol == Clutter.Tab) {
                this._activePage.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
                return true;
            } else if (symbol == Clutter.ISO_Left_Tab) {
                this._activePage.navigate_focus(null, Gtk.DirectionType.TAB_BACKWARD, false);
                return true;
            }
        }
        return false;
    },

    _onKeyPress: function(entry, event) {
        if (!this._searchEntry.active)
            return false;

        let arrowNext, nextDirection;
        if (entry.get_text_direction() == Clutter.TextDirection.RTL) {
            arrowNext = Clutter.Left;
            nextDirection = Gtk.DirectionType.LEFT;
        } else {
            arrowNext = Clutter.Right;
            nextDirection = Gtk.DirectionType.RIGHT;
        }

        let symbol = event.get_key_symbol();
        if (symbol == Clutter.Tab) {
            this._searchResults.navigateFocus(Gtk.DirectionType.TAB_FORWARD);
            return true;
        } else if (symbol == Clutter.ISO_Left_Tab) {
            this._searchResults.navigateFocus(Gtk.DirectionType.TAB_BACKWARD);
            return true;
        } else if (symbol == Clutter.Down) {
            this._searchResults.navigateFocus(Gtk.DirectionType.DOWN);
            return true;
        } else if (symbol == arrowNext && this.entryActor.clutter_text.position == -1) {
            this._searchResults.navigateFocus(nextDirection);
            return true;
        }

        return false;
    },

    _onTextChanged: function (se, prop) {
        this._searchPending = this._searchEntry.active && !this._searchEntry.prevActive;
        if (this._searchPending) {
            this._searchResults.startingSearch();
        }

        if (!this._searchEntry.active)  {
            if(this._searchEntry.prevActive) {
                this._searchEntry.reset();
            }

            if (this._searchTimeoutId > 0) {
                Mainloop.source_remove(this._searchTimeoutId);
                this._searchTimeoutId = 0;
            }
            return;
        }

        if (this._searchTimeoutId > 0)
            return;
        this._searchTimeoutId = Mainloop.timeout_add(150, Lang.bind(this, this._doSearch));
    },

    _doSearch: function() {
        this._searchTimeoutId = 0;
        let text = this.entryActor.clutter_text.get_text().replace(/^\s+/g, '').replace(/\s+$/g, '');

        this._showPage(this._searchPage);
        this._searchResults.doSearch(text);
    },

    addSearchProvider: function(provider) {
        this._searchSystem.registerProvider(provider);
        this._searchResults.createProviderMeta(provider);
    },

    removeSearchProvider: function(provider) {
        this._searchSystem.unregisterProvider(provider);
        this._searchResults.destroyProviderMeta(provider);
    }
});
Signals.addSignalMethods(ViewSelector.prototype);
