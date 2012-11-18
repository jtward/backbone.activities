backbone.activities
===================

Backbone Activities is a [Backbone](https://github.com/documentcloud/backbone) plugin which makes it easier to create and organize responsive web apps. It borrows ideas, and its name, from Android's Activities, so some concepts may be familiar to Android developers.

Two additional Backbone entities are provided: `Backbone.Activity` and `Backbone.ActivityRouter`, which extends `Backbone.Router`. Activities define routes, and these routes may implement callbacks to be called by the router when the corresponding layout is fired. Activity lifecycles are also handled by the router.

Dependencies are [Backbone](https://github.com/documentcloud/backbone) and [Backbone.layoutmanager](https://github.com/tbranyen/backbone.layoutmanager).
