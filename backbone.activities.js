(function(window) {

  "use strict";

  var Backbone = window.Backbone;
  var _ = window._;
  var $ = window.$;

  var VERSION = '0.1.0';

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
      _.each(this.activities, function(activity, name) {
        _.each(activity.routes, function(methodName, route) {

          // use the activity name plus the method name for uniqueness
          this.route(route, name + '-' + methodName, _.bind(function() {

            this.didRoute(activity,
              methodName,
              Array.prototype.slice.apply(arguments));

          }, this));
        }, this);
      }, this);

      // set up the default route
      this.route('',
        this.defaultRoute.activityName + '-' + this.defaultRoute.methodName,
          _.bind(function() {

            this.didRoute(this.defaultRoute.activity,
              this.defaultRoute.methodName,
              Array.prototype.slice.apply(arguments));

          }, this));

      // initialize initial layout.
      // if the router is responsive, setLayout should be called whenever the desired
      // layout changes.
      if(options.initialLayout) {
        this.setLayout(options.initialLayout);
      }

      // manually call the superclass constructor
      Backbone.Router.prototype['constructor'].call(this, options);
    },

    setLayout: function(name) {
      // update the layout class on the parent element
      if (this.$el) {
        this.$el.removeClass('layout-' + this.currentLayout).addClass('layout-' + name);
      }

      this.currentLayout = name;
      
      // if the current activity's current method has a function for the new layout,
      // invoke it
      if (this.currentActivity &&
        this.currentActivity[this.currentMethod][this.currentLayout]) {

        this.currentActivity[this.currentMethod][this.currentLayout].apply(
          this.currentActivity, this.currentArgs);

      }
    },

    // Handle the activity lifecycle
    didRoute: function(activity, method, args) {

      var didChangeActivity = this.currentActivity !== activity;
      var didChangeMethod = this.currentMethod !== method;

      // first, stop the old route
      if (this.currentActivity &&
        (didChangeActivity || didChangeMethod) &&
        this.currentActivity[this.currentMethod].onStop) {

        this.currentActivity[this.currentMethod].onStop.apply(this.currentActivity);

      }

      if (this.currentActivity && didChangeActivity) {
        this.currentActivity.onStop();
      }

      // old route is stopped, change the current route
      this.currentActivity = activity;
      this.currentMethod = method;
      this.currentArgs = args;

      // start the new route
      if (!activity._initialized) {
        activity.regions = this.regions;
        activity.onCreate();
        activity._initialized = true;
      }

      if (didChangeActivity) {
        activity.onStart();
      }

      if (this.currentActivity[this.currentMethod].onStart) {

        this.currentActivity[this.currentMethod].onStart.apply(
          this.currentActivity, this.currentArgs);
      
      }

      if(this.currentActivity[this.currentMethod][this.currentLayout]) {
      
        this.currentActivity[this.currentMethod][this.currentLayout].apply(
          this.currentActivity, this.currentArgs);
      
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
    initialize: function(){},

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
      else {
        region.template = views.template;
        region.setViews(views.views);
      }

      // render the region and all of its views
      region.render();
    },

    // callback stubs
    onCreate: function() {},
    onStart: function() {},
    onStop: function() {},

    VERSION: VERSION

  });

  // use backbone's extend (referencing via View here, but they're all the same)
  Backbone.Activity.extend = Backbone.View.extend;

})(this);