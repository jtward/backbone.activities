(function(root) {
  "use strict";

  var Backbone = root.Backbone;
  var _ = root._ || root.underscore || root.lodash;
  var $ = Backbone.$ || root.$ || root.jQuery || root.Zepto || root.ender;
  var when = Backbone.Layout.prototype.options.when;

  var VERSION = '0.6.0';

  Backbone.ActivityRouter = Backbone.Router.extend({

    constructor: function(options) {
      options = options || {};

      // an ActivityRouter's el is the point at which the layout class is added.
      // this lets you hook CSS onto specific layouts
      this._$el = $(options.el);

      // regions is an object of region names to Layouts.
      // e.g. { 'main': new Backbone.Layout({ el: '#main' }), ... }
      this.regions = options.regions;

      // defaultRoute is a url fragment. It may be specified in the class or overridden
      // when instantiated
      this._defaultRoute = options.defaultRoute || this.defaultRoute;

      // initialLayout is a string. If defined, the layout is set later in the constructor
      // It may be specified in the class or overridden when instantiated
      this._initialLayout = options.initialLayout || this.initialLayout;

      // authenticate is the function that checks whether the user is authenticated
      this.authenticate = options.authenticate || this.authenticate;

      // authenticateRedirect is the route that is fired if authentication fails
      this.authenticateRedirect = options.authenticateRedirect || this.authenticateRedirect;

      // routes is an array of objects which contain the route RegEx as well as the
      // corresponding activity and handler
      this._routes = [];

      // create a route for each entry in each activity's routes object
      _.each(this.activities, function(activity, activityName) {

        // give the activity a reference to the router
        activity.router = this;
        activity.handlers = activity.handlers || {};
        _.each(activity.routes, function(handlerName, route) {
          var handler;

          // the handler may be attached directly to the routes object
          // if so, put it in handlers and use route as its name
          if (handlerName instanceof Backbone.ActivityRouteHandler) {
            activity.handlers[route] = handlerName;
            handlerName = route;
          }

          handler = activity.handlers[handlerName];
          handler.router = this;
          handler.regions = this.regions;
          handler.activity = activity;

          // add this route to the internal array
          this._routes.push({
            route: this._routeToRegExp(route),
            activityName: activityName,
            handlerName: handlerName
          });

          // use the activity name plus the route handler name for uniqueness
          this.route(route, activityName + '-' + handlerName, _.bind(function() {

            this._handleRoute(activityName,
              handlerName,
              Array.prototype.slice.apply(arguments));

          }, this));
        }, this);
      }, this);

      // set up the default route
      if (_.isString(this._defaultRoute)) {

        // the default route may contain arguments
        this._defaultRoute = this._getFragmentRoute(this._defaultRoute);

        this._routes.push({
          route: this._routeToRegExp(''),
          activityName: this._defaultRoute.activityName,
          handlerName: this._defaultRoute.handlerName,
          args: this._defaultRoute.args
        });

        this.route('',
          this._defaultRoute.activityName + '-' + this._defaultRoute.handlerName,
          _.bind(function() {

            this._handleRoute(this._defaultRoute.activityName,
              this._defaultRoute.handlerName,
              this._defaultRoute.args);

          }, this));
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

    // setLayout sets the app layout. This triggers the corresponding layout in the current
    // activity's current route handler
    setLayout: function(name) {
      var activity = this.activities[this._currentActivityName];
      var handler;

      // update the layout class on the parent element
      if (this._$el) {
        this._$el.removeClass('layout-' + this.currentLayout)
          .addClass('layout-' + name);
      }

      this.currentLayout = name;

      if (activity) {
        handler = activity.handlers[this._currentHandlerName];

        if (handler && handler.layouts && handler.layouts[this.currentLayout]) {
          handler.layouts[this.currentLayout].apply(handler, this._currentArgs);

        }
      }
    },

    // Handle the activity lifecycle
    _didRoute: function(activityName, handlerName, args) {

      var didChangeActivity = this._currentActivityName !== activityName;
      var activity = this.activities[this._currentActivityName];
      var handler = activity && activity.handlers[this._currentHandlerName];

      // first, stop the old route
      if (handler) {
        handler.onStop();
      }

      if (activity && didChangeActivity) {
        activity.onStop();
      }

      // old route is stopped, change the current route

      this._$el.removeClass('activity-' + this._currentActivityName)
          .removeClass('activityhandler-' + this._currentActivityName + '-' + this._currentHandlerName);

      this._currentActivityName = activityName;
      this._currentHandlerName = handlerName;
      this._currentArgs = args;
      activity = this.activities[activityName];
      handler = activity.handlers[handlerName];

      this._$el.addClass('activity-' + this._currentActivityName)
          .addClass('activityhandler-' + this._currentActivityName + '-' + this._currentHandlerName);

      // start the new route
      if (!activity._initialized) {
        activity.onCreate();
        activity._initialized = true;
      }

      if (didChangeActivity) {
        activity.onStart();
      }

      if (!handler._initialized) {
        handler.onCreate();
        handler._initialized = true;
      }

      handler.onStart.apply(handler, this._currentArgs);

      if (this.currentLayout &&
        handler.layouts &&
        typeof handler.layouts[this.currentLayout] === 'function') {
        handler.layouts[this.currentLayout].apply(handler, this._currentArgs);
      }
    },

    // When called once authenticated, calls didRoute using the current URL fragment
    resolveAuthentication: function() {
      var fragment = Backbone.history.fragment;
      var routeObj = this._getFragmentRoute(fragment);
      var redirect = this._authenticateRoute(routeObj.activityName, routeObj.handlerName, routeObj.args);

      // if authentication passed then a redirect will not be returned
      if (!redirect) {
        // call didRoute to show the protected page
        this._didRoute.call(this, routeObj.activityName, routeObj.handlerName, routeObj.args);
      }
    },

    _handleRoute: function(activityName, handlerName, args) {
      var redirect = this._authenticateRoute(activityName, handlerName, args);

      // allow the redirect to provided via a function call
      if (_.isFunction(redirect)) {
        redirect = redirect();
      }

      // if the redirect is a URL fragment, extract the activity info
      if (_.isString(redirect)) {
        redirect = this._getFragmentRoute(redirect);
      }

      // delegate to didRoute to implement the activity lifecycle
      if (redirect) {
        this._didRoute(redirect.activityName, redirect.handlerName, redirect.args);
      }
      else {
        this._didRoute(activityName, handlerName, args);
      }
    },

    _authenticateRoute: function(activityName, handlerName, args) {
      var activity = this.activities[activityName];
      var handler = activity.handlers[handlerName];
      var authenticatorContext;
      var redirect;
      var redirectContext;

      // if the activity is protected and there is an authenticator, check the authentication.
      // If the authentication fails then return the redirect
      var handlerAuth = handler.authenticate;
      var activityAuth = activity.authenticate;
      var routerAuth = this.authenticate;

      // authenticator precedence: handler > activity > router
      var authenticator = handlerAuth || activityAuth || routerAuth;

      // use authentication if protected and there is an authenticator
      if (authenticator && (handler.isProtected || activity.isProtected)) {

        authenticatorContext = handlerAuth ? handler : (activityAuth ? activity : this);

        // authentication fails if a falsy value is returned
        if (!authenticator.call(authenticatorContext, activityName, handlerName, args)) {

          var handlerRedirect = handler.authenticateRedirect;
          var activityRedirect = activity.authenticateRedirect;
          var routerRedirect = this.authenticateRedirect;

          redirect = handlerRedirect || activityRedirect || routerRedirect;

          if (_.isFunction(redirect)) {
            // redirect context for a handler or activity is the activity
            redirectContext = handlerRedirect ? handler : (activityRedirect ? activity : this);
            redirect = redirect.call(redirectContext, activityName, handlerName, args);
          }

          return redirect;
        }
      }
      return false;
    },

    // return the data for a fragment
    _getFragmentRoute: function(fragment) {
      var result = _.clone(_.find(this._routes, function(routeObj) {
        return routeObj.route.test(fragment);
      }, this));
      var args = this._extractParameters(result.route, fragment);
      if (args) {
        result.args = args;
      }
      return result;
    },

    // updateRegions takes an object of regions by name
    // For each region given, the corresponding views are inserted. See updateRegion
    // below for details.
    updateRegions: function(regions) {

      var promises = [];
      _.each(regions, function(views, regionName) {
        promises.push(this.updateRegion(regionName, views));
      }, this);

      return when.apply(null, promises);

    },

    // updateRegion takes a region and either a view or an object with a template
    //  and a views object.
    // The views are inserted into the region, replacing any existing views.
    //
    // Example: passing a single view:
    //   updateRegion('main', view);
    //
    // Example: passing an array of views (note that if the views' templates are not
    //  cached and differ then LayoutManager does not guarantee that the views will be
    //  inserted into the document in order):
    //   updateRegion('main', [ myViewUsingTamplateFoo, myOtherViewUsingTemplateFoo ])
    //
    // Example: passing an object of views:
    //   updateRegion('main', {
    //     template: 'mytemplate',
    //     views: {
    //       '.myclass': myView
    //     }
    //   })
    //
    updateRegion: function(region, views) {
      var that = this;

      // retrieve the actual region by its name
      // if updateRegion was called recursively, we already have the actual region
      if (typeof region === "string") {
        region = this.regions[region];
      }

      if (region._isRendering) {
        // keep a copy of the views so that we can update with them once the current views finish rendering
        region._nextViews = views;
        // don't do anything until the previous render is complete
        return;
      }

      // beware: hacks; we need to remove the views that were present previously
      // also set hasRendered to false so that LM doesn't ditch the new views when render is called
      region._removeViews(true);
      region.__manager__.hasRendered = false;

      // reset the template for the region for the first two cases
      // (given a view; given an array of views)
      region.template = undefined;

      // Clear any remaining HTML in the region
      // This might have been left over from a previous template
      region.$el.empty();

      // if we have a single view, insert it directly into the region
      if (views instanceof Backbone.View) {
        region.insertView('', views);
      }

      // if we have an array of views, insert them
      // beware: if the templates for the views are different then LM may not render them in order!
      else if (_.isArray(views)) {
        region.setViews({
          '': views
        });
      }

      // set the template of the region and then insert the views into their places
      else if (_.isObject(views)) {
        region.template = views.template;
        region.setViews(views.views);
      }
      
      // set the _isRendering flag to true so that if new views come in they know to wait
      region._isRendering = true;

      // listen for afterRender so that we can update with any new views that could be waiting
      region.on('afterRender', function listener() {
        // rendering finished
        var nextViews = region._nextViews;

        // clean up
        region.off('afterRender', listener);
        region._isRendering = false;

        // check for next views
        if (nextViews) {
          // there are views waiting; update!
          region._nextViews = undefined;
          that.updateRegion(region, nextViews);
        }
      });

      // render the region and all of its views
      return region.render();
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
    // Keys with special meaning *(routes)* are attached directly to the activity.
    _configure: function(options) {
      if (options.routes) {
        this.routes = options.routes;
      }
      if (options.handlers) {
        this.handlers = options.handlers;
      }
      if (options.authenticate) {
        this.authenticate = options.authenticate;
      }
      if (options.authenticateRedirect) {
        this.authenticateRedirect = options.authenticateRedirect;
      }
      if (options.isProtected !== null && options.isProtected !== undefined) {
        this.isProtected = options.isProtected;
      }
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

    VERSION: VERSION

  });

  // use backbone's extend (referencing via View here, but they're all the same)
  Backbone.Activity.extend = Backbone.View.extend;

  // Activity constructor
  Backbone.ActivityRouteHandler = function(options) {
      this._configure(options || {});
      this.initialize.apply(this, arguments);
    };

  // mix events into the prototype
  _.extend(Backbone.ActivityRouteHandler.prototype, Backbone.Events, {

    // regions is a map from region names to region objects.
    // Setup is handled by the ActivityRouter constructor.
    // This object will be the same for all handlers associated with the same router.
    regions: {},

    // layouts is an object of layout names to layout functions
    layouts: {},

    // Performs the initial configuration of an ActivityRouteHandler with a set of options.
    // Keys with special meaning *(layouts)* are attached directly to the activity.
    _configure: function(options) {
      if (options.layouts) {
        this.layouts = options.layouts;
      }
      if (options.authenticate) {
        this.authenticate = options.authenticate;
      }
      if (options.authenticateRedirect) {
        this.authenticateRedirect = options.authenticateRedirect;
      }
      if (options.isProtected !== null && options.isProtected !== undefined) {
        this.isProtected = options.isProtected;
      }
    },

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function() {},

    // The router uses this value to determine whether to call an activity's onCreate
    // callback
    _initialized: false,

    updateRegions: function(regions) {
      return this.router.updateRegions(regions);
    },

    updateRegion: function(region, views) {
      return this.router.updateRegion(region, views);
    },

    // callback stubs
    onCreate: function() {},
    onStart: function() {},
    onStop: function() {},

    VERSION: VERSION

  });

  // use backbone's extend (referencing via View here, but they're all the same)
  Backbone.ActivityRouteHandler.extend = Backbone.View.extend;

  // The module returns Backbone.
  return Backbone;
}(this));