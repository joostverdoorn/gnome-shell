// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Signals = imports.signals;
const Shell = imports.gi.Shell;
const Util = imports.misc.util;

const FileUtils = imports.misc.fileUtils;
const Main = imports.ui.main;

const DISABLED_OPEN_SEARCH_PROVIDERS_KEY = 'disabled-open-search-providers';

// Not currently referenced by the search API, but
// this enumeration can be useful for provider
// implementations.
const MatchType = {
    NONE: 0,
    SUBSTRING: 1,
    PREFIX: 2
};

const SearchResultDisplay = new Lang.Class({
    Name: 'SearchResultDisplay',

    _init: function(provider) {
        this.provider = provider;
        this.actor = null;
    },

    /**
     * renderResults:
     * @results: List of identifier strings
     * @terms: List of search term strings
     *
     * Display the given search matches which resulted
     * from the given terms.  It's expected that not
     * all results will fit in the space for the container
     * actor; in this case, show as many as makes sense
     * for your result type.
     *
     * The terms are useful for search match highlighting.
     */
    renderResults: function(results, terms) {
        throw new Error('Not implemented');
    },

    /**
     * clear:
     * Remove all results from this display.
     */
    clear: function() {
        this.actor.destroy_all_children();
    },

    /**
     * getVisibleResultCount:
     *
     * Returns: The number of actors visible.
     */
    getVisibleResultCount: function() {
        throw new Error('Not implemented');
    },
});

/**
 * SearchProvider:
 *
 * Subclass this object to add a new result type
 * to the search system, then call registerProvider()
 * in SearchSystem with an instance.
 * Search is asynchronous and uses the
 * getInitialResultSet()/getSubsearchResultSet() methods.
 */
const SearchProvider = new Lang.Class({
    Name: 'SearchProvider',

    _init: function(title) {
        this.title = title;
        this.searchSystem = null;
    },

    /**
     * getInitialResultSet:
     * @terms: Array of search terms, treated as logical AND
     *
     * Called when the user first begins a search (most likely
     * therefore a single term of length one or two), or when
     * a new term is added.
     *
     * Should "return" an array of result identifier strings representing
     * items which match the given search terms.  This
     * is expected to be a substring match on the metadata for a given
     * item.  Ordering of returned results is up to the discretion of the provider,
     * but you should follow these heruistics:
     *
     *  * Put items where the term matches multiple criteria (e.g. name and
     *    description) before single matches
     *  * Put items which match on a prefix before non-prefix substring matches
     *
     * We say "return" above, but in order to make the query asynchronous, use
     * this.searchSystem.pushResults();. The return value should be ignored.
     *
     * This function should be fast; do not perform unindexed full-text searches
     * or network queries.
     */
    getInitialResultSet: function(terms) {
        throw new Error('Not implemented');
    },

    /**
     * getSubsearchResultSet:
     * @previousResults: Array of item identifiers
     * @newTerms: Updated search terms
     *
     * Called when a search is performed which is a "subsearch" of
     * the previous search; i.e. when every search term has exactly
     * one corresponding term in the previous search which is a prefix
     * of the new term.
     *
     * This allows search providers to only search through the previous
     * result set, rather than possibly performing a full re-query.
     *
     * Similar to getInitialResultSet, the return value for this will
     * be ignored; use this.searchSystem.pushResults();.
     */
    getSubsearchResultSet: function(previousResults, newTerms) {
        throw new Error('Not implemented');
    },

    /**
     * getResultMetas:
     * @ids: Result identifier strings
     *
     * Call callback with array of objects with 'id', 'name', (both strings) and
     * 'createIcon' (function(size) returning a Clutter.Texture) properties
     * with the same number of members as @ids
     */
    getResultMetas: function(ids, callback) {
        throw new Error('Not implemented');
    },

    /**
     * createResultActor:
     * @resultMeta: Object with result metadata
     * @terms: Array of search terms, should be used for highlighting
     *
     * Search providers may optionally override this to render a
     * particular serch result in a custom fashion.  The default
     * implementation will show the icon next to the name.
     *
     * The actor should be an instance of St.Widget, with the style class
     * 'search-result-content'.
     */
    createResultActor: function(resultMeta, terms) {
        return null;
    },

    /**
     * activateResult:
     * @id: Result identifier string
     *
     * Called when the user chooses a given result.
     */
    activateResult: function(id) {
        throw new Error('Not implemented');
    }
});
Signals.addSignalMethods(SearchProvider.prototype);

const OpenSearchSystem = new Lang.Class({
    Name: 'OpenSearchSystem',

    _init: function() {
        this._providers = [];
        global.settings.connect('changed::' + DISABLED_OPEN_SEARCH_PROVIDERS_KEY, Lang.bind(this, this._refresh));
        this._refresh();
    },

    getProviders: function() {
        let res = [];
        for (let i = 0; i < this._providers.length; i++)
            res.push({ id: i, name: this._providers[i].name });

        return res;
    },

    setSearchTerms: function(terms) {
        this._terms = terms;
    },

    _checkSupportedProviderLanguage: function(provider) {
        if (provider.url.search(/{language}/) == -1)
            return true;

        let langs = GLib.get_language_names();

        langs.push('en');
        let lang = null;
        for (let i = 0; i < langs.length; i++) {
            for (let k = 0; k < provider.langs.length; k++) {
                if (langs[i] == provider.langs[k])
                    lang = langs[i];
            }
            if (lang)
                break;
        }
        provider.lang = lang;
        return lang != null;
    },

    activateResult: function(id, params) {
        let searchTerms = this._terms.join(' ');

        let url = this._providers[id].url.replace('{searchTerms}', encodeURIComponent(searchTerms));
        if (url.match('{language}'))
            url = url.replace('{language}', this._providers[id].lang);

        try {
            Gio.app_info_launch_default_for_uri(url, global.create_app_launch_context());
        } catch (e) {
            // TODO: remove this after glib will be removed from moduleset
            // In the default jhbuild, gio is in our prefix but gvfs is not
            Util.spawn(['gvfs-open', url])
        }

        Main.overview.hide();
    },

    _addProvider: function(fileName) {
        let path = global.datadir + '/open-search-providers/' + fileName;
        let source = Shell.get_file_contents_utf8_sync(path);
        let [success, name, url, langs, icon_uri] = Shell.parse_search_provider(source);
        let provider ={ name: name,
                        url: url,
                        id: this._providers.length,
                        icon_uri: icon_uri,
                        langs: langs };
        if (this._checkSupportedProviderLanguage(provider)) {
            this._providers.push(provider);
            this.emit('changed');
        }
    },

    _refresh: function() {
        this._providers = [];
        let names = global.settings.get_strv(DISABLED_OPEN_SEARCH_PROVIDERS_KEY);
        let file = Gio.file_new_for_path(global.datadir + '/open-search-providers');
        FileUtils.listDirAsync(file, Lang.bind(this, function(files) {
            for (let i = 0; i < files.length; i++) {
                let enabled = true;
                let name = files[i].get_name();
                for (let k = 0; k < names.length; k++)
                    if (names[k] == name)
                        enabled = false;
                if (enabled)
                    this._addProvider(name);
            }
        }));
    }
});
Signals.addSignalMethods(OpenSearchSystem.prototype);

const SearchSystem = new Lang.Class({
    Name: 'SearchSystem',

    _init: function() {
        this._providers = [];
        this.reset();
    },

    registerProvider: function (provider) {
        provider.searchSystem = this;
        this._providers.push(provider);
    },

    unregisterProvider: function (provider) {
        let index = this._providers.indexOf(provider);
        if (index == -1)
            return;
        provider.searchSystem = null;
        this._providers.splice(index, 1);
    },

    getProviders: function() {
        return this._providers;
    },

    getTerms: function() {
        return this._previousTerms;
    },

    reset: function() {
        this._previousTerms = [];
        this._previousResults = [];
    },

    pushResults: function(provider, results) {
        let i = this._providers.indexOf(provider);
        if (i == -1)
            return;

        this._previousResults[i] = [provider, results];
        this.emit('search-updated', this._previousResults[i]);
    },

    updateSearch: function(searchString) {
        searchString = searchString.replace(/^\s+/g, '').replace(/\s+$/g, '');
        if (searchString == '')
            return;

        let terms = searchString.split(/\s+/);
        this.updateSearchResults(terms);
    },

    updateSearchResults: function(terms) {
        if (!terms)
            return;

        let isSubSearch = terms.length == this._previousTerms.length;
        if (isSubSearch) {
            for (let i = 0; i < terms.length; i++) {
                if (terms[i].indexOf(this._previousTerms[i]) != 0) {
                    isSubSearch = false;
                    break;
                }
            }
        }

        let previousResultsArr = this._previousResults;

        let results = [];
        this._previousTerms = terms;
        this._previousResults = results;

        if (isSubSearch) {
            for (let i = 0; i < this._providers.length; i++) {
                let [provider, previousResults] = previousResultsArr[i];
                try {
                    results.push([provider, []]);
                    provider.getSubsearchResultSet(previousResults, terms);
                } catch (error) {
                    log('A ' + error.name + ' has occured in ' + provider.title + ': ' + error.message);
                }
            }
        } else {
            for (let i = 0; i < this._providers.length; i++) {
                let provider = this._providers[i];
                try {
                    results.push([provider, []]);
                    provider.getInitialResultSet(terms);
                } catch (error) {
                    log('A ' + error.name + ' has occured in ' + provider.title + ': ' + error.message);
                }
            }
        }
    },
});
Signals.addSignalMethods(SearchSystem.prototype);
