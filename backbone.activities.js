(function(root) {
  "use strict";

  var Backbone = root.Backbone;
  var _ = root._ || root.underscore || root.lodash;
  var $ = Backbone.$ || root.$ || root.jQuery || root.Zepto || root.ender;

  var VERSION = '0.3.0';

  Backbone.ActivityRouter = Backbone.Router.extend({

    constructor: function(options) {
      options = options || {};

      // an ActivityRouter's el is the point at which the layout class is added.
      // this lets you hook CSS onto specific layouts
      this.$el = $(options.el);

      // regions is an object of region names to Layouts.
      // e.g. { 'main': new Backbone.Layout({ el: '#main' }), ... }
      this.regions = options.regions;

      // create a route for each entry in each activity's routes object
      _.each(this.activities, function(activity, activityName) {

        activity._router = this;

        _.each(activity.routes, function(handlerName, route) {

          // use the activity name plus the route handler name for uniqueness
          this.route(route, activityName + '-' + handlerName, _.bind(function() {

            // delegate to didRoute to implement the activity lifecycle
            this.didRoute(activityName, handlerName, Array.prototype.slice.apply(arguments));

          }, this));
        }, this);
      }, this);

      // set up the default route
      this.route('',
        this.defaultRoute.activityName + '-' + this.defaultRoute.handlerName,
        _.bind(function() {

          this.didRoute(this.defaultRoute.activityName,
            this.defaultRoute.handlerName,
            Array.prototype.slice.apply(arguments));

        }, this));

      // initialize initial layout.
      // if the router is responsive, setLayout should be called whenever the desired
      // layout changes.
      if (options.initialLayout) {
        this.setLayout(options.initialLayout);
      }

      // manually call the superclass constructor
      Backbone.Router.prototype['constructor'].call(this, options);
    },

    // setLayout sets the app layout. This triggers the corresponding layout in the current activity's
    // current route handler
    setLayout: function(name) {

      var activity = this.activities[this.currentActivityName];

      // update the layout class on the parent element
      if (this.$el) {
        this.$el.removeClass('layout-' + this.currentLayout)
          .addClass('layout-' + name);
      }

      this.currentLayout = name;

      // if the current activity's current method has a function for the new layout,
      // invoke it
      if (activity && activity[this.currentHandlerName][this.currentLayout]) {

        activity[this.currentHandlerName][this.currentLayout].apply(activity, this.currentArgs);

      }
    },

    // Handle the activity lifecycle
    didRoute: function(activityName, handlerName, args) {

      var didChangeActivity = this.currentActivityName !== activityName;
      var didChangeRoute = this.currentHandlerName !== handlerName;
      var activity = this.activities[this.currentActivityName];

      // first, stop the old route
      if (this.currentActivityName &&
        (didChangeActivity || didChangeRoute) &&
        activity[this.currentHandlerName].onStop) {

        activity[this.currentHandlerName].onStop.apply(activity);

      }

      if(activity && didChangeActivity) {
        activity.onStop();
      }

      // old route is stopped, change the current route

      this.$el.removeClass('activity-' + this.currentActivityName)
          .removeClass('activityhandler-' + this.currentActivityName + '-' + this.currentHandlerName);

      this.currentActivityName = activityName;
      this.currentHandlerName = handlerName;
      this.currentArgs = args;
      activity = this.activities[activityName];

      this.$el.addClass('activity-' + this.currentActivityName)
          .addClass('activityhandler-' + this.currentActivityName + '-' + this.currentHandlerName);

      // start the new route
      if(!activity._initialized) {
        activity.regions = this.regions;
        activity.onCreate();
        activity._initialized = true;
      }

      if(didChangeActivity) {
        activity.onStart();
      }

      if(activity[this.currentHandlerName].onStart) {

        activity[this.currentHandlerName].onStart.apply(activity, this.currentArgs);

      }

      if(activity[this.currentHandlerName][this.currentLayout]) {

        activity[this.currentHandlerName][this.currentLayout].apply(activity, this.currentArgs);

      }
    },

    VERSION: VERSION

  });

  // Activity constructor
  Backbone.Activity = function(options) {
      // both _configure and initialize are stubs
      this._configure(options || {});
      this.initialize.apply(this, arguments);
    };

  // mix events into the prototype
  _.extend(Backbone.Activity.prototype, Backbone.Events, {

    // regions is a map from region names to region objects.
    // Setup is handled by the base Scaffold.Router's constructor.
    // This object will be the same for all activities associated with the same router.
    regions: {},

    // _configure is an empty function by default. Override it with your own
    // configuration logic.
    _configure: function() {},

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function() {},

    // The router uses this value to determine whether to call an activity's onCreate
    // callback
    _initialized: false,

    // updateRegions takes an object of regions by name
    // For each region given, the corresponding views are inserted. See updateRegion
    // below for details.
    updateRegions: function(regions) {

      _.each(regions, function(views, regionName) {
        this.updateRegion(regionName, views);
      }, this);

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

      // retrieve the actual region by its name
      region = this.regions[region];

      // beware: hacks; we need to remove the views that were present previously
      // also set hasRendered to false so that LM doesn't ditch the new views when render is called
      region._removeViews(true);
      region.__manager__.hasRendered = false;

      // reset the template for the region for the first two cases (given a view; given an array of views)
      region.template = undefined;

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

      // render the region and all of its views
      region.render();
    },

    // manually navigate to a new activity/handler
    // for silent navigation, you can pass an activity name, handler name and args
    // for silent or non-silent navigation, pass a fragment and options; this is just a proxy for
    //  Backbone.history.navigate, so pass true to navigate non-silently
    navigate: function(activityName, handlerName, args) {

      // if we're navigating to a specific activity/handler, do so silently using
      // didRoute to handle the lifecycles
      if (typeof handlerName === 'string') {
        this._router.didRoute(activityName, handlerName, args || {});
      }

      // standard router navigation using a fragment
      else {
        Backbone.history.navigate(activityName, handlerName);
      }
    },

    // callback stubs
    onCreate: function() {},
    onStart: function() {},
    onStop: function() {},

    VERSION: VERSION

  });

  // use backbone's extend (referencing via View here, but they're all the same)
  Backbone.Activity.extend = Backbone.View.extend;

  // The module returns Backbone.
  return Backbone;
}(this));