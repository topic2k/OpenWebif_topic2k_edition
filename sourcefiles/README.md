# Javascript, Styles, Fonts and Icons...

There's a choice of OpenWebif interfaces to choose from:
- `Modern` is suitable for mobile and desktop devices (also known as _responsive_)
- `Classic` is the original look and layout
- (`Mobile` will soon be removed in favour of the Modern interface)

There are a separate set of js and css files for each.

JS and CSS files are compiled and minified as part of the [CI process](../CI/npm.sh).

This can also be done manually.

## Prerequisites

If you haven't already, you'll need to [install npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm#using-a-node-version-manager-to-install-nodejs-and-npm).

## Initial setup
If this is your first time working with assets on OpenWebif, you'll
need to download and install all required dependencies:

`cd` to the repo root, then run

`(cd ./sourcefiles/ && npm install)`

---

## Modern interface

```
MODERN:

/* source code */
/sourcefiles/modern
    /css/*.css
    /js/*.js and /js/*.mjs
    /fonts

/* output */
/plugin/public/modern
    /css/*.min.css
    /js/*.min.js or /js/*-app.js
    /fonts

/* browser url */
/modern
    /css/*.min.css
    /js/*.min.js or /js/*-app.js
    /fonts
```

jQuery and Bootstrap are currently used for some functionality, but the 
intention is to remove these dependencies completely from the Modern interface.

### Modern EPG

The magazine and timeline share `modern/js/responsive-multiepg.js` (initialization,
navigation, calendar, layout and lifecycle) and `modern/js/epgtime.js` (timestamps,
two-hour slots, timeline coordinates and local calendar dates). Styles live in
`modern/css/multiepg.css`, scoped to `.modern-epg`; timeline-only rules use
`.modern-epg--timeline` so they cannot affect the magazine or other pages.

The responsive `multiepg.tmpl` renders markup and an HTML-escaped JSON configuration,
then calls `ModernEpg.init`. Its shared `epgdaterange.py` helper derives midnight
and prime-time timestamps from the server's `slot_start`. `myepg.tmpl` only starts
the surrounding card via `ModernEpg.initShell`. Each AJAX render gets its own
configuration; removing it disposes intervals, delayed updates and page handlers.

Both modern EPG views calculate one shared, subtle gradient for all channel
headers from all loaded picons, rather than channel-specific colors or a fixed
light/dark preset. Each logo has equal influence regardless of image size. The
contrast calculation emphasizes poorly visible logo details, ignores transparent
pixels and accounts for partial transparency at both gradient ends. Gray values
are restricted to 150–230 with a 12-level highlight to avoid dark backgrounds;
this balances logo visibility rather than guaranteeing contrast for every logo.
The timeline applies the gradient vertically so its full brightness difference
remains visible across the short channel rows; the magazine keeps its diagonal gradient.
Channel names have at least 4.5:1 contrast across the gradient. Image loads and
source changes recalculate the shared colors; missing, empty or canvas-inaccessible
images do not influence the result but receive the same background as all other
channels. If no usable pixels remain, all headers retain the theme's original
styling. Image listeners and observers are disposed with the EPG.

The modern main template loads the generated styles and scripts once, with
`epgtime.min.js` before `responsive-multiepg.min.js`. Rebuild the modern JS and CSS
after editing their sources and include the generated assets when distributing
changes. No classic EPG assets or templates are involved. Browser integration
instructions are in [`testsuite/README.md`](../testsuite/README.md).

### Compile JS
`cd` to the repo root, then run

`(cd ./sourcefiles && npm run build-js)`

which minifies and saves the output to
```
/plugin/public/modern/js/
```
Upload these files to the receiver at
```
/usr/lib/enigma2/python/Plugins/Extensions/OpenWebif/public/modern/js/
```

[`build-prod` (there's also a `build-dev` mode which doesn't minify output)]: #

### Compile CSS
`cd` to the repo root, then run

`(cd ./sourcefiles && npm run build-css)`

which minifies and saves the output to
```
/plugin/public/modern/css/
```
Upload these files to the receiver at
```
/usr/lib/enigma2/python/Plugins/Extensions/OpenWebif/public/modern/css/
```

Simply reloading the browser page will be enough, there's no need to restart
Twisted server or enigma2!

### Fonts
The [Roboto](https://fonts.google.com/specimen/Roboto) font is served locally from 
`/modern/fonts/roboto`

### Icons
The [Material Icons font](https://fonts.google.com/icons?selected=Material+Icons) 
provides iconography, and is served locally from `/modern/fonts/materialicons`

Implementation details can be found at https://google.github.io/material-design-icons/

(Note that Material Icon versions on GitHub, NPM and the Google Fonts page are 
all out of sync. This is a [known issue](https://github.com/google/material-design-icons/issues/1284#issue-1181974345).)

---

## Classic interface

```
CLASSIC:

/* source code */
/sourcefiles
    /css
    /js
    /scss

/* output */
/plugin/public
    /css/*.min.css
    /js/*.min.js or

/* browser url */
/
    /css/*.min.css
    /js/*.min.js
```

### Compile JS
`cd` to the repo root, then run

`(cd ./sourcefiles && npm run build-classic-js)`

which minifies and saves the output to
```
/plugin/public/js/
```
Upload these files to the receiver at
```
/usr/lib/enigma2/python/Plugins/Extensions/OpenWebif/public/js/
```

[`build-prod` (there's also a `build-dev` mode which doesn't minify output)]: #

### Compile CSS
`cd` to the repo root, then run

`(cd ./sourcefiles && npm run build-classic-css)`

which minifies and saves the output to
```
/plugin/public/css/
```
Upload these files to the receiver at
```
/usr/lib/enigma2/python/Plugins/Extensions/OpenWebif/public/css/
```

### Compile Themes for jQuery UI
`cd` to the repo root, then run

`(cd ./sourcefiles && npm run build-css-themes)`

This is only needed if jQuery UI has been changed!

Refresh the browser page to see any changes, there's no need to restart Twisted
server or enigma2!

### Compiling CSS Files

TODO: verify whether this information is still applicable.

The script `contrib/inotify_watcher.py` is used for compiling CSS files on
the developers host using [Sass](https://sass-lang.com/) . On linux you need to
have installed a package providing  `inotifywait` and a version that actually
supports inotify if one wants automatic compiling of CSS files on source
directory changes (For debian based distributions this would be `inotify-tools`).

macOS and Windows do not have inotify support thus the automatic compiling will
not work (yet). But if you [installed Sass](https://sass-lang.com/install) and
the `scss` binary/script is in your `PATH`, calling
`contrib/inotify_watcher.py --force-update` should work.
Alternatively, you may define environment variable `SCSS` in order to point to
the location of the scss binary/script.

Base command is

    scss -t compressed --unix-newlines --sourcemap=none "in.scss":"out.css"

---

## Mobile interface

😐
