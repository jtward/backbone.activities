/*jshint newcap:false */
(function(root) {
    "use strict";

    var Backbone = root.Backbone;
    var _ = root._ || root.underscore || root.lodash;
    var $ = Backbone.$ || root.$ || root.jQuery || root.Zepto || root.ender;
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
            var that = this;

            // an ActivityRouter's el is the point at which the layout class is added.
            // this lets you hook CSS onto specific layouts
            this._$el = $(options.el || this.el || document.body);

            // routes is an optional map from url fragments to either functions on the router (like ordinary Backbone routers)
            // or activity::subactivity strings
            this.routes = this.activityRoutes = options.activityRoutes || this.activityRoutes || this.routes;

            // defaultRoute is a url fragment. It may be specified in the class or overridden
            // when instantiated
            this._defaultRoute = options.defaultRoute || this.defaultRoute;

            // initialLayout is a string. If defined, the layout is set later in the constructor
            // It may be specified in the class or overridden when instantiated
            this._initialLayout = options.initialLayout || this.initialLayout;

            // Intially empty arrays which hold a list of the currently active activities
            this._currentActivities = [];

            // routes is an array of objects which contain the route RegEx as well as the
            // corresponding activity and handler
            this._routes = [];

            if (this.activityRoutes) {
                _.each(this.activities, function(activity, activityName) {
                    // give the activity a reference to the router
                    activity.router = this;
                }, this);
            }

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

            // manually call the superclass constructor
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
                nativeRoute.apply(this, arguments);
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
            nativeRoute.call(this, route, handlerString, function() {
                router._handleRoute(activities, args || Array.prototype.slice.apply(arguments));
            });
        },

        // Processes an Activity::SubActivity string into an array of activities,
        // and configures those activities as necessary
        _processActivityRoute: function (handlerString) {
            var i,
                handlerParts = handlerString.split('::'),
                activities = [],
                activity,
                activityName,
                subactivities = this.activities;

            activity = this.activities;
            for (i = 0; i < handlerParts.length; i++) {
                activityName = handlerParts[i];
                activity = subactivities && subactivities[ activityName ];

                if (activity) {

                    // If activity is a non-instantiated class, instantiate it.
                    if (!(activity instanceof Backbone.Activity)) activity = new activity();

                    activity.router = this;
                    activity.parent = activities[activities.length - 1] || undefined;
                    activity.name = activityName.toLowerCase();
                    activities.push(activity);

                    subactivities = activity && activity.handlers;
                }
                else {
                    break;
                }
            }

            // If no activities were found for a given route, throw an error
            if (activities.length < 1) {
                throw new Error("Activity '" + activityName + "' not found (note: activity names are case sensitive)");
            }
            // If some activities were found, but not all of the specfied ones, then warn but continue
            else if (activities.length < handlerParts.length) {
                window.console.warn("Sub-activity '" + activityName + "' not found, resolving to " + _.pluck(activities, "name").join("::"));
            }

            return activities;
        },

        // Takes either a url fragment (e.g. #!/people/john)
        // or an activities route string (e.g. people::detail)
        // and returns the activity hierarchy associated with that route.
        _getFragmentRoute: function(fragment) {
            var parts, result, i, activities = [], subactivities = this.activities;

            // Case for activities route string
            if ((parts = fragment.split('::')).length > 0) {

                _.each(parts, function (name) {
                    if (subactivities) {
                        activities.push(subactivities[name]);
                        subactivities = subactivities[name] && subactivities[name].handlers;
                    }
                });

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
            if (!Backbone.History.started) return window.console.warn("Not routing: Backbone history not started.");

            // Check for redirect function in activity hierarchy, redirect if true
            for (i = 0; i < activities.length; i++) {
                activity = activities[i];
                redirect = activity.redirect && activity.redirect.apply(activity, args);
                if (redirect) return this._redirectRoute(redirect);
            }

            // Update stored fragments if there is no redirect
            this._previousFragment = this.internalFragment;
            this._internalFragment = Backbone.history.fragment;

            // Otherwise continue the activity lifecycle
            window.console.log("Routing to " + _.pluck(activities, "name").join("::"));
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
                _.find(router._currentActivities, function (name, i) {
                    if (!activities[i].name || name !== activities[i].name) {
                        index = i;
                        return true;
                    }
                });

                // If all activities are the same, but arguments have changed, reinit the deepest activity
                if (index === router._currentActivities.length && _.difference(args, router._currentArgs).length > 0) {
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
                return asyncEach(oldActivities, router._stopActivity);
            },

            // Store current activities and arguments    
            saveActivities = function () {
                router._currentActivities = activities;
                router._currentArgs = args;
            },

            // Call start methods on new activities (deepest last)
            startNewActivities = function () {
                asyncEach(newActivities, router._startActivity);
            };

            return $.when( getChangedActivities() )
                .then(stopOldActivities)
                .then(saveActivities)
                .then(startNewActivities);

        },

        _startActivity: function (activity) {
            var router = activity.router,

            processTaskQueue = function() {
                return activity.processTaskQueue.apply(activity, router._currentArgs);
            },

            addActivityClassToDOM = function () {
                // Add class
                router._$el.addClass("activity-" + activity.name);
            },

            // Activities and handlers need not be associated with a fragment, and therefore may not
            // have been hooked up when we initialized. Make sure that they are hooked up!
            // TODO
            setupActivity = function () {
                /*if (!activity.router) {
                    activity.router = this;
                }
                if (!handler.router) {
                    this._hookHandler(handler, activity);
                }*/
            },

            // Call onCreate if this is the first time the activity has been called
            initializeActivity = function() {
                if (!activity._initialized) {
                    activity._initialized = true;
                    return activity.onCreate.apply(activity, router._currentArgs);
                }
            },

            // Call activity onStart method
            startActivity = function () {
                return activity.onStart.apply(activity, router._currentArgs);
            },

            // Call activity layout method with currentLayout
            setActivityLayout = function () {
                if (router.currentLayout &&
                    activity.layouts &&
                    typeof activity.layouts[router.currentLayout] === 'function') {
                    activity.layouts[router.currentLayout].apply(activity, router._currentArgs);
                }
            };

            return $.when(addActivityClassToDOM)
                .then(setupActivity)

                .then(initializeActivity)
                .then(processTaskQueue)

                .then(startActivity)
                .then(processTaskQueue)

                .then(setActivityLayout)
                .then(processTaskQueue);
        },

        // Calls an Activity's onStop method and processes the task queue
        _stopActivity: function (activity, index) {
            var router = activity.router,

            processTaskQueue = function() {
                return activity.processTaskQueue.apply(activity, router._currentArgs);
            },

            stopActivity = function () {
                return activity.onStop.apply(activity, router._currentArgs);
            },

            removeClassFromDOM = function() {
                router._$el.removeClass("activity-" + activity.name);
            };

            return $.when(stopActivity)
                .then(processTaskQueue)
                .then(removeClassFromDOM);
        },

        // Invokes an activity hierarchy without changing the URL fragment
        silentRoute: function (fragment) {
            var route = this._getFragmentRoute(fragment);
            return route && this._handleRoute(route.activities, route.args);
        },

        // Re-invokes the current activity hierarchy
        reload: function() {
            return this.silentRoute(Backbone.history.fragment);
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
        // Keys with special meaning *(routes, handlers, redirect, layouts)*
        // are attached directly to the activity.
        _configure: function(options) {
            _.extend(this, _.pick(options, "routes", "handlers", "redirect", "layouts"));
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

        start: function () {
            return Backbone.ActivityRouter.prototype._startActivity(this);
        },

        stop: function () {
            return Backbone.ActivityRouter.prototype._stopActivity(this);
        },

        // layouts is an object of layout names to layout functions
        layouts: {},

        // tasks is an object of task names to task functions
        tasks: {},

        // the queueTasks function uses this to store queued tasks 
        _taskQueue: [],

        queueTasks: function (/* taskNames */) {
            this._taskQueue.push.apply(this._taskQueue, arguments);
        },

        queueTasksOnce: function (/* taskNames */) {
            _.each(arguments, function (taskName) {
                if (_.indexOf(this._taskQueue, taskName) === -1) {
                    this._taskQueue.push(taskName);
                }
            }, this);
        },

        processTaskQueue: function () {
            return asyncEach(this._taskQueue, this.runTask, this)
                .always(function() {
                    this._taskQueue = [];
                });
        },

        runTasks: function (/* taskNames */) {
            return asyncEach(arguments, this.runTask, this);
        },

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
            window.console.error("The updateRegions function has been removed from backbone.activities. Please use built in LayoutManager function instead.");
        }
    });

    // The module returns Backbone.
    return Backbone;
}(this));