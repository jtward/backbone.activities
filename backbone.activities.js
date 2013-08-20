/*jshint newcap:false */
(function(root, factory) {
    "use strict";

    var Backbone, _, $;

    // AMD. Register as an anonymous module.  Wrap in function so we have access
    // to root via `this`.
    if (typeof define === "function" && define.amd) {
        return define(["backbone", "underscore", "jquery"], function() {
            var args = [root].concat( Array.prototype.slice.call(arguments) );
            return factory.apply(root, args);
        });
    }

    // Node. Does not work with strict CommonJS, but only CommonJS-like
    // enviroments that support module.exports like Node.
    if (typeof exports === 'object') {
        Backbone = require('backbone');
        _ = require('lodash');
        $ = _.extend(require('cheerio'), require("underscore.deferred"));
        module.exports = factory(root, Backbone, _, $);
    }

    // Browser globals.
    Backbone = root.Backbone;
    _ = root._ || root.underscore || root.lodash;
    $ = (Backbone && Backbone.$) || root.$ || root.jQuery || root.Zepto || root.ender;
    _.extend(Backbone, factory.call(root, root, Backbone, _, $));

})(typeof global === "object" ? global : this, function (root, Backbone, _, $) {
    "use strict";

    var asyncEach = function (array, cb, context, args) {
        var dfd = $.Deferred(),
            i = -1;

        var iterate = function (array, cb, dfd) {
            i++;
            if (i >= array.length) return dfd.resolveWith(context);

            $.when( cb.call(context, array[i], i, args) )
                .always(function () {
                    iterate(array, cb, dfd);
                });
        };

        iterate(array, cb, dfd);

        return dfd;
    };

    var VERSION = '0.8.0dev';

    Backbone.ActivityRouter = Backbone.Router.extend({

        constructor: function(options) {
            options = options || {};

            // an ActivityRouter's el is the point at which the layout class is added.
            // this lets you hook CSS onto specific layouts
            var el = options.el || this.el || (document && document.body);
            if (el) this._$el = $(el);

            // routes is an optional map from url fragments to either functions on the router (like ordinary Backbone routers)
            // or activity::subactivity strings
            this.routes = this.activityRoutes = options.activityRoutes || options.routes || this.activityRoutes || this.routes;

            // defaultRoute is a url fragment. It may be specified in the class or overridden
            // when instantiated
            this._defaultRoute = options.defaultRoute || this.defaultRoute;

            // initialLayout is a string. If defined, the layout is set later in the constructor
            // It may be specified in the class or overridden when instantiated
            this._initialLayout = options.initialLayout || this.initialLayout;

            // Stores a reference to each activity by name
            this._activities = {};

            // Intially empty arrays which hold a list of the currently active activities
            this._currentActivities = [];

            // routes is an array of objects which contain the route RegEx as well as the
            // corresponding activity and handler
            this._routes = [];

            // call Backbone.Router.bindRoutes to process defined routes
            this._bindRoutes();

            // set up the default route
            if (_.isString(this._defaultRoute)) {
                // the default route may contain arguments
                this._defaultRoute = this._getFragmentRoute(this._defaultRoute);
                this._addRoute('', this._defaultRoute.args);
            }

            // initialize initial layout.
            // if the router is responsive, setLayout should be called whenever the desired
            // layout changes.
            if (this._initialLayout) {
                this.setLayout(this._initialLayout);
            }

            // Call router's initialize functions
            this.initialize.apply(this, arguments);
        },

        // Wraps Backbone.Router.Route to add support for Activity::SubActivity strings 
        // and binding arguments to routes.
        // Supports everything that Backbone.Router.Route supports
        route: function (route, handlerString, callback, args) {
            var nativeRoute = Backbone.Router.prototype.route;

            // If callback is passed, then route is a custom route:
            // defer to Backbone.Router.route
            if (callback) {
                return nativeRoute.apply(this, arguments);
            }

            // If no callback, but 'handlerString' matches a function on the router
            // then route is an ordinary Backbone route: call Backbone.Router.route
            // with the handlerString as the name
            if (this[handlerString] && typeof this[handlerString] === "function") {
                return nativeRoute.call(this, route, handlerString);
            }

            // Else route is an ActivityRoute: first we process the
            // Activity::SubActivity string into an array of activities
            var activities = this._processActivityRoute(handlerString);

            // If route is not a RegExp, convert it to one
            if (!_.isRegExp(route)) route = this._routeToRegExp(route);

            // The we add the route to the internal array
            this._routes.push({
                route: route,
                activities: activities,
                args: args // args is used only for defaultRoute
            });

            // Finally we call Backbone.Router.route with a custom callback function
            // using the  complete handlerString as name for uniqueness
            var router = this;
            return nativeRoute.call(this, route, handlerString, function() {
                router._handleRoute(activities, args || Array.prototype.slice.apply(arguments));
            });
        },

        // Processes an Activity::SubActivity string into an array of activities,
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

                // Attempt to fetch activity from cache
                activity = this._activities[activityName];

                // If no cached activity, create one
                if (!activity) {
                    activity = (subactivities && subactivities[ localName ]);

                    if (activity) {
                        parent = (activities.length > 0) ? activities[activities.length - 1] : undefined;
                        activity = this._setupActivity(activity, activityName, parent);
                    }
                }

                // If could not creat one, then exit early
                if (!activity) break;

                // Push activity to list, and get subactivities for further processing
                activities.push(activity);
                subactivities = activity && (activity.subactivities || activity.handlers);
            }

            // If no activities were found for a given route, throw an error
            if (activities.length < 1) {
                throw new Error("Activity '" + activityName + "' not found (note: activity names are case sensitive)");
            }
            // If some activities were found, but not all of the specfied ones, then warn but continue
            else if (activities.length < handlerParts.length) {
                root.console.warn("Sub-activity '" + activityName + "' not found, resolving to " + _.pluck(activities, "name").join("::"));
            }

            return activities;
        },

        _setupActivity: function(activity, activityName, parent) {
            // If activity is a non-instantiated class, instantiate it.
            if (!(activity instanceof Backbone.Activity)) activity = new activity();

            activity.router = this;
            activity.parent = parent || undefined;
            activity.name = activityName.toLowerCase();
            activity._isSetup = true;
            
            this._activities[activityName] = activity;

            return activity;
        },

        // Takes either a url fragment (e.g. #!/people/john)
        // or an activities route string (e.g. people::detail)
        // and returns the activity hierarchy associated with that route.
        _getFragmentRoute: function(fragment) {
            var parts, result, i, parent,
                activities = [];

            // Case for activities route string
            if ((handlerParts = fragment.split('::')).length > 0) {

                if (!this._activities[handlerParts.join("-")]){
                    activities = this._processActivityRoute(fragment);
                }
                else {
                    _.each(handlerParts, function (localName, i) {
                        activityName = handlerParts.slice(0, i + 1).join("-");
                        activities.push( this._activities[activityName] );
                    });
                }

                result = {
                    activities: activities
                };
            }
            // Case for URL fragment
            else {
                fragment = fragment.replace(/^#+/, '');

                for (i = this._routes.length - 1; i >= 0; i -= 1) {
                    if (this._routes[i].route.test(fragment)) {
                        result = this._routes[i];
                        break;
                    }
                }

                var args = this._extractParameters(result.route, fragment);
                if (args) {
                    result.args = args;
                }
            }
            return result;
        },

        // handle a route
        // checks for a redirect first; if found, calls _redirectRoute
        // otherwise calls _handleLifecycle
        _handleRoute: function(activities, args) {
            var i, activity, redirect;

            // Only attempt to route if Backbone history has started
            if (!Backbone.History.started) return root.console.warn("Not routing: Backbone history not started.");

            // Check for redirect function in activity hierarchy, redirect if true
            for (i = 0; i < activities.length; i++) {
                activity = activities[i];
                redirect = activity.redirect && activity.redirect.apply(activity, args);
                if (redirect) return this._redirectRoute(redirect);
            }

            // Update stored fragments if there is no redirect
            this._previousFragment = this._internalFragment;
            this._internalFragment = Backbone.history.fragment;

            // Otherwise continue the activity lifecycle
            root.console.log("Routing to " + _.pluck(activities, "name").join("::"));
            return this._handleLifecycle(activities, args);
        },

        _redirectRoute: function(redirect) {
            var parts;
            if (redirect.trigger) {
                // if trigger is true we know that the fragment is not an Activity::handler string
                this.navigate(redirect.fragment, redirect);
            }
            else {
                redirect = this._getFragmentRoute(redirect);
                return this._handleRoute(redirect.activities, redirect.args);
            }
        },

        // Handle the activity lifecycle
        _handleLifecycle: function(activities, args) {
            var router = this,

            // Activities to be stopped (set in getChangedActivities)
            oldActivities,

            // Activities to be started (set in getChangedActivities)
            newActivities,

            getChangedActivities = function () {
                // Find the index of the first activity that is different to the already loaded activities
                var index = router._currentActivities.length;
                _.find(router._currentActivities, function (activity, i) {
                    if (!activities[i].name || activity.name !== activities[i].name) {
                        index = i;
                        return true;
                    }
                });

                // If all activities are the same, but arguments have changed, reinit the deepest activity
                if (index > 0 && index === router._currentActivities.length && _.difference(args, router._currentArgs).length > 0) {
                    index -= 1;
                }

                // Old actvities are activity in currentActivities past index
                // Reverse order so that deepest is deinitialized first
                oldActivities = router._currentActivities.slice(index).reverse();

                // new activities are activities in 'activities' past index
                newActivities = activities.slice(index);
            },

            // Call stop methods and remove classes of old activities, deepest first
            stopOldActivities = function () {
                return asyncEach(oldActivities, function (activity) {
                    activity.stop();
                });
            },

            // Store current activities and arguments    
            saveActivities = function () {
                router._currentActivities = activities;
                router._currentArgs = args;
            },

            // Call start methods on new activities (deepest last)
            startNewActivities = function () {
                asyncEach(newActivities, function (activity) {
                    activity.start(args);
                });
            };

            return $.when( getChangedActivities() )
                .then(stopOldActivities)
                .then(saveActivities)
                .then(startNewActivities);

        },

        // Invokes an activity hierarchy without changing the URL fragment
        silentRoute: function (fragment) {
            var route = this._getFragmentRoute(fragment);
            return route && this._handleRoute(route.activities, route.args);
        },

        // Re-invokes the current activity hierarchy
        reload: function() {
            return this.silentRoute(this._internalFragment);
        },

        // Acitivates an app 'layout' by triggering the corresponding layout function in each
        // activity in the current activity hierarchy (deepest last).
        // Useful in responsive app for invoking layout specific code
        setLayout: function(name) {
            var router = this;

            // If 'name' is already the current layout, return
            if (router.currentLayout === name) return $.Deferred().resolve();

            // update the layout class on the parent element
            if (router._$el) {
                router._$el.removeClass('layout-' + router.currentLayout).addClass('layout-' + name);
            }

            // Save new layout name
            router.currentLayout = name;

            // Call activity.layouts[name]() on each activity, deepest last
            return asyncEach(router._currentActivities, function (activity) {

                var processTaskQueue = function() {
                    return activity.processTaskQueue.apply(activity, router._currentArgs);
                },

                callLayoutHandler = function () {
                    return activity.layouts[router.currentLayout].apply(activity, router._currentArgs);
                };

                if (activity && activity.layouts && activity.layouts[router.currentLayout]) {
                    return $.when(callLayoutHandler)
                        .then(callLayoutHandler);
                }
            }, router);
        },

        VERSION: VERSION

    });

    // Activity constructor
    Backbone.Activity = function(options) {
        this._configure(options || {});
        this.initialize.apply(this, arguments);
    };

    // mix events into the prototype
    _.extend(Backbone.Activity.prototype, Backbone.Events, {

        // Performs the initial configuration of an Activity with a set of options.
        // Keys with special meaning *(routes, subactivities, redirect, layouts)*
        // are attached directly to the activity.
        _configure: function(options) {
            _.extend(this, _.pick(options, "routes", "subactivities", "redirect", "layouts"));
            if (!this.subactivities && options.handlers) this.subactivities = options.handlers;
        },

        // Initialize is an empty function by default. Override it with your own
        // initialization logic.
        initialize: function() {},

        // The router uses this value to determine whether to call an activity's onCreate
        // callback
        _initialized: false,

        // callback stubs
        onCreate: function() {},
        onStart: function() {},
        onStop: function() {},

        start: function (args) {
            var activity = this,
                router = activity.router,

            processTaskQueue = function() {
                return activity.processTaskQueue.apply(activity, router._currentArgs);
            },

            addActivityClassToDOM = function () {
                if (router._$el) {
                    router._$el.addClass("activity-" + activity.name);
                }
            },

            saveArgs = function () {
                this._currentArgs = args;
            },

            // Call onCreate if this is the first time the activity has been called
            initializeActivity = function() {
                if (!activity._initialized) {
                    activity._initialized = true;
                    return activity.onCreate.apply(activity, activity._currentArgs);
                }
            },

            // Call activity onStart method
            startActivity = function () {
                return activity.onStart.apply(activity, activity._currentArgs);
            },

            // Call activity layout method with currentLayout
            setActivityLayout = function () {
                if (router.currentLayout &&
                    activity.layouts &&
                    typeof activity.layouts[router.currentLayout] === 'function') {
                    activity.layouts[router.currentLayout].apply(activity, activity._currentArgs);
                }
            };

            return $.when( addActivityClassToDOM() )
                .then(saveArgs)

                .then(initializeActivity)
                .then(processTaskQueue)

                .then(startActivity)
                .then(processTaskQueue)

                .then(setActivityLayout)
                .then(processTaskQueue);
        },

        // Calls an Activity's onStop method and processes the task queue
        stop: function () {
            var activity = this,
                router = activity.router,

            processTaskQueue = function() {
                return activity.processTaskQueue.apply(activity, router._currentArgs);
            },

            stopActivity = function () {
                return activity.onStop.apply(activity, router._currentArgs);
            },

            removeClassFromDOM = function() {
                if (router._$el) {
                    router._$el.removeClass("activity-" + activity.name);
                }
            };

            return $.when( stopActivity() )
                .then(processTaskQueue)
                .then(removeClassFromDOM);
        },

        // layouts is an object of layout names to layout functions
        layouts: {},

        // tasks is an object of task names to task functions
        tasks: {},

        // the queueTasks function uses this to store queued tasks 
        _taskQueue: [],

        // Adds specified tasks to the task queue
        queueTasks: function (/* taskNames */) {
            this._taskQueue.push.apply(this._taskQueue, arguments);
        },

        // Adds the specified tasks to the task queue,
        // but only if they are not already in it
        queueTasksOnce: function (/* taskNames */) {
            _.each(arguments, function (taskName) {
                if (_.indexOf(this._taskQueue, taskName) === -1) {
                    this._taskQueue.push(taskName);
                }
            }, this);
        },

        // Call each of the tasks in the task queue in order,
        // and then clears the task queue.
        processTaskQueue: function () {
            return asyncEach(this._taskQueue, this.runTask, this)
                .always(function() {
                    this._taskQueue = [];
                });
        },

        // Runs the specified tasks in order
        runTasks: function (/* taskNames */) {
            return asyncEach(arguments, this.runTask, this);
        },

        // Runs the task 'taskName'
        runTask: function (taskName) {
            var task = this.tasks[taskName];
            if (task) return task.apply(this, this.router._currentArgs);
        },

        VERSION: VERSION

    });

    // use backbone's extend (referencing via View here, but they're all the same)
    Backbone.Activity.extend = Backbone.View.extend;

    // Activity constructor
    Backbone.ActivityRouteHandler = Backbone.Activity.extend({
        updateRegions: function () {
            root.console.error("The updateRegions function has been removed from backbone.activities. Please use built in LayoutManager function instead.");
        }
    });

    // The module returns Activity and ActivityRouter
    return {
        "Activity": Backbone.Activity,
        "ActivityRouter": Backbone.ActivityRouter
    };
});