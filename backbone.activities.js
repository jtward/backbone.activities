/*jshint newcap:false */
(function(root, factory) {
    "use strict";

    var Backbone = window.Backbone;

    // AMD. Register as an anonymous module.  Wrap in function so we have access
    // to root via `this`.
    if (typeof define === "function" && define.amd) {
        return define(["backbone", "underscore", "jquery"], function() {
            var args = [root].concat( Array.prototype.slice.call(arguments) );
            return factory.apply(root, args);
        });
    }

    // Browser globals.
    _.extend(Backbone, factory.call(root, root, Backbone, window._, Backbone.$));
})(typeof global === "object" ? global : this, function (root, Backbone, _, $) {
    "use strict";

    var VERSION = '0.8.2';

    Backbone.ActivityRouter = Backbone.Router.extend({

        constructor: function(options) {
            options = options || {};

            // routes is an optional map from url fragments to either functions on the router (like ordinary Backbone routers)
            // or activity::subactivity strings
            this.routes = this.activityRoutes = options.routes || this.routes;

            // initialLayout is a string. If defined, the layout is set later in the constructor
            // it may be specified in the class or overridden when instantiated
            this._initialLayout = options.initialLayout || this.initialLayout;

            // stores a reference to each activity by name
            this._activities = {};

            // intially empty arrays which hold a list of the currently active activities
            this._currentActivities = [];

            // routes is an array of objects which contain the route RegEx as well as the
            // corresponding activity and handler
            this._routes = [];

            // call Backbone.Router.bindRoutes to process defined routes
            this._bindRoutes();

            // initialize initial layout.
            // if the router is responsive, setLayout should be called whenever the desired
            // layout changes.
            if (this._initialLayout) {
                this.setLayout(this._initialLayout);
            }

            // Call router's initialize functions
            this.initialize.apply(this, arguments);
        },

        // wraps Backbone.Router.Route to add support for activity::subactivity strings
        // and binding arguments to routes.
        route: function (route, handlerString, callback) {
            var _route = Backbone.Router.prototype.route;

            // if a callback is passed then the route is a custom route; defer to
            // Backbone.Router.route
            if (callback) {
                return _route.apply(this, arguments);
            }

            // if no callback was passed but 'handlerString' matches a function on the router
            // then route is an ordinary Backbone route; call Backbone.Router.route
            // with the handlerString as the name
            if (this[handlerString] && typeof this[handlerString] === "function") {
                return _route.call(this, route, handlerString);
            }

            // else route is an activityroute: first we process the
            // activity string into an array of activities
            var activities = this._processActivityRoute(handlerString);

            // if route is not a RegExp, convert it to one
            if (!_.isRegExp(route)) route = this._routeToRegExp(route);

            // add the route to the internal array
            this._routes.push({
                route: route,
                activities: activities
            });

            // call Backbone.Router.route with a custom callback function
            // using the complete handlerString as name for uniqueness
            var router = this;
            return _route.call(this, route, handlerString, function() {
                router._handleRoute(activities, Array.prototype.slice.apply(arguments));
            });
        },

        // processes an activity::subactivity string into an array of activities,
        // and configures those activities as necessary
        _processActivityRoute: function (handlerString) {
            var i,
                handlerParts = handlerString.split('::'),
                parent,
                activities = [],
                activity,
                activityName, localName,
                subactivities = this.activities;

            activity = this.activities;
            for (i = 0; i < handlerParts.length; i++) {
                activityName = handlerParts.slice(0, i + 1).join("-");
                localName = handlerParts[i];

                // attempt to fetch activity from cache
                activity = this._activities[activityName];

                // if there's no cached activity, create one
                if (!activity) {
                    activity = (subactivities && subactivities[localName]);

                    if (activity) {
                        parent = (activities.length > 0) ? activities[activities.length - 1] : undefined;
                        activity = this._setupActivity(activity, activityName, parent);
                    }
                    else {
                        break;
                    }
                }

                // push the activity onto the array, and get subactivities for further processing
                activities.push(activity);
                subactivities = activity && (activity.activities);
            }

            // if no activities were found for a given route, throw an error
            if (activities.length < 1) {
                throw new Error("Activity '" + activityName + "' not found (note: activity names are case sensitive)");
            }
            // if some activities were found, but not all of the specfied ones, then warn but continue
            else if (activities.length < handlerParts.length) {
                root.console.warn("Sub-activity '" + activityName + "' not found, resolving to " + _.pluck(activities, "name").join("::"));
            }

            return activities;
        },

        _setupActivity: function(activity, activityName, parent) {
            // if activity is a non-instantiated class, instantiate it.
            if (!(activity instanceof Backbone.Activity)) activity = new activity();

            activity.router = this;
            activity.parent = activity.activity = parent || undefined;
            activity.name = activityName.toLowerCase();
            activity._isSetup = true;

            this._activities[activityName] = activity;

            return activity;
        },

        // _getFragmentRoute takes either a url fragment (e.g. #!/people/john)
        // or an activities route string (e.g. people::detail)
        // and returns the activity hierarchy associated with that route.
        _getFragmentRoute: function(fragment) {
            var handlerParts, result, i, parent, activityName,
                activities = [];

            // trim # characters from start of fragment
            fragment = fragment.replace(/^#+/, '');

            // check if a route with given fragment exists
            for (i = this._routes.length - 1; i >= 0; i -= 1) {
                if (this._routes[i].route.test(fragment)) {
                    result = this._routes[i];
                    break;
                }
            }

            // if it does then fetch arguments, and return it
            if (result) {
                var args = this._extractParameters(result.route, fragment);
                if (args) {
                    result.args = args;
                }
            }
            // else, treat fragment as an activity::subactivity string
            else {
                handlerParts = fragment.split('::');

                if (!this._activities[handlerParts.join("-")]){
                    activities = this._processActivityRoute(fragment);
                }
                else {
                    _.each(handlerParts, function (localName, i) {
                        activityName = handlerParts.slice(0, i + 1).join("-");
                        activities.push( this._activities[activityName] );
                    }, this);
                }

                result = {
                    activities: activities
                };
            }

            return result;
        },

        // handle a route
        // checks for a redirect first; if found, calls _redirectRoute
        // otherwise calls _handleLifecycle
        _handleRoute: function(activities, args) {
            var i, j, entity, r, activity, redirect;

            // only attempt to route if Backbone history has started
            if (!Backbone.History.started) {
                return root.console.warn("Not routing: Backbone history not started.");
            }

            // router + activities
            var redirectEntities = [this].concat(activities);

            // search router + activities in hierachy for 'redirect' property
            for (i = 0; i < redirectEntities.length; i++) {
              entity = redirectEntities[i];

                // if redirect property is a function, call it and return its return value
                if (typeof entity.redirect === "function") {
                    redirect = entity.redirect.apply(entity, args);
                    if (redirect) {
                        // redirect can return a string or an object
                        if (typeof redirect === "string") {
                            this._redirectRoute(redirect);
                            return;
                        }
                        else if (typeof redirect === "object" && typeof redirect.redirect === "string") {
                            this._redirectRoute(redirect.redirect, redirect);
                            return;
                        }
                    }
                }
            }
            
            this._handleLifecycle(activities, args);
        },

        _redirectRoute: function(fragment, options) {
            var redirect = this._getFragmentRoute(fragment);

            // if given a real fragment, update the hash unless explicitly told not to via
            // the options object
            if (redirect.route && (!_.isObject(options) || options.updateHash !== false)) {
                Backbone.history.navigate(fragment, { replace: true, trigger: false });
            }

            // if given an activity hierarchy string, args may be provided in the options object
            else if (!redirect.route && _.isObject(options) && _.isArray(options.args)) {
                redirect.args = options.args;
            }

            this._handleRoute(redirect.activities, redirect.args);
        },

        // handle the activity lifecycle
        _handleLifecycle: function(activities, args) {
            var router = this,
                oldActivities,
                newActivities,
                i,
                l,
                index,
                oldActivity,
                newActivity;

            // find the index of the first activity that is different to the already loaded activities
            index = router._currentActivities.length;
            for (i = 0; i < router._currentActivities.length; i++) {
                oldActivity = router._currentActivities[i];
                newActivity = activities[i];

                if (!newActivity.name || newActivity.name !== oldActivity.name) {
                    index = i;
                    break;
                }
            }

            // if all activities are the same, but arguments have changed, reinit the deepest activity
            if (index > 0 && index === router._currentActivities.length && args !== router._currentArgs && args && _.intersection(args, router._currentArgs).length !== args.length) {
                index -= 1;
            }

            // old actvities are activity in currentActivities past index
            // reverse order so that deepest is deinitialized first
            oldActivities = router._currentActivities.slice(index).reverse();

            // new activities are activities in 'activities' past index
            newActivities = activities.slice(index);

            l = oldActivities.length;
            for(i = 0; i < l; i += 1) {
                oldActivities[i].stop();
            }

            router._currentActivities = activities;
            router._currentArgs = args;

            l = newActivities.length;
            for(i = 0; i < l; i += 1) {
                newActivity = newActivities[i];
                newActivity.start(args);
            }
        },

        // invokes an activity hierarchy without changing the URL fragment
        silentRoute: function (fragment) {
            var route = this._getFragmentRoute(fragment);
            if (route) {
                this._handleRoute(route.activities, route.args);
            }
        },

        // re-invokes the current activity hierarchy
        reload: function() {
            // Only attempt to reload if Backbone history has started
            if (!Backbone.History.started) return;

            this.silentRoute(Backbone.history.fragment);
        },

        // acitivates an app 'layout' by triggering the corresponding layout function in each
        // activity in the current activity hierarchy (deepest last).
        // useful in responsive app for invoking layout specific code
        setLayout: function(name) {
            var router = this;

            // if 'name' is already the current layout, return
            if (router.currentLayout === name) return $.Deferred().resolve();

            // save new layout name
            router.currentLayout = name;

            // call activity.layouts[name]() on each activity, deepest last
            _.each(router._currentActivities, function (activity) {
                if (activity && activity.layouts && activity.layouts[router.currentLayout]) {
                    activity.layouts[router.currentLayout].apply(activity, router._currentArgs);
                }
            });
        },

        VERSION: VERSION

    });

    // activity constructor
    Backbone.Activity = function(options) {
        this._configure(options || {});
        this.initialize.apply(this, arguments);
    };

    // mix events into the prototype
    _.extend(Backbone.Activity.prototype, Backbone.Events, {

        // performs the initial configuration of an Activity with a set of options.
        // keys with special meaning *(routes, activities, redirect, layouts)*
        // are attached directly to the activity.
        _configure: function(options) {
            _.extend(this, _.pick(options, "activities", "redirect", "layouts"));
        },

        // initialization stub.
        initialize: function() {},

        // the router uses this value to determine whether to call an activity's onCreate
        // callback
        _initialized: false,

        // callback stubs
        onCreate: function() {},
        onStart: function() {},
        onStop: function() {},

        start: function (args) {
            if (!this._initialized) {
                this._initialized = true;
                this.onCreate.apply(this, args);
            }

            this.onStart.apply(this, args);

            if (this.router.currentLayout &&
                this.layouts &&
                typeof this.layouts[this.router.currentLayout] === 'function') {
                this.layouts[this.router.currentLayout].apply(this, args);
            }
        },

        stop: function () {
            this.onStop.apply(this, this.router._currentArgs);
        },

        // layouts is an object of layout names to layout functions
        layouts: {},

        VERSION: VERSION

    });

    Backbone.Activity.extend = Backbone.View.extend;

    // The module returns Activity and ActivityRouter
    return {
        "Activity": Backbone.Activity,
        "ActivityRouter": Backbone.ActivityRouter
    };
});