backbone.activities
===================

Backbone Activities is a [Backbone](https://github.com/documentcloud/backbone) plugin which provides high-level sctructure for web apps. It borrows ideas, and its name, from Android's Activities, so some concepts may be familiar to Android developers.

Two additional Backbone entities are provided: `Backbone.Activity` and `Backbone.ActivityRouter`, which extends `Backbone.Router`.

The dependencies are [Backbone](https://github.com/documentcloud/backbone) and underscore or lodash.

Latest version: 0.8.1


### Activities
An activity is a screen-level controller. You should create an activity for every distinct screen in your app, which means there will generally be a one-to-one relationship between your app's routes and these activities (unless, for example, the same screen is shown on more than one route). These activities have the responsibility of inserting views into the page and handling any data that might be used by multiple views on that screen or might need to be persisted ready for the next time the screen is shown.

For example, suppose you have a list and detail page - each of these pages would have an activity whose responsibility it is to present the relevant views on the page.

When you have screens that are related by the data that they use, as in the list / detail example, you could add a third activity as a parent of the list and detail activities to handle that data. The parent activity does not need to worry about inserting views into the page - that responsibility is delegated to the sub-activities, but it may need to handle some of the data used by its sub-activities.

Adding the parent activity also makes the relationship between the list and detail views more explicit - because they are both sub-activities of the same parent activity, we know that they relate to the same data. It may be useful to create the parent activity even if there is no data shared between the sub-activities, to make the relationship between the activities explicit.

In a responsive app, you may have multiple pages for devices with smaller form factors that become a single page on a device with a larger form factor. For example, you might have separate list and detail pages for small devices but a single list/detail page for larger ones. In this situation, you could have list and detail routes and activities, and a parent activity which handles the shared data. The router can notify the sub-activities when the screen layout changes, to which they can respond by re-rendering views. See the section on "responsive apps" for more details on how this works.

### The activity lifecycle
```
##################################################
# Activity                                       #
#      #################################         #
#      # onCreate()                    #         #
#      #  if this is the first time    #         #
#      #  time the activity is used    #         #
#      #################################         #
#                     v                          #
#      #################################         #
#      # onStart(route_params)         #<-----------|
#      #  if the last route was        #         #  |
#      #  handled by another activity  #         #  |
#      #################################         #  |
#                     v                          #  |
#      #################################         #  |
#      # layouts[layout](route_params) #<-|      #  |
#      #  if the route or layout       #  |      #  |
#      #  changed                      #--|      #  |
#      #################################         #  |
#                     |                          #  |
#  ##########################################    #  |
#  # subactivity      v                     #    #  |
#  #   #################################    #    #  |
#  #   # onCreate()                    #    #    #  |
#  #   #  if the route changed         #    #    #  |
#  #   #################################    #    #  |
#  #                  v                     #    #  |
#  #   #################################    #    #  |
#  #   # onStart(route_params)         #<------| #  |
#  #   #  if the route changed         #    #  | #  |
#  #   #################################    #  | #  |
#  #                  v                     #  | #  |
#  #   #################################    #  | #  |
#  #   # layouts[layout](route_params) #<-| #  | #  |
#  #   #  if the route or layout       #  | #  | #  |
#  #   #  changed                      #--| #  | #  |
#  #   #################################    #  | #  |
#  #                  v                     #  | #  |
#  #   #################################    #  | #  |
#  #   # onStop()                      #    #  | #  |
#  #   #  if the route changed         #-------| #  |
#  #   #################################   #     #  |
#  #                  |                    #     #  |
#  #########################################     #  |
#                     v                          #  |
#      #################################         #  |
#      # onStop()                      #         #  |
#      #  if the next route is         #         #  |
#      #  handled by another activity  #------------|
#      #################################        #
#                                               #
#################################################

```

### Hooking up routes to activities
Activity routers are an extension of `Backbone.Router` with some additional setup logic (to hook up routes to activities and handlers), and routing logic (implementing activity lifecycles).

The activity router's `routes` object is similar to a standard Backbone router's, where the keys correspond to the URL fragments that the route matches. However, where a standard Backbone router's route values are functions or function names, an activity router's are activity path strings.

An activity path string is a path down an activity hierarchy, separated by double colons, `::`. The activities are written with the top-level activity first and the lowest-level activity last. There's no limit on the depth of the activity hierarchy.

When a route is matched, the router splits the activity hierarchy string to get the list of names of activities. To get the actual activities from these names, the router first looks at its own `activities` object to find the top-level activity by the first name in the list. While there are more names in the list, the router looks for the next activity in the `activities` object of the last activity it found.

When defining an `activities` object on the router or an activity, you can provide just the class of the sub-activity and the router will automatically instantiate it for you.

```JavaScript
var PeopleListActivity = Backbone.Activity.extend({
  onStart: function() {
    console.log("world");
  },
  layouts: {
    'single': function() {
      // display the single-pane layout
    }
  }
});

var PeopleActivity = Backbone.Activity.extend({
  activities: {
    "list": PeopleListActivity
  },
  onStart: function() {
    console.log("hello ");
  }
});

var MyRouter = Backbone.ActivityRouter.extend({
  activities: {
    "people": PeopleActivity
  },
  routes: {
    // "people" references MyRouter.activities.people
    // "list" references MyRouter.activities.people.activities.list
    "!/people": "people::list"
  }
});
```

### Responsive apps
The activity router's `setLayout` method provides a simple way of handling changes to your app's layout. `setLayout` takes a single string as its argument which refers to a unique name for the layout. You could hook up to a `matchMedia` listener to call `setLayout` in order to trigger the layout to change when the app resizes. If the `initialLayout` option is supplied, the router will automatically set the layout to the provided string when it is constructed.

When an activity is started, the router will call the `layouts` function which corresponds router's current layout. This method is called immediately after `onStart`.
Additionally, the router will also call the corresponding `layouts` function on all activities in the current hierarchy whenever the layout is changed via the `setLayout` method.

### Redirection
The activity router includes a simple method for redirecting between routes. The router and activities may define a `redirect` method, which the router calls on before it routes. If a redirect method returns a route, the router will redirect to the returned route. The returned route may be in the form of a fragment (e.g. `"!/people/john"`), or activity hierarchy string (e.g. `"people::list"`). By default, the hash does not change when redirecting. To change the hash, return an object from the redirect function which contains the new fragment and set the `trigger` property to `true`; e.g. `{ "fragment": "!/people/john", "trigger": true }`.

### Manual Routing
If you need to programmatically trigger routes, you should use the `Backbone.history.navigate` method with the `trigger` option set to `true`.

## Change Log
### 0.8.1
- Removed the option to pass an array of redirect functions
- Added the option to change the hash from a redirect

### 0.8.0
- `ActivityRouteHandler` was removed; it's now activities all the way down. Activity hierarchies are now arbitrarily deep.
- Removed dependency on `Backbone.LayoutManager` as well as `updateRegion` and `updateRegions`, and all references regions. View / region management is no longer a feature of `backbone.activities`.
- `Activity.handlers` was renamed `Activity.activities` to reflect the fact that it now holds sub-activities.
- `ActivityRouter`s are no longer associated with a DOM node, and CSS classes are no longer added to reflect the current activities or layout.
- `isProtected`, `authenticate`, `authenticateRedirect` and `resolveAuthentication` have been replaced by the simpler `Activity.redirect`.
- Removed `ActivityRouter.defaultRoute`.
- `ActivityRouter.silentRoute` and `ActivityRouter.reload` methods were added.
- Added AMD support.

### 0.7.1
- Allow routers' el and regions to be provided via prototype and default el to document.body

### 0.7.0
- Support for supplying activityRoutes to the router via activity::handler strings.

### 0.6.2
- Add a more useful error message when a handler is not found.

### 0.6.1
- Fixed a bug in updateRegions; it now returns the correct promise and does not throw an error on iOS 5.

### 0.6.0
- Added `updateRegions` and `updateRegion` to the `ActivityRouter` prototype. The corresponding methods on `ActivityRouteHandler` now defer to the router.
- `updateRegions` and `updateRegion` now return a promise which is resolved when the region(s) have been rendered.

### 0.5.3
- Fixed a bug where calling `ActivityRouteHandler.updateRegion` for a second time for a region before the previous views had been rendered would cause both sets of views to be shown.

### 0.5.2
- Support for supplying `authenticate` and `authenticateRedirect` via options to ActivityRouters, Activities and ActivityHandlers was added.
- Support for supplying `isProtected` via options to Activities and ActivityHandlers was added.

### 0.5.1
- Support for supplying handlers directly to an activity's `routes` object was added. When the router is initialized, a reference to the handler is added to the activity's handlers object using the route as the key.

### 0.5.0
- The ActivityRouteHandler class was added. Handlers may no longer be defined inline on an activity.
- Activity.handlers was added to namespace handlers within activities. The handlers are keyed by name, which are referenced by the activity's routes
- updateRegions and updateRegion were moved from Activity to ActivityRouteHandler
- Activity.regions was removed; regions are now accessible via ActivityRouteHandlers
- Support for supplying ActivityRouter.defaultRoute by activity and handler name was removed; you must now specify a URL fragment
- ActivityRouter.defaultRoute may now be provided as an option when instantiating ActivityRouter
- ActivityRouter.initialLayout may now be provided as an instance property when extending ActivityRouter
- Several ActivityRouter properties have become pseudo-private and gained a preceding underscore. They are didRoute, $el, routes, currentActivityName, currentHandlerName and currentArgs
- ActivityRouter.navigate was removed

### 0.4.0
- Built-in support for protected handlers and activities and authentication was added
- Support for URL fragments was added; they can now be used for the default route and for authentication redirects
