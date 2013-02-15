backbone.activities
===================

Backbone Activities is a [Backbone](https://github.com/documentcloud/backbone) plugin which makes it easier to create and organize responsive web apps. It borrows ideas, and its name, from Android's Activities, so some concepts may be familiar to Android developers.

Three additional Backbone entities are provided: `Backbone.Activity`, `Backbone.ActivityRouteHandler` and `Backbone.ActivityRouter`, which extends `Backbone.Router`.

Dependencies are [Backbone](https://github.com/documentcloud/backbone) and [Backbone.layoutmanager](https://github.com/tbranyen/backbone.layoutmanager).


### Activities
In a responsive app, you may have multiple pages for devices with smaller form factors that become a single page on a device with a larger form factor. For example, you might have separate list and detail pages for small devices but a single list/detail page for larger ones. An activity should encompass the behaviour and layouts for a single page on the largest form factor that you support. In the list/detail example, the list and detail pages would be handled by a single activity.

In Backbone, each page for your smallest form factor will have its own route, and so an activity may encompass several routes. In the list/detail example, your activity's routes might be `"!/list"` and `"!/detail/:id"`. The behaviour for these different routes are defined by separate handlers.

The role of an activity is generally to handle all of the data involved across its handlers, and to delegate the rendering of a page to those handlers. The handler is responsible for rendering content appropriate for the current layout by using the `updateRegions` method.

### The activity lifecycle
```
##################################################
# Activity                                       #
#      #################################         #
#      # onCreate()                    #<===========|
#      #  if this is the first time    #         #  |
#      #  time the activity is used    #         #  |
#      #################################         #  |
#                     v                          #  |
#      #################################         #  |
#      # onStart()                     #<===========|
#      #  if the last route was        #         #  |
#      #  handled by another activity  #         #  |
#      #################################         #  |
#                     |                          #  |
#  ##########################################    #  |
#  # route handler    v                     #    #  |
#  #   #################################    #    #  |
#  #   # onCreate()                    #    #    #  |
#  #   #  if the route changed         #    #  | #  |
#  #   #################################    #  | #  |
#  #                  v                     #  | #  |
#  #   #################################    #    #  |
#  #   # onStart(route_params)         #<======| #  |
#  #   #  if the route changed         #    #  | #  |
#  #   #################################    #  | #  |
#  #                  v                     #  | #  |
#  #   #################################    #  | #  |
#  #   # layouts[layout](route_params) #<=| #  | #  |
#  #   #  if the route or layout       #  | #  | #  |
#  #   #  changed                      #==| #  | #  |
#  #   #################################    #  | #  |
#  #                  v                     #  | #  |
#  #   #################################    #  | #  |
#  #   # onStop()                      #    #  | #  |
#  #   #  if the route changed         #=======| #  |
#  #   #################################   #     #  |
#  #                  |                    #     #  |
#  #########################################     #  |
#                     v                          #  |
#      #################################         #  |
#      # onStop()                      #         #  |
#      #  if the next route is         #         #  |
#      #  handled by another activity  #============|
#      #################################        #
#                                               #
#################################################

```

### Hooking up routes to activities; route handlers
An activity's `routes` object defines the routes for which an activity is responsible, and the handlers that implement the bahaviour for those routes. For example, the following `routes` object designates responsibility for the `"!/list"` route to a new instance of `MyListHandler`:

```
routes: {
  "!/list": new MyListHandler()
}
```

Alternatively, you can specify a string which is used to look up the handler in the activity's `handlers` object, so the following code has the same effect:

```
routes: {
  "!/list": 'list'
},
handlers: {
  "list": new MyListHandler()
}
```

If you use the shorthand of attaching a handler directly to the `routes` object, then when the router is initialized, a reference to the handler is added to the activity's `handlers` object using the route as the key.

A route handler may have `onStart` and `onStop` methods, as well as methods for the application's layouts. Here's an example of an activity with a `list` route handler:


```
var MyListHandler = Backbone.ActivityRouteHandler.extend({

  layouts: {
    
    'single': function() {
      // display the single-pane layout
      
      this.updateRegions({
        "main": new MyListView()
      });
    
    }
  }

});

var myActivity = Backbone.Activity.extend({

  "handlers": {
    "list": new MyListHandler();
  },

  "routes": {
    // list references handlers.list
    "!/list": "list"
  }

});
```

### Regions, and rendering using `updateRegions`
The `updateRegions` method takes an object of views to be inserted into regions. These regions are LayoutManager layouts whose `el`s are typically present throughout the application. It's possible you'll only need a main region, but you might want one for a header, footer, navigation menu, etc. Each handler has access to the app's regions via the `regions` property, which is populated by the activity router so you don't have to worry about them in your handlers. I've not yet had reason to access `regions` directly from a handler.

There are a few ways to set the views for a given region using `updateRegions` (or `updateRegion` when updating a single region). The first, and easiest way, is to pass a view, which is inserted directly into the region. The second is to pass an object with a template name and views object. In this case, the region gets the given template rendered into it, and then views are rendered into place in the template using the selector strings. The third is to pass an array of views, but because of the way that LayoutManager works, you should only do this if all of the views in the array use the same template, or the views could render out of order.

### Activity routers and layouts
Activity routers are an extension of `Backbone.Router` with some additional setup logic (to hook up routes to activities and handlers), and routing logic (implementing activity lifecycles).

An activity router needs a few things at initialization time:
- `regions`: an object of region names to LayoutManager layouts
- `el`: a DOM element on which to set a class corresponding to the current layout. This lets you hook CSS into layouts
- `activities`: a object of activity names to activities
- `defaultRoute`: either a URL fragment or an object which defines the activity name and route handler name that should be used for the empty route

The activity router also has a very important method, `setLayout`, which should be called immediately after the router has been instantiated (unless an `initialLayout` is specified) and also whenever the app's layout changes. `setLayout` takes a single string as its argument which is mapped to the names of the layout methods of activities' route handlers. You could hook up to a `matchMedia` listener like `enquire.js` to call `setLayout` in order to trigger the layout to change when the app resizes. If the `initialLayout` option is supplied, the router will automatically set the layout to the provided string when it is constructed.

### Manual Routing
If you need to programmatically trigger routes, you should use the `Backbone.history.navigate` method with the `trigger` option set to `true`.

### Protected routes / authorization
From version 0.4, Backbone Activities supports protecting handlers or entire activities behind authentication checks. 

To protect a handler or activity, set the `isProtected` property on the handler or activity to `true`. To check the current state of authentication, the router's `authenticate` method is called. You must implement this method, and it should return a truthy value iff the user is authenticated and therefore able to access protected handlers and activities.

When authentication fails, the router looks for the `authenticateRedirect` property on the handler, activity or router. This may be a URL fragment, an object containing an activity and handler name and an optional array of arguments, or a function which returns the fragment or object. This fragment or object is used to silently invoke a route where the user can provide authentication details.

The ActivityRouter's `resolveAuthentication` method re-checks authentication and redirects the user to the protected page if they are authenticated. If authentication fails, then no action is taken.

## Change Log
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
