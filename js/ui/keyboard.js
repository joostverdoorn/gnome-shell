/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Caribou = imports.gi.Caribou;
const Clutter = imports.gi.Clutter;
const DBus = imports.dbus;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const BoxPointer = imports.ui.boxpointer;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;

const KEYBOARD_SCHEMA = 'org.gnome.shell.keyboard';
const SHOW_KEYBOARD = 'show-keyboard';
const KEYBOARD_TYPE = 'keyboard-type';

// Key constants taken from Antler
// FIXME: ought to be moved into libcaribou
const PRETTY_KEYS = {
    'BackSpace': '\u232b',
    'space': ' ',
    'Return': '\u23ce',
    'Caribou_Prefs': '\u2328',
    'Caribou_ShiftUp': '\u2b06',
    'Caribou_ShiftDown': '\u2b07',
    'Caribou_Emoticons': '\u263a',
    'Caribou_Symbols': '123',
    'Caribou_Symbols_More': '{#*',
    'Caribou_Alpha': 'Abc',
    'Tab': 'Tab',
    'Escape': 'Esc',
    'Control_L': 'Ctrl',
    'Alt_L': 'Alt'
};

const CaribouKeyboardIface = {
    name: 'org.gnome.Caribou.Keyboard',
    methods:    [ { name: 'Show',
                    inSignature: 'u',
                    outSignature: ''
                  },
                  { name: 'Hide',
                    inSignature: 'u',
                    outSignature: ''
                  },
                  { name: 'SetCursorLocation',
                    inSignature: 'iiii',
                    outSignature: ''
                  },
                  { name: 'SetEntryLocation',
                    inSignature: 'iiii',
                    outSignature: ''
                  } ],
    properties: [ { name: 'Name',
                    signature: 's',
                    access: 'read' } ]
};

function Key() {
    this._init.apply(this, arguments);
}

Key.prototype = {
    _init : function(key) {
        this._key = key;

        this.actor = this._makeKey();

        this._extended_keys = this._key.get_extended_keys();
        this._extended_keyboard = null;

        if (this._key.name == "Control_L" || this._key.name == "Alt_L")
            this._key.latch = true;

        this._key.connect('key-pressed', Lang.bind(this, function ()
                                                   { this.actor.checked = true }));
        this._key.connect('key-released', Lang.bind(this, function ()
                                                    { this.actor.checked = false; }));

        if (this._extended_keys.length > 0) {
            this._grabbed = false;
            this._eventCaptureId = 0;
            this._key.connect('notify::show-subkeys', Lang.bind(this, this._onShowSubkeysChanged));
            this._boxPointer = new BoxPointer.BoxPointer(St.Side.BOTTOM,
                                                         { x_fill: true,
                                                           y_fill: true,
                                                           x_align: St.Align.START });
            // Adds style to existing keyboard style to avoid repetition
            this._boxPointer.actor.add_style_class_name('keyboard-subkeys');
            this._getExtendedKeys();
            this.actor._extended_keys = this._extended_keyboard;
            this._boxPointer.actor.hide();
            Main.layoutManager.addChrome(this._boxPointer.actor, { visibleInFullscreen: true });
        }
    },

    _makeKey: function () {
        let label = this._key.name;

        if (label.length > 1) {
            let pretty = PRETTY_KEYS[label];
            if (pretty)
                label = pretty;
            else
                label = this._getUnichar(this._key);
        }

        label = GLib.markup_escape_text(label, -1);
        let button = new St.Button ({ label: label,
                                      style_class: 'keyboard-key' });

        button.key_width = this._key.width;
        button.connect('button-press-event', Lang.bind(this, function () { this._key.press(); }));
        button.connect('button-release-event', Lang.bind(this, function () { this._key.release(); }));

        return button;
    },

    _getUnichar: function(key) {
        let keyval = key.keyval;
        let unichar = Gdk.keyval_to_unicode(keyval);
        if (unichar) {
            return String.fromCharCode(unichar);
        } else {
            return key.name;
        }
    },

    _getExtendedKeys: function () {
        this._extended_keyboard = new St.BoxLayout({ style_class: 'keyboard-layout',
                                                     vertical: false });
        for (let i = 0; i < this._extended_keys.length; ++i) {
            let extended_key = this._extended_keys[i];
            let label = this._getUnichar(extended_key);
            let key = new St.Button({ label: label, style_class: 'keyboard-key' });
            key.extended_key = extended_key;
            key.connect('button-press-event', Lang.bind(this, function () { extended_key.press(); }));
            key.connect('button-release-event', Lang.bind(this, function () { extended_key.release(); }));
            this._extended_keyboard.add(key);
        }
        this._boxPointer.bin.add_actor(this._extended_keyboard);
    },

    _onEventCapture: function (actor, event) {
        let source = event.get_source();
        let type = event.type();

        if ((type == Clutter.EventType.BUTTON_PRESS ||
             type == Clutter.EventType.BUTTON_RELEASE) &&
            this._extended_keyboard.contains(source)) {
            source.extended_key.press();
            source.extended_key.release();
            return false;
        }
        if (type == Clutter.EventType.BUTTON_PRESS) {
            this._boxPointer.actor.hide();
            this._ungrab();
            return true;
        }
        return false;
    },

    _ungrab: function () {
        global.stage.disconnect(this._eventCaptureId);
        this._eventCaptureId = 0;
        this._grabbed = false;
        Main.popModal(this.actor);
    },

    _onShowSubkeysChanged: function () {
        if (this._key.show_subkeys) {
            this.actor.fake_release();
            this._boxPointer.actor.raise_top();
            this._boxPointer.setPosition(this.actor, 0.5);
            this._boxPointer.show(true);
            this.actor.set_hover(false);
            if (!this._grabbed) {
                 Main.pushModal(this.actor);
                 this._eventCaptureId = global.stage.connect('captured-event', Lang.bind(this, this._onEventCapture));
                 this._grabbed = true;
            }
            this._key.release();
        } else {
            if (this._grabbed)
                this._ungrab();
            this._boxPointer.hide(true);
        }
    }
};

function Keyboard() {
    this._init.apply(this, arguments);
}

Keyboard.prototype = {
    _init: function () {
        DBus.session.exportObject('/org/gnome/Caribou/Keyboard', this);

        this._timestamp = global.get_current_time();
        this.actor = new St.BoxLayout({ name: 'keyboard', vertical: true, reactive: true });
        Main.layoutManager.keyboardBox.add_actor(this.actor);
        Main.layoutManager.trackChrome(this.actor);
        Main.layoutManager.connect('monitors-changed', Lang.bind(this, this._redraw));

        this._keyboardSettings = new Gio.Settings({ schema: KEYBOARD_SCHEMA });
        this._keyboardSettings.connect('changed', Lang.bind(this, this._settingsChanged));
        this._settingsChanged();
    },

    init: function () {
        if (this._enableKeyboard)
            this._redraw();
    },

    _settingsChanged: function () {
        this._enableKeyboard = this._keyboardSettings.get_boolean(SHOW_KEYBOARD);
        if (!this._enableKeyboard && !this._keyboard)
            return;
        if (this._enableKeyboard && this._keyboard &&
            this._keyboard.keyboard_type == this._keyboardSettings.get_string(KEYBOARD_TYPE))
            return;

        if (this._keyboard)
            this._destroyKeyboard();
        if (this._enableKeyboard)
            this._setupKeyboard();
        else
            Main.layoutManager.hideKeyboard(true);
    },

    _destroyKeyboard: function() {
        if (this._keyboardNotifyId)
            this._keyboard.disconnect(this._keyboardNotifyId);
        if (this._focusNotifyId)
            global.stage.disconnect(this._focusNotifyId);
        this._keyboard = null;
        this.actor.destroy_children();

        this._destroySource();
    },

    _setupKeyboard: function() {
        this._keyboard = new Caribou.KeyboardModel({ keyboard_type: this._keyboardSettings.get_string(KEYBOARD_TYPE) });
        this._groups = {};
        this._current_page = null;

        // Initialize keyboard key measurements
        this._numOfHorizKeys = 0;
        this._numOfVertKeys = 0;

        this._addKeys();

        this._keyboardNotifyId = this._keyboard.connect('notify::active-group', Lang.bind(this, this._onGroupChanged));
        this._focusNotifyId = global.stage.connect('notify::key-focus', Lang.bind(this, this._onKeyFocusChanged));
        this._createSource();
    },

    _onKeyFocusChanged: function () {
        let focus = global.stage.key_focus;

        if (focus == global.stage || focus == null)
            return;

        if (focus instanceof Clutter.Text)
            this.show();
        else {
            if (focus._extended_keys == null)
                this.hide();
        }
    },

    _addKeys: function () {
        let groups = this._keyboard.get_groups();
        for (let i = 0; i < groups.length; ++i) {
             let gname = groups[i];
             let group = this._keyboard.get_group(gname);
             group.connect('notify::active-level', Lang.bind(this, this._onLevelChanged));
             let layers = {};
             let levels = group.get_levels();
             for (let j = 0; j < levels.length; ++j) {
                 let lname = levels[j];
                 let level = group.get_level(lname);
                 let layout = new St.BoxLayout({ style_class: 'keyboard-layout',
                                                 vertical: true });
                 this._loadRows(level, layout);
                 layers[lname] = layout;
                 this.actor.add(layout, { x_fill: false });

                 layout.hide();
             }
             this._groups[gname] = layers;
        }

        this._setActiveLayer();
    },

    _getTrayIcon: function () {
        let trayButton = new St.Button ({ label: "tray", style_class: 'keyboard-key' });
        trayButton.key_width = 1;
        trayButton.connect('button-press-event', Lang.bind(this, function () {
            Main.messageTray.toggle();
        }));

        Main.overview.connect('showing', Lang.bind(this, function () {
            trayButton.reactive = false;
            trayButton.add_style_pseudo_class('grayed');
        }));
        Main.overview.connect('hiding', Lang.bind(this, function () {
            trayButton.reactive = true;
            trayButton.remove_style_pseudo_class('grayed');
        }));

        return trayButton;
    },

    _addRows : function (keys, layout) {
        let keyboard_row = new St.BoxLayout();
        for (let i = 0; i < keys.length; ++i) {
            let children = keys[i].get_children();
            let right_box = new St.BoxLayout({ style_class: 'keyboard-row' });
            let left_box = new St.BoxLayout({ style_class: 'keyboard-row' });
            for (let j = 0; j < children.length; ++j) {
                if (this._numOfHorizKeys == 0)
                    this._numOfHorizKeys = children.length;
                let key = children[j];
                let button = new Key(key);

                if (key.align == 'right')
                    right_box.add(button.actor);
                else
                    left_box.add(button.actor);
                if (key.name == "Caribou_Prefs") {
                    key.connect('key-released', Lang.bind(this, this.hide));

                    // Add new key for hiding message tray
                    right_box.add(this._getTrayIcon());
                }
            }
            keyboard_row.add(left_box, { expand: true, x_fill: false, x_align: St.Align.START });
            keyboard_row.add(right_box, { expand: true, x_fill: false, x_align: St.Align.END });
        }
        layout.add(keyboard_row);
    },

    _loadRows : function (level, layout) {
        let rows = level.get_rows();
        for (let i = 0; i < rows.length; ++i) {
            let row = rows[i];
            if (this._numOfVertKeys == 0)
                this._numOfVertKeys = rows.length;
            this._addRows(row.get_columns(), layout);
        }

    },

    _redraw: function () {
        let monitor = Main.layoutManager.bottomMonitor;
        let maxHeight = monitor.height / 3;
        this.actor.width = monitor.width;

        let layout = this._current_page;
        let verticalSpacing = layout.get_theme_node().get_length('spacing');
        let padding = layout.get_theme_node().get_length('padding');

        let box = layout.get_children()[0].get_children()[0];
        let horizontalSpacing = box.get_theme_node().get_length('spacing');
        let allHorizontalSpacing = (this._numOfHorizKeys - 1) * horizontalSpacing;
        let keyWidth = Math.floor((this.actor.width - allHorizontalSpacing - 2 * padding) / this._numOfHorizKeys);

        let allVerticalSpacing = (this._numOfVertKeys - 1) * verticalSpacing;
        let keyHeight = Math.floor((maxHeight - allVerticalSpacing - 2 * padding) / this._numOfVertKeys);

        let keySize = Math.min(keyWidth, keyHeight);
        this.actor.height = keySize * this._numOfVertKeys + allVerticalSpacing + 2 * padding;

        let rows = this._current_page.get_children();
        for (let i = 0; i < rows.length; ++i) {
            let keyboard_row = rows[i];
            let boxes = keyboard_row.get_children();
            for (let j = 0; j < boxes.length; ++j) {
                let keys = boxes[j].get_children();
                for (let k = 0; k < keys.length; ++k) {
                    let child = keys[k];
                    child.width = keySize * child.key_width;
                    child.height = keySize;
                    if (child._extended_keys) {
                        let extended_keys = child._extended_keys.get_children();
                        for (let n = 0; n < extended_keys.length; ++n) {
                            let extended_key = extended_keys[n];
                            extended_key.width = keySize;
                            extended_key.height = keySize;
                        }
                    }
                }
            }
        }
    },

    _onLevelChanged: function () {
        this._setActiveLayer();
        this._redraw();
    },

    _onGroupChanged: function () {
        this._setActiveLayer();
        this._redraw();
    },

    _setActiveLayer: function () {
        let active_group_name = this._keyboard.active_group;
        let active_group = this._keyboard.get_group(active_group_name);
        let active_level = active_group.active_level;
        let layers = this._groups[active_group_name];

        if (this._current_page != null) {
            this._current_page.hide();
        }

        this._current_page = layers[active_level];
        this._current_page.show();
    },

    _createSource: function () {
        if (this._source == null) {
            this._source = new KeyboardSource(this);
            this._source.setTransient(true);
            Main.messageTray.add(this._source);
        }
    },

    _destroySource: function () {
        if (this._source) {
            this._source.destroy();
            this._source = null;
        }
    },

    show: function () {
        this._redraw();

        Main.layoutManager.showKeyboard();
        this._destroySource();
    },

    hide: function () {
        Main.layoutManager.hideKeyboard();
        this._createSource();
    },

    _moveTemporarily: function () {
        let currentWindow = global.screen.get_display().focus_window;
        let rect = currentWindow.get_outer_rect();

        let newX = rect.x;
        let newY = 3 * this.actor.height / 2;
        currentWindow.move_frame(true, newX, newY);
    },

    _setLocation: function (x, y) {
        if (y >= 2 * this.actor.height)
            this._moveTemporarily();
    },

    // D-Bus methods
    Show: function(timestamp) {
        if (timestamp - this._timestamp < 0)
            return;

        this._timestamp = timestamp;
        this.show();
    },

    Hide: function(timestamp) {
        if (timestamp - this._timestamp < 0)
            return;

        this._timestamp = timestamp;
        this.hide();
    },

    SetCursorLocation: function(x, y, w, h) {
        this._setLocation(x, y);
    },

    SetEntryLocation: function(x, y, w, h) {
        this._setLocation(x, y);
    },

    get Name() {
        return 'gnome-shell';
    }
};
DBus.conformExport(Keyboard.prototype, CaribouKeyboardIface);

function KeyboardSource() {
    this._init.apply(this, arguments);
}

KeyboardSource.prototype = {
    __proto__: MessageTray.Source.prototype,

    _init: function(keyboard) {
        this._keyboard = keyboard;
        MessageTray.Source.prototype._init.call(this, _("Keyboard"));

        this._setSummaryIcon(this.createNotificationIcon());
    },

    createNotificationIcon: function() {
        return new St.Icon({ icon_name: 'input-keyboard',
                             icon_type: St.IconType.SYMBOLIC,
                             icon_size: this.ICON_SIZE });
    },

     handleSummaryClick: function() {
        let event = Clutter.get_current_event();
        if (event.type() != Clutter.EventType.BUTTON_RELEASE)
            return false;

        this.open();
        return true;
    },

    open: function() {
        this._keyboard.show();
    }
};