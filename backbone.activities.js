/*jshint newcap:false */
(function(root) {
    "use strict";

    var Backbone = root.Backbone;
    var _ = root._ || root.underscore || root.lodash;
    var $ = Backbone.$ || root.$ || root.jQuery || root.Zepto || root.ender;
    var when = function (promises) {
        return $.when.apply(null, promises);
    };
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

            // activityRoutes is an optional map from url fragments to activity::handler strings
            this.activityRoutes = options.activityRoutes || this.activityRoutes;

            // defaultRoute is a url fragment. It may be specified in the class or overridden
            // when instantiated
            this._defaultRoute = options.defaultRoute || this.defaultRoute;

            // initialLayout is a string. If defined, the layout is set later in the constructor
            // It may be specified in the class or overridden when instantiated
            this._initialLayout = options.initialLayout || this.initialLayout;

            // Intially empty arrays which hold a list of the currently active activities
            this._currentActivities = [];
            this._currentActivityNames = [];

            // routes is an array of objects which contain the route RegEx as well as the
            // corresponding activity and handler
            this._routes = [];

            if (this.activityRoutes) {

                _.each(this.activities, function(activity, activityName) {
                    // give the activity a reference to the router
                    activity.router = this;
                }, this);

                _.each(this.activityRoutes, function(handlerString, route) {
                    var handlerParts = handlerString.split('::'),
                        activities = [], activityNames = [],
                        activity, activityName,
                        subactivities = this.activities;

                    activity = this.activities;
                    for (var i = 0; i < handlerParts.length; i++) {
                        activityName = handlerParts[i];
                        activity = subactivities && subactivities[ activityName ];

                        // If activity is a non-instantiated class, instantiate it.
                        if (activity && !(activity instanceof Backbone.Activity) && activity.prototype) activity = new activity();

                        subactivities = activity && activity.handlers;
                        if (activity) {
                            activity.router = this;
                            activity.parent = activities[activities.length - 1] || undefined;
                            activityNames.push(activityName.toLowerCase());
                            activities.push(activity);
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
                        console.warn("Sub-activity '" + activityName + "' not found, resolving to " + activityNames.join("::"));
                    }

                    this._addRoute(activityNames, activities, route);
                }, this);
            }

            // set up the default route
            if (_.isString(this._defaultRoute)) {

                // the default route may contain arguments
                this._defaultRoute = this._getFragmentRoute(this._defaultRoute);
                this._addRoute(this._defaultRoute.activityNames, '', this._defaultRoute.args);
            }

            // initialize initial layout.
            // if the router is responsive, setLayout should be called whenever the desired
            // layout changes.
            if (this._initialLayout) {
                this.setLayout(this._initialLayout);
            }

            // manually call the superclass constructor
            Backbone.Router.prototype.constructor.call(this, options);
        },

        // hook up a route to an activity hierarchy
        _addRoute: function(activityNames, activities, route, args) {
            // add this route to the internal array
            this._routes.push({
                route: this._routeToRegExp(route),
                activityNames: activityNames,
                activities: activities,
                args: args
            });

            // use the activity name plus the route handler name for uniqueness
            this.route(route, activityNames.join("::"), _.bind(function() {
                this._handleRoute(activityNames,
                    activities,
                    args || Array.prototype.slice.apply(arguments));

            }, this));
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
                    activityNames: parts,
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
        _handleRoute: function(activityNames, activities, args) {
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
            window.console.log("Routing to " + activityNames.join("::"));
            return this._handleLifecycle(activityNames, activities, args);
        },

        _redirectRoute: function(redirect) {
            var parts;
            if (redirect.trigger) {
                // if trigger is true we know that the fragment is not an Activity::handler string
                this.navigate(redirect.fragment, redirect);
            }
            else {
                redirect = this._getFragmentRoute(redirect);
                return this._handleRoute(redirect.activityNames, redirect.activities, redirect.args);
            }
        },

        // Handle the activity lifecycle
        _handleLifecycle: function(activityNames, activities, args) {
            var router = this;

            // Find the index of the first activity that is different to the already loaded activities
            var index = this._currentActivityNames.length;
            _.find(this._currentActivityNames, function (name, i) {
                if (!activityNames[i] || name !== activityNames[i]) {
                    index = i;
                    return true;
                }
            });

            // If all activities are the same, but arguments have changed, reinit the deepest activity
            if (index === this._currentActivityNames.length && _.difference(args, this._currentArgs).length > 0) {
                index -= 1;
            }

            // Old actvities are activity in currentActivities past index
            // Reverse order so that deepest is deinitialized first
            var oldActivityNames = this._currentActivityNames.slice(index).reverse();
            var oldActivities = this._currentActivities.slice(index).reverse();

            // new activities are activities in 'activities' past index
            var newActivityNames = activityNames.slice(index);
            var newActivities = activities.slice(index);

            var stopOldActivities = function () {
                // Call stop methods and remove classes of old activities, deepest first
                return asyncEach(oldActivities, function (activity, index) {

                    var processTaskQueue = function() {
                        return activity.processTaskQueue.apply(activity, router._currentArgs);
                    },

                    stopActivity = function () {
                        return activity.onStop.apply(activity, router._currentArgs);
                    },

                    removeClassFromDOM = function() {
                        router._$el.removeClass("activity-" + oldActivityNames[index]);
                    };

                    return $.when(stopActivity)
                        .then(processTaskQueue)
                        .then(removeClassFromDOM);

                }, router);
            };

            var saveActivityNames = function () {
                router._currentActivityNames = activityNames;
                router._currentActivities = activities;
                router._currentArgs = args;
            };

            var startNewActivities = function () {
                // Call start methods on new activities (deepest last)
                asyncEach(newActivities, function (activity, index) {

                    var processTaskQueue = function() {
                        return activity.processTaskQueue.apply(activity, router._currentArgs);
                    },

                    addActivityClassToDOM = function () {
                        // Add class
                        router._$el.addClass("activity-" + name);
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

                }, router);
            };

            return stopOldActivities()
                .then(saveActivityNames)
                .then(startNewActivities);

        },

        // Invokes an activity hierarchy without changing the URL fragment
        silentRoute: function (fragment) {
            var route = this._getFragmentRoute(fragment);
            return this._handleRoute(route.activityNames, route.activities, route.args);
        },

        // Re-invokes the current activity hierarchy
        reload: function() {

            var route = this._getFragmentRoute(Backbone.history.fragment);
            if(route) {
                return this._handleRoute(route.activityName, route.handlerName, route.args);
            }
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
            window.console.error("The updateRegions function has been removed from backbone.activities. Please see Backbone.transitionmanager for a replacement");
        }
    });

    // The module returns Backbone.
    return Backbone;
}(this));