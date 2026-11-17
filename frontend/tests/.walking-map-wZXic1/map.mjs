var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/react-dom/cjs/react-dom.production.js
var require_react_dom_production = __commonJS({
  "node_modules/react-dom/cjs/react-dom.production.js"(exports) {
    "use strict";
    var React = __require("react");
    function formatProdErrorMessage(code) {
      var url = "https://react.dev/errors/" + code;
      if (1 < arguments.length) {
        url += "?args[]=" + encodeURIComponent(arguments[1]);
        for (var i = 2; i < arguments.length; i++)
          url += "&args[]=" + encodeURIComponent(arguments[i]);
      }
      return "Minified React error #" + code + "; visit " + url + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
    }
    function noop() {
    }
    var Internals = {
      d: {
        f: noop,
        r: function() {
          throw Error(formatProdErrorMessage(522));
        },
        D: noop,
        C: noop,
        L: noop,
        m: noop,
        X: noop,
        S: noop,
        M: noop
      },
      p: 0,
      findDOMNode: null
    };
    var REACT_PORTAL_TYPE = /* @__PURE__ */ Symbol.for("react.portal");
    var REACT_RECOVERABLE_TYPE = /* @__PURE__ */ Symbol.for("react.recoverable");
    var REACT_OPTIMISTIC_KEY = /* @__PURE__ */ Symbol.for("react.optimistic_key");
    function createPortal$1(children, containerInfo, implementation) {
      var key = 3 < arguments.length && void 0 !== arguments[3] ? arguments[3] : null;
      return {
        $$typeof: REACT_PORTAL_TYPE,
        key: null == key ? null : key === REACT_OPTIMISTIC_KEY ? REACT_OPTIMISTIC_KEY : "" + key,
        children,
        containerInfo,
        implementation
      };
    }
    var ReactSharedInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    function getCrossOriginStringAs(as, input) {
      if ("font" === as) return "";
      if ("string" === typeof input)
        return "use-credentials" === input ? input : "";
    }
    exports.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = Internals;
    exports.browser = function(reason) {
      return { $$typeof: REACT_RECOVERABLE_TYPE, _reason: reason };
    };
    exports.createPortal = function(children, container) {
      var key = 2 < arguments.length && void 0 !== arguments[2] ? arguments[2] : null;
      if (!container || 1 !== container.nodeType && 9 !== container.nodeType && 11 !== container.nodeType)
        throw Error(formatProdErrorMessage(299));
      return createPortal$1(children, container, null, key);
    };
    exports.flushSync = function(fn) {
      var previousTransition = ReactSharedInternals.T, previousUpdatePriority = Internals.p;
      try {
        if (ReactSharedInternals.T = null, Internals.p = 2, fn) return fn();
      } finally {
        ReactSharedInternals.T = previousTransition, Internals.p = previousUpdatePriority, Internals.d.f();
      }
    };
    exports.preconnect = function(href, options) {
      "string" === typeof href && (options ? (options = options.crossOrigin, options = "string" === typeof options ? "use-credentials" === options ? options : "" : void 0) : options = null, Internals.d.C(href, options));
    };
    exports.prefetchDNS = function(href) {
      "string" === typeof href && Internals.d.D(href);
    };
    exports.preinit = function(href, options) {
      if ("string" === typeof href && options && "string" === typeof options.as) {
        var as = options.as, crossOrigin = getCrossOriginStringAs(as, options.crossOrigin), integrity = "string" === typeof options.integrity ? options.integrity : void 0, fetchPriority = "string" === typeof options.fetchPriority ? options.fetchPriority : void 0;
        "style" === as ? Internals.d.S(
          href,
          "string" === typeof options.precedence ? options.precedence : void 0,
          {
            crossOrigin,
            integrity,
            fetchPriority
          }
        ) : "script" === as && Internals.d.X(href, {
          crossOrigin,
          integrity,
          fetchPriority,
          nonce: "string" === typeof options.nonce ? options.nonce : void 0
        });
      }
    };
    exports.preinitModule = function(href, options) {
      if ("string" === typeof href)
        if ("object" === typeof options && null !== options) {
          if (null == options.as || "script" === options.as) {
            var crossOrigin = getCrossOriginStringAs(
              options.as,
              options.crossOrigin
            );
            Internals.d.M(href, {
              crossOrigin,
              integrity: "string" === typeof options.integrity ? options.integrity : void 0,
              nonce: "string" === typeof options.nonce ? options.nonce : void 0,
              fetchPriority: "string" === typeof options.fetchPriority ? options.fetchPriority : void 0
            });
          }
        } else null == options && Internals.d.M(href);
    };
    exports.preload = function(href, options) {
      if ("string" === typeof href && "object" === typeof options && null !== options && "string" === typeof options.as) {
        var as = options.as, crossOrigin = getCrossOriginStringAs(as, options.crossOrigin);
        Internals.d.L(href, as, {
          crossOrigin,
          integrity: "string" === typeof options.integrity ? options.integrity : void 0,
          nonce: "string" === typeof options.nonce ? options.nonce : void 0,
          type: "string" === typeof options.type ? options.type : void 0,
          fetchPriority: "string" === typeof options.fetchPriority ? options.fetchPriority : void 0,
          referrerPolicy: "string" === typeof options.referrerPolicy ? options.referrerPolicy : void 0,
          imageSrcSet: "string" === typeof options.imageSrcSet ? options.imageSrcSet : void 0,
          imageSizes: "string" === typeof options.imageSizes ? options.imageSizes : void 0,
          media: "string" === typeof options.media ? options.media : void 0
        });
      }
    };
    exports.preloadModule = function(href, options) {
      if ("string" === typeof href)
        if (options) {
          var crossOrigin = getCrossOriginStringAs(options.as, options.crossOrigin);
          Internals.d.m(href, {
            as: "string" === typeof options.as && "script" !== options.as ? options.as : void 0,
            crossOrigin,
            integrity: "string" === typeof options.integrity ? options.integrity : void 0,
            nonce: "string" === typeof options.nonce ? options.nonce : void 0,
            fetchPriority: "string" === typeof options.fetchPriority ? options.fetchPriority : void 0
          });
        } else Internals.d.m(href);
    };
    exports.requestFormReset = function(form) {
      Internals.d.r(form);
    };
    exports.unstable_batchedUpdates = function(fn, a) {
      return fn(a);
    };
    exports.useFormState = function(action, initialState, permalink) {
      return ReactSharedInternals.H.useFormState(action, initialState, permalink);
    };
    exports.useFormStatus = function() {
      return ReactSharedInternals.H.useHostTransitionStatus();
    };
    exports.version = "19.3.0";
  }
});

// node_modules/react-dom/cjs/react-dom.development.js
var require_react_dom_development = __commonJS({
  "node_modules/react-dom/cjs/react-dom.development.js"(exports) {
    "use strict";
    "production" !== process.env.NODE_ENV && (function() {
      function noop() {
      }
      function testStringCoercion(value) {
        return "" + value;
      }
      function createPortal$1(children, containerInfo, implementation) {
        var key = 3 < arguments.length && void 0 !== arguments[3] ? arguments[3] : null;
        if (null == key) key = null;
        else if (key === REACT_OPTIMISTIC_KEY) key = REACT_OPTIMISTIC_KEY;
        else {
          try {
            testStringCoercion(key);
            var JSCompiler_inline_result = false;
          } catch (e) {
            JSCompiler_inline_result = true;
          }
          JSCompiler_inline_result && (console.error(
            "The provided key is an unsupported type %s. This value must be coerced to a string before using it here.",
            "function" === typeof Symbol && Symbol.toStringTag && key[Symbol.toStringTag] || key.constructor.name || "Object"
          ), testStringCoercion(key));
          key = "" + key;
        }
        return {
          $$typeof: REACT_PORTAL_TYPE,
          key,
          children,
          containerInfo,
          implementation
        };
      }
      function getCrossOriginStringAs(as, input) {
        if ("font" === as) return "";
        if ("string" === typeof input)
          return "use-credentials" === input ? input : "";
      }
      function getValueDescriptorExpectingObjectForWarning(thing) {
        return null === thing ? "`null`" : void 0 === thing ? "`undefined`" : "" === thing ? "an empty string" : 'something with type "' + typeof thing + '"';
      }
      function getValueDescriptorExpectingEnumForWarning(thing) {
        return null === thing ? "`null`" : void 0 === thing ? "`undefined`" : "" === thing ? "an empty string" : "string" === typeof thing ? JSON.stringify(thing) : "number" === typeof thing ? "`" + thing + "`" : 'something with type "' + typeof thing + '"';
      }
      function resolveDispatcher() {
        var dispatcher = ReactSharedInternals.H;
        null === dispatcher && console.error(
          "Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem."
        );
        return dispatcher;
      }
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
      var React = __require("react"), Internals = {
        d: {
          f: noop,
          r: function() {
            throw Error(
              "Invalid form element. requestFormReset must be passed a form that was rendered by React."
            );
          },
          D: noop,
          C: noop,
          L: noop,
          m: noop,
          X: noop,
          S: noop,
          M: noop
        },
        p: 0,
        findDOMNode: null
      }, REACT_PORTAL_TYPE = /* @__PURE__ */ Symbol.for("react.portal"), REACT_RECOVERABLE_TYPE = /* @__PURE__ */ Symbol.for("react.recoverable"), REACT_OPTIMISTIC_KEY = /* @__PURE__ */ Symbol.for("react.optimistic_key"), ReactSharedInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      "function" === typeof Map && null != Map.prototype && "function" === typeof Map.prototype.forEach && "function" === typeof Set && null != Set.prototype && "function" === typeof Set.prototype.clear && "function" === typeof Set.prototype.forEach || console.error(
        "React depends on Map and Set built-in types. Make sure that you load a polyfill in older browsers. https://reactjs.org/link/react-polyfills"
      );
      exports.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = Internals;
      exports.browser = function(reason) {
        return { $$typeof: REACT_RECOVERABLE_TYPE, _reason: reason };
      };
      exports.createPortal = function(children, container) {
        var key = 2 < arguments.length && void 0 !== arguments[2] ? arguments[2] : null;
        if (!container || 1 !== container.nodeType && 9 !== container.nodeType && 11 !== container.nodeType)
          throw Error("Target container is not a DOM element.");
        return createPortal$1(children, container, null, key);
      };
      exports.flushSync = function(fn) {
        var previousTransition = ReactSharedInternals.T, previousUpdatePriority = Internals.p;
        try {
          if (ReactSharedInternals.T = null, Internals.p = 2, fn)
            return fn();
        } finally {
          ReactSharedInternals.T = previousTransition, Internals.p = previousUpdatePriority, Internals.d.f() && console.error(
            "flushSync was called from inside a lifecycle method. React cannot flush when React is already rendering. Consider moving this call to a scheduler task or micro task."
          );
        }
      };
      exports.preconnect = function(href, options) {
        "string" === typeof href && href ? null != options && "object" !== typeof options ? console.error(
          "ReactDOM.preconnect(): Expected the `options` argument (second) to be an object but encountered %s instead. The only supported option at this time is `crossOrigin` which accepts a string.",
          getValueDescriptorExpectingEnumForWarning(options)
        ) : null != options && "string" !== typeof options.crossOrigin && console.error(
          "ReactDOM.preconnect(): Expected the `crossOrigin` option (second argument) to be a string but encountered %s instead. Try removing this option or passing a string value instead.",
          getValueDescriptorExpectingObjectForWarning(options.crossOrigin)
        ) : console.error(
          "ReactDOM.preconnect(): Expected the `href` argument (first) to be a non-empty string but encountered %s instead.",
          getValueDescriptorExpectingObjectForWarning(href)
        );
        "string" === typeof href && (options ? (options = options.crossOrigin, options = "string" === typeof options ? "use-credentials" === options ? options : "" : void 0) : options = null, Internals.d.C(href, options));
      };
      exports.prefetchDNS = function(href) {
        if ("string" !== typeof href || !href)
          console.error(
            "ReactDOM.prefetchDNS(): Expected the `href` argument (first) to be a non-empty string but encountered %s instead.",
            getValueDescriptorExpectingObjectForWarning(href)
          );
        else if (1 < arguments.length) {
          var options = arguments[1];
          "object" === typeof options && options.hasOwnProperty("crossOrigin") ? console.error(
            "ReactDOM.prefetchDNS(): Expected only one argument, `href`, but encountered %s as a second argument instead. This argument is reserved for future options and is currently disallowed. It looks like the you are attempting to set a crossOrigin property for this DNS lookup hint. Browsers do not perform DNS queries using CORS and setting this attribute on the resource hint has no effect. Try calling ReactDOM.prefetchDNS() with just a single string argument, `href`.",
            getValueDescriptorExpectingEnumForWarning(options)
          ) : console.error(
            "ReactDOM.prefetchDNS(): Expected only one argument, `href`, but encountered %s as a second argument instead. This argument is reserved for future options and is currently disallowed. Try calling ReactDOM.prefetchDNS() with just a single string argument, `href`.",
            getValueDescriptorExpectingEnumForWarning(options)
          );
        }
        "string" === typeof href && Internals.d.D(href);
      };
      exports.preinit = function(href, options) {
        "string" === typeof href && href ? null == options || "object" !== typeof options ? console.error(
          "ReactDOM.preinit(): Expected the `options` argument (second) to be an object with an `as` property describing the type of resource to be preinitialized but encountered %s instead.",
          getValueDescriptorExpectingEnumForWarning(options)
        ) : "style" !== options.as && "script" !== options.as && console.error(
          'ReactDOM.preinit(): Expected the `as` property in the `options` argument (second) to contain a valid value describing the type of resource to be preinitialized but encountered %s instead. Valid values for `as` are "style" and "script".',
          getValueDescriptorExpectingEnumForWarning(options.as)
        ) : console.error(
          "ReactDOM.preinit(): Expected the `href` argument (first) to be a non-empty string but encountered %s instead.",
          getValueDescriptorExpectingObjectForWarning(href)
        );
        if ("string" === typeof href && options && "string" === typeof options.as) {
          var as = options.as, crossOrigin = getCrossOriginStringAs(as, options.crossOrigin), integrity = "string" === typeof options.integrity ? options.integrity : void 0, fetchPriority = "string" === typeof options.fetchPriority ? options.fetchPriority : void 0;
          "style" === as ? Internals.d.S(
            href,
            "string" === typeof options.precedence ? options.precedence : void 0,
            {
              crossOrigin,
              integrity,
              fetchPriority
            }
          ) : "script" === as && Internals.d.X(href, {
            crossOrigin,
            integrity,
            fetchPriority,
            nonce: "string" === typeof options.nonce ? options.nonce : void 0
          });
        }
      };
      exports.preinitModule = function(href, options) {
        var encountered = "";
        "string" === typeof href && href || (encountered += " The `href` argument encountered was " + getValueDescriptorExpectingObjectForWarning(href) + ".");
        void 0 !== options && "object" !== typeof options ? encountered += " The `options` argument encountered was " + getValueDescriptorExpectingObjectForWarning(options) + "." : options && "as" in options && "script" !== options.as && (encountered += " The `as` option encountered was " + getValueDescriptorExpectingEnumForWarning(options.as) + ".");
        if (encountered)
          console.error(
            "ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` string and, optionally, an `options` object with a valid `as` property.%s",
            encountered
          );
        else
          switch (encountered = options && "string" === typeof options.as ? options.as : "script", encountered) {
            case "script":
              break;
            default:
              encountered = getValueDescriptorExpectingEnumForWarning(encountered), console.error(
                'ReactDOM.preinitModule(): Currently the only supported "as" type for this function is "script" but received "%s" instead. This warning was generated for `href` "%s". In the future other module types will be supported, aligning with the import-attributes proposal. Learn more here: (https://github.com/tc39/proposal-import-attributes)',
                encountered,
                href
              );
          }
        if ("string" === typeof href)
          if ("object" === typeof options && null !== options) {
            if (null == options.as || "script" === options.as)
              encountered = getCrossOriginStringAs(
                options.as,
                options.crossOrigin
              ), Internals.d.M(href, {
                crossOrigin: encountered,
                integrity: "string" === typeof options.integrity ? options.integrity : void 0,
                nonce: "string" === typeof options.nonce ? options.nonce : void 0,
                fetchPriority: "string" === typeof options.fetchPriority ? options.fetchPriority : void 0
              });
          } else null == options && Internals.d.M(href);
      };
      exports.preload = function(href, options) {
        var encountered = "";
        "string" === typeof href && href || (encountered += " The `href` argument encountered was " + getValueDescriptorExpectingObjectForWarning(href) + ".");
        null == options || "object" !== typeof options ? encountered += " The `options` argument encountered was " + getValueDescriptorExpectingObjectForWarning(options) + "." : "string" === typeof options.as && options.as || (encountered += " The `as` option encountered was " + getValueDescriptorExpectingObjectForWarning(options.as) + ".");
        encountered && console.error(
          'ReactDOM.preload(): Expected two arguments, a non-empty `href` string and an `options` object with an `as` property valid for a `<link rel="preload" as="..." />` tag.%s',
          encountered
        );
        if ("string" === typeof href && "object" === typeof options && null !== options && "string" === typeof options.as) {
          encountered = options.as;
          var crossOrigin = getCrossOriginStringAs(
            encountered,
            options.crossOrigin
          );
          Internals.d.L(href, encountered, {
            crossOrigin,
            integrity: "string" === typeof options.integrity ? options.integrity : void 0,
            nonce: "string" === typeof options.nonce ? options.nonce : void 0,
            type: "string" === typeof options.type ? options.type : void 0,
            fetchPriority: "string" === typeof options.fetchPriority ? options.fetchPriority : void 0,
            referrerPolicy: "string" === typeof options.referrerPolicy ? options.referrerPolicy : void 0,
            imageSrcSet: "string" === typeof options.imageSrcSet ? options.imageSrcSet : void 0,
            imageSizes: "string" === typeof options.imageSizes ? options.imageSizes : void 0,
            media: "string" === typeof options.media ? options.media : void 0
          });
        }
      };
      exports.preloadModule = function(href, options) {
        var encountered = "";
        "string" === typeof href && href || (encountered += " The `href` argument encountered was " + getValueDescriptorExpectingObjectForWarning(href) + ".");
        void 0 !== options && "object" !== typeof options ? encountered += " The `options` argument encountered was " + getValueDescriptorExpectingObjectForWarning(options) + "." : options && "as" in options && "string" !== typeof options.as && (encountered += " The `as` option encountered was " + getValueDescriptorExpectingObjectForWarning(options.as) + ".");
        encountered && console.error(
          'ReactDOM.preloadModule(): Expected two arguments, a non-empty `href` string and, optionally, an `options` object with an `as` property valid for a `<link rel="modulepreload" as="..." />` tag.%s',
          encountered
        );
        "string" === typeof href && (options ? (encountered = getCrossOriginStringAs(
          options.as,
          options.crossOrigin
        ), Internals.d.m(href, {
          as: "string" === typeof options.as && "script" !== options.as ? options.as : void 0,
          crossOrigin: encountered,
          integrity: "string" === typeof options.integrity ? options.integrity : void 0,
          nonce: "string" === typeof options.nonce ? options.nonce : void 0,
          fetchPriority: "string" === typeof options.fetchPriority ? options.fetchPriority : void 0
        })) : Internals.d.m(href));
      };
      exports.requestFormReset = function(form) {
        Internals.d.r(form);
      };
      exports.unstable_batchedUpdates = function(fn, a) {
        return fn(a);
      };
      exports.useFormState = function(action, initialState, permalink) {
        return resolveDispatcher().useFormState(action, initialState, permalink);
      };
      exports.useFormStatus = function() {
        return resolveDispatcher().useHostTransitionStatus();
      };
      exports.version = "19.3.0";
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
    })();
  }
});

// node_modules/react-dom/index.js
var require_react_dom = __commonJS({
  "node_modules/react-dom/index.js"(exports, module) {
    "use strict";
    function checkDCE() {
      if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === "undefined" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== "function") {
        return;
      }
      if (process.env.NODE_ENV !== "production") {
        throw new Error("^_^");
      }
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(checkDCE);
      } catch (err) {
        console.error(err);
      }
    }
    if (process.env.NODE_ENV === "production") {
      checkDCE();
      module.exports = require_react_dom_production();
    } else {
      module.exports = require_react_dom_development();
    }
  }
});

// unloaded:maplibre-gl
var maplibre_gl_exports = {};
__export(maplibre_gl_exports, {
  default: () => maplibre_gl_default,
  setWorkerUrl: () => setWorkerUrl
});
var maplibre_gl_default, setWorkerUrl;
var init_maplibre_gl = __esm({
  "unloaded:maplibre-gl"() {
    maplibre_gl_default = {};
    setWorkerUrl = () => {
    };
  }
});

// unloaded:maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url
var maplibre_gl_worker_exports = {};
__export(maplibre_gl_worker_exports, {
  default: () => maplibre_gl_worker_default,
  setWorkerUrl: () => setWorkerUrl2
});
var maplibre_gl_worker_default, setWorkerUrl2;
var init_maplibre_gl_worker = __esm({
  "unloaded:maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"() {
    maplibre_gl_worker_default = {};
    setWorkerUrl2 = () => {
    };
  }
});

// src/components/planner/RouteMap.tsx
var import_react_dom = __toESM(require_react_dom(), 1);
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

// src/lib/route-map-presentation.mjs
function routeDisplayPath(pathPoints, { geometrySource = null, geometryMode = null } = {}) {
  if (geometrySource !== "osrm" || geometryMode !== "walking" || !Array.isArray(pathPoints) || pathPoints.length < 2 || pathPoints.length > 5e4) return [];
  const valid = (point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
  if (!pathPoints.every(valid)) return [];
  return pathPoints.map(({ lat, lng }) => ({ lat, lng }));
}
function screenPinPresentation(points, {
  width,
  height,
  keepouts = [],
  radius = 22,
  gap = 4,
  mergeDistance = 16,
  maxShift = null,
  previous = null
} = {}) {
  if (!Array.isArray(points) || !Array.isArray(keepouts) || points.length > 200) return null;
  const shiftLimit = maxShift === null || maxShift === void 0 ? Math.floor(radius / 2) : maxShift;
  if (![width, height, radius, gap, mergeDistance, shiftLimit].every(Number.isFinite)) return null;
  if (radius <= 0 || gap < 0 || shiftLimit < 0 || width < radius * 2 || height < radius * 2) return null;
  if (!points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const boxes = keepouts.filter((b) => b && [b.left, b.top, b.right, b.bottom].every(Number.isFinite) && b.right > b.left && b.bottom > b.top);
  const offscreen = (p) => p.x < 0 || p.x > width || p.y < 0 || p.y > height;
  const visible = points.map((p, i) => i).filter((i) => !offscreen(points[i]));
  const parent = new Map(visible.map((i) => [i, i]));
  const find = (i) => {
    while (parent.get(i) !== i) i = parent.get(i);
    return i;
  };
  for (let a = 0; a < visible.length; a++) {
    for (let b = a + 1; b < visible.length; b++) {
      const i = visible[a], j = visible[b];
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < mergeDistance) parent.set(find(j), find(i));
    }
  }
  const byRoot = /* @__PURE__ */ new Map();
  for (const i of visible) {
    const root = find(i);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(i);
  }
  let groups = [...byRoot.values()].map((members) => members.sort((x, y) => x - y)).sort((x, y) => x[0] - y[0]);
  const centre = (members) => ({
    x: members.reduce((sum, i) => sum + points[i].x, 0) / members.length,
    y: members.reduce((sum, i) => sum + points[i].y, 0) / members.length
  });
  const step = 3;
  const rings = Math.ceil(shiftLimit / step);
  const ring = [];
  for (let r = 1; r <= rings; r++) {
    for (let k = -r; k <= r; k++) ring.push([r, k], [-r, k], [k, r], [k, -r]);
  }
  const offsets = [...new Map(ring.map(([dx, dy]) => [`${dx}:${dy}`, [dx * step, dy * step]])).values()].filter(([dx, dy]) => Math.hypot(dx, dy) <= shiftLimit).sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2) || a[1] - b[1] || a[0] - b[0]);
  const clearOfControls = (x, y) => boxes.every((b) => x + radius + gap <= b.left || x - radius - gap >= b.right || y + radius + gap <= b.top || y - radius - gap >= b.bottom);
  let checked = 0;
  for (let round = 0; round <= points.length; round++) {
    const placed = [];
    const pins = [];
    const free = (x, y) => ++checked <= 4e4 && x >= 0 && x <= width && y >= 0 && y <= height && placed.every((p) => Math.abs(x - p.x) >= radius * 2 + gap || Math.abs(y - p.y) >= radius * 2 + gap);
    let failed = -1;
    for (let k = 0; k < groups.length && failed < 0; k++) {
      const members = groups[k];
      const c = centre(members);
      const key = members.join(",");
      const tries = [];
      const kept = previous instanceof Map ? previous.get(key) : null;
      if (kept && Number.isFinite(kept.dx) && Number.isFinite(kept.dy) && Math.hypot(kept.dx, kept.dy) <= shiftLimit) tries.push([kept.dx, kept.dy]);
      tries.push([0, 0], ...offsets);
      const spot = tries.find(([dx, dy]) => c.x + dx >= radius && c.x + dx <= width - radius && c.y + dy >= radius && c.y + dy <= height - radius && free(c.x + dx, c.y + dy) && clearOfControls(c.x + dx, c.y + dy)) || (free(c.x, c.y) ? [0, 0] : null);
      if (!spot) {
        failed = k;
        break;
      }
      placed.push({ x: c.x + spot[0], y: c.y + spot[1] });
      pins.push({ members, x: c.x + spot[0], y: c.y + spot[1], shift_x_px: spot[0], shift_y_px: spot[1] });
    }
    if (failed < 0) {
      for (let i = 0; i < points.length; i++) {
        if (!parent.has(i)) pins.push({ members: [i], x: points[i].x, y: points[i].y, shift_x_px: 0, shift_y_px: 0, offscreen: true });
      }
      return pins.sort((a, b) => a.members[0] - b.members[0]);
    }
    if (groups.length < 2 || checked > 4e4) return null;
    const lost = centre(groups[failed]);
    let nearest = -1;
    let best = Infinity;
    groups.forEach((members, k) => {
      if (k === failed) return;
      const c = centre(members);
      const d = Math.hypot(c.x - lost.x, c.y - lost.y);
      if (d < best) {
        best = d;
        nearest = k;
      }
    });
    const merged = [...groups[failed], ...groups[nearest]].sort((x, y) => x - y);
    groups = groups.filter((_, k) => k !== failed && k !== nearest).concat([merged]).sort((x, y) => x[0] - y[0]);
  }
  return null;
}
function pinGroupLabel(members) {
  const numbers = [...new Set((Array.isArray(members) ? members : []).filter(Number.isInteger))].sort((a, b) => a - b).map((i) => i + 1);
  const parts = [];
  for (let k = 0; k < numbers.length; ) {
    let end = k;
    while (end + 1 < numbers.length && numbers[end + 1] === numbers[end] + 1) end++;
    if (end - k >= 2) parts.push(`${numbers[k]}\u2013${numbers[end]}`);
    else for (let j = k; j <= end; j++) parts.push(String(numbers[j]));
    k = end + 1;
  }
  return parts.join(",");
}

// src/lib/route-map-fit.mjs
var SIDES = ["left", "top", "right", "bottom"];
function finite(...values) {
  return values.every(Number.isFinite);
}
function isBox(box, width, height) {
  return box && finite(box.left, box.top, box.right, box.bottom) && box.right > box.left && box.bottom > box.top && // Only a control over the map can hide a mark.
  box.right > 0 && box.bottom > 0 && box.left < width && box.top < height;
}
function paddingOptions({ width, height, keepouts = [], edge = 0, gap = 0 }) {
  let options = [{ top: edge, right: edge, bottom: edge, left: edge }];
  for (const box of keepouts.filter((candidate) => isBox(candidate, width, height))) {
    const next = /* @__PURE__ */ new Map();
    for (const padding of options) {
      for (const side of SIDES) {
        const cleared = { ...padding };
        if (side === "left") cleared.left = Math.max(cleared.left, box.right + gap);
        else if (side === "top") cleared.top = Math.max(cleared.top, box.bottom + gap);
        else if (side === "right") cleared.right = Math.max(cleared.right, width - box.left + gap);
        else cleared.bottom = Math.max(cleared.bottom, height - box.top + gap);
        if (cleared.left + cleared.right >= width || cleared.top + cleared.bottom >= height) continue;
        next.set(`${cleared.top},${cleared.right},${cleared.bottom},${cleared.left}`, cleared);
      }
    }
    const candidates = [...next.values()];
    options = candidates.filter(
      (padding) => !candidates.some(
        (other) => other !== padding && SIDES.every((side) => other[side] <= padding[side]) && SIDES.some((side) => other[side] < padding[side])
      )
    );
  }
  return options;
}
function controlAwareView({
  marks,
  width,
  height,
  keepouts = [],
  edge = 0,
  gap = 0,
  minZoom = 0,
  maxZoom = 18,
  project: project2,
  unproject: unproject2
}) {
  if (!finite(width, height, edge, gap, minZoom, maxZoom) || width <= 0 || height <= 0) return null;
  if (typeof project2 !== "function" || typeof unproject2 !== "function") return null;
  const drawable = (Array.isArray(marks) ? marks : []).filter((mark) => finite(mark?.lat, mark?.lng));
  if (!drawable.length) return null;
  const onMap = { top: edge, right: edge, bottom: edge, left: edge };
  const options = paddingOptions({ width, height, keepouts, edge, gap });
  for (let zoom = Math.floor(maxZoom * 4) / 4; zoom >= Math.ceil(minZoom); zoom -= 0.25) {
    const extent = {
      avoid: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
      stay: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    };
    for (const mark of drawable) {
      const point = project2(mark, zoom);
      if (!finite(point?.x, point?.y)) return null;
      const radius = Number.isFinite(mark.radius) ? Math.max(0, mark.radius) : 0;
      const x = point.x + (Number.isFinite(mark.offsetX) ? mark.offsetX : 0);
      const y = point.y + (Number.isFinite(mark.offsetY) ? mark.offsetY : 0);
      const kind = mark.avoidControls === false ? extent.stay : extent.avoid;
      kind.minX = Math.min(kind.minX, x - radius);
      kind.maxX = Math.max(kind.maxX, x + radius);
      kind.minY = Math.min(kind.minY, y - radius);
      kind.maxY = Math.max(kind.maxY, y + radius);
    }
    let best = null;
    for (const padding of options) {
      const low = { x: -Infinity, y: -Infinity };
      const high = { x: Infinity, y: Infinity };
      for (const [kind, box] of [[extent.avoid, padding], [extent.stay, onMap]]) {
        if (kind.minX > kind.maxX) continue;
        high.x = Math.min(high.x, kind.minX - box.left);
        low.x = Math.max(low.x, kind.maxX - (width - box.right));
        high.y = Math.min(high.y, kind.minY - box.top);
        low.y = Math.max(low.y, kind.maxY - (height - box.bottom));
      }
      if (low.x > high.x || low.y > high.y) continue;
      const slack = Math.min(high.x - low.x, high.y - low.y);
      if (!best || slack > best.slack) {
        best = { slack, padding, origin: { x: (low.x + high.x) / 2, y: (low.y + high.y) / 2 } };
      }
    }
    if (!best) continue;
    const center = unproject2({ x: best.origin.x + width / 2, y: best.origin.y + height / 2 }, zoom);
    if (!finite(center?.lat, center?.lng)) return null;
    return { center: { lat: center.lat, lng: center.lng }, zoom, padding: best.padding };
  }
  return null;
}

// src/lib/route-map-style.mjs
var BASEMAP_PROVIDER = {
  // TileJSON for the OpenMapTiles vector planet.
  tiles: "https://tiles.openfreemap.org/planet",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
};
var BASEMAP_PALETTES = {
  day: {
    paper: "#E8E2D7",
    water: "#C9D3D6",
    waterLabel: "#5B727A",
    park: "#DFE2D5",
    wood: "#D9DDCD",
    building: "#DED8CC",
    buildingLine: "#C9C1B4",
    path: "#EFEADF",
    minor: "#F3EEE5",
    major: "#F8F3EA",
    casing: "#CAC2B5",
    rail: "#CBC6BD",
    label: "#57534C",
    halo: "#E8E2D7"
  },
  night: {
    paper: "#111012",
    water: "#1A2327",
    waterLabel: "#7E98A1",
    park: "#161B15",
    wood: "#151A14",
    building: "#1B1A1A",
    buildingLine: "#242222",
    path: "#1F1D1C",
    minor: "#2A2725",
    major: "#34302D",
    casing: "#0A0909",
    rail: "#33302D",
    label: "#A29D94",
    halo: "#111012"
  }
};
var SOURCE = "openmaptiles";
var lines = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false];
var polygons = ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false];
var notTunnel = ["!=", ["get", "brunnel"], "tunnel"];
var localName = ["coalesce", ["get", "name:latin"], ["get", "name"]];
var LAYERS = [
  { layer: { id: "background", type: "background" }, paint: { "background-color": "paper" } },
  {
    layer: { id: "landcover-wood", type: "fill", source: SOURCE, "source-layer": "landcover", minzoom: 10, filter: ["all", polygons, ["==", ["get", "class"], "wood"]] },
    paint: { "fill-color": "wood" }
  },
  { layer: { id: "park", type: "fill", source: SOURCE, "source-layer": "park", filter: polygons }, paint: { "fill-color": "park" } },
  { layer: { id: "water", type: "fill", source: SOURCE, "source-layer": "water", filter: ["all", polygons, notTunnel] }, paint: { "fill-color": "water" } },
  {
    layer: { id: "waterway", type: "line", source: SOURCE, "source-layer": "waterway", filter: lines, staticPaint: { "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 16, 3] } },
    paint: { "line-color": "water" }
  },
  {
    layer: { id: "building", type: "fill", source: SOURCE, "source-layer": "building", minzoom: 13 },
    paint: { "fill-color": "building", "fill-outline-color": "buildingLine" }
  },
  {
    layer: {
      id: "road-path",
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      minzoom: 14,
      filter: ["all", lines, ["match", ["get", "class"], ["path", "pedestrian"], true, false]],
      layout: { "line-cap": "round", "line-join": "round" },
      staticPaint: { "line-width": ["interpolate", ["exponential", 1.2], ["zoom"], 14, 1, 20, 8] }
    },
    paint: { "line-color": "path" }
  },
  {
    layer: {
      id: "road-minor",
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      minzoom: 12,
      filter: ["all", lines, ["match", ["get", "class"], ["minor", "service", "track"], true, false]],
      layout: { "line-cap": "round", "line-join": "round" },
      staticPaint: { "line-width": ["interpolate", ["exponential", 1.55], ["zoom"], 13, 1.6, 20, 18] }
    },
    paint: { "line-color": "minor" }
  },
  {
    layer: {
      id: "road-major-casing",
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      minzoom: 11,
      filter: ["all", lines, ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk", "motorway"], true, false]],
      layout: { "line-cap": "round", "line-join": "round" },
      staticPaint: { "line-width": ["interpolate", ["exponential", 1.3], ["zoom"], 10, 3, 20, 23] }
    },
    paint: { "line-color": "casing" }
  },
  {
    layer: {
      id: "road-major",
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      minzoom: 9,
      filter: ["all", lines, ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk", "motorway"], true, false]],
      layout: { "line-cap": "round", "line-join": "round" },
      staticPaint: { "line-width": ["interpolate", ["exponential", 1.3], ["zoom"], 10, 2, 20, 20] }
    },
    paint: { "line-color": "major" }
  },
  {
    layer: {
      id: "rail",
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      minzoom: 12,
      filter: ["all", lines, ["match", ["get", "class"], ["rail", "transit"], true, false], ["!", ["has", "service"]]],
      staticPaint: { "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 18, 2.5] }
    },
    paint: { "line-color": "rail" }
  },
  {
    layer: {
      id: "water-name",
      type: "symbol",
      source: SOURCE,
      "source-layer": "water_name",
      minzoom: 11,
      layout: { "text-field": localName, "text-font": ["Noto Sans Italic"], "text-size": 13, "text-letter-spacing": 0.1, "text-max-width": 6 },
      staticPaint: { "text-halo-width": 1.2 }
    },
    paint: { "text-color": "waterLabel", "text-halo-color": "halo" }
  },
  {
    layer: {
      id: "road-name",
      type: "symbol",
      source: SOURCE,
      "source-layer": "transportation_name",
      minzoom: 14,
      filter: ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk", "minor", "pedestrian"], true, false],
      layout: { "symbol-placement": "line", "text-field": localName, "text-font": ["Noto Sans Regular"], "text-size": 12, "text-rotation-alignment": "map" },
      staticPaint: { "text-halo-width": 1.4 }
    },
    paint: { "text-color": "label", "text-halo-color": "halo" }
  },
  {
    layer: {
      id: "place-district",
      type: "symbol",
      source: SOURCE,
      "source-layer": "place",
      minzoom: 12,
      filter: ["match", ["get", "class"], ["suburb", "quarter", "neighbourhood"], true, false],
      layout: { "text-field": localName, "text-font": ["Noto Sans Bold"], "text-size": 11, "text-transform": "uppercase", "text-letter-spacing": 0.12, "text-max-width": 8 },
      staticPaint: { "text-halo-width": 1.4 }
    },
    paint: { "text-color": "label", "text-halo-color": "halo" }
  },
  {
    // Town and city names only while zoomed out; at street zoom they would sit
    // on the day's own route.
    layer: {
      id: "place-town",
      type: "symbol",
      source: SOURCE,
      "source-layer": "place",
      minzoom: 5,
      maxzoom: 10,
      filter: ["match", ["get", "class"], ["city", "town"], true, false],
      layout: { "text-field": localName, "text-font": ["Noto Sans Bold"], "text-size": 14, "text-max-width": 8 },
      staticPaint: { "text-halo-width": 1.6 }
    },
    paint: { "text-color": "label", "text-halo-color": "halo" }
  }
];
function paletteFor(theme) {
  return BASEMAP_PALETTES[theme === "night" ? "night" : "day"];
}
function basemapStyle(theme) {
  const palette = paletteFor(theme);
  return {
    version: 8,
    glyphs: BASEMAP_PROVIDER.glyphs,
    sources: {
      // Attribution is the map's own control (RouteMap.tsx), shown from the
      // start; the TileJSON's copy would only repeat it.
      [SOURCE]: { type: "vector", url: BASEMAP_PROVIDER.tiles, attribution: "" }
    },
    layers: LAYERS.map(({ layer, paint }) => {
      const { staticPaint, ...rest } = layer;
      return {
        ...rest,
        paint: {
          ...staticPaint || {},
          ...Object.fromEntries(Object.entries(paint).map(([property, colour]) => [property, palette[colour]]))
        }
      };
    })
  };
}
function basemapPaint(theme) {
  const palette = paletteFor(theme);
  return LAYERS.flatMap(
    ({ layer, paint }) => Object.entries(paint).map(([property, colour]) => [layer.id, property, palette[colour]])
  );
}
var BASEMAP_LAYER_IDS = LAYERS.map(({ layer }) => layer.id);

// src/components/shared/icons.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function Icon({ className, children, fill = "none" }) {
  return /* @__PURE__ */ jsx(
    "svg",
    {
      "aria-hidden": "true",
      focusable: "false",
      viewBox: "0 0 24 24",
      fill,
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      className: `inline-block shrink-0 ${className ?? "h-4 w-4"}`,
      children
    }
  );
}
function LocationIcon({ className }) {
  return /* @__PURE__ */ jsxs(Icon, { className, children: [
    /* @__PURE__ */ jsx("circle", { cx: "12", cy: "12", r: "7.5" }),
    /* @__PURE__ */ jsx("circle", { cx: "12", cy: "12", r: "2.5", fill: "currentColor", stroke: "none" })
  ] });
}
function ExpandIcon({ className }) {
  return /* @__PURE__ */ jsxs(Icon, { className, children: [
    /* @__PURE__ */ jsx("path", { d: "M14.5 4H20v5.5" }),
    /* @__PURE__ */ jsx("path", { d: "M9.5 20H4v-5.5" }),
    /* @__PURE__ */ jsx("path", { d: "m20 4-6 6" }),
    /* @__PURE__ */ jsx("path", { d: "m4 20 6-6" })
  ] });
}
function RouteIcon({ className }) {
  return /* @__PURE__ */ jsxs(Icon, { className, children: [
    /* @__PURE__ */ jsx("circle", { cx: "6", cy: "18", r: "2.2" }),
    /* @__PURE__ */ jsx("circle", { cx: "18", cy: "6", r: "2.2" }),
    /* @__PURE__ */ jsx("path", { d: "M8 18h6.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H16" })
  ] });
}
function CollapseIcon({ className }) {
  return /* @__PURE__ */ jsxs(Icon, { className, children: [
    /* @__PURE__ */ jsx("path", { d: "M20 9.5h-5.5V4" }),
    /* @__PURE__ */ jsx("path", { d: "M4 14.5h5.5V20" }),
    /* @__PURE__ */ jsx("path", { d: "m14.5 9.5 6-6" }),
    /* @__PURE__ */ jsx("path", { d: "m9.5 14.5-6 6" })
  ] });
}

// src/components/shared/ui.tsx
import { Fragment, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function busyButton(busy, onClick) {
  return {
    "aria-disabled": busy ? true : void 0,
    "aria-busy": busy ? true : void 0,
    onClick: busy ? void 0 : onClick
  };
}

// src/components/planner/RouteMap.tsx
import { Fragment as Fragment2, jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var MARKER_RADIUS = 15;
var DOT_RADIUS = 7;
var EDGE_GAP = 7;
var CONTROL_GAP = 4;
var TILE_SIZE = 512;
var FIT_MAX_ZOOM = 14;
var ROUTE_SOURCE = "parranda-route";
var CONTEXT_SOURCE = "parranda-context";
var CANDIDATE_SOURCE = "parranda-candidates";
var maplibreModule = null;
var mapIconButton = "relative inline-flex h-10 w-10 items-center justify-center rounded-parranda-btn border-line border-parranda-line-firm bg-parranda-paper/85 text-parranda-ink backdrop-blur-sm transition before:absolute before:-inset-0.5 before:content-[''] hover:bg-parranda-paper aria-disabled:opacity-60";
function loadMapLibre() {
  maplibreModule ??= Promise.all([
    Promise.resolve().then(() => (init_maplibre_gl(), maplibre_gl_exports)),
    Promise.resolve().then(() => (init_maplibre_gl_worker(), maplibre_gl_worker_exports))
  ]).then(([mod, worker]) => {
    mod.setWorkerUrl(worker.default);
    return mod;
  });
  return maplibreModule;
}
function applyStill(map, still) {
  for (const handler of [map.dragPan, map.touchZoomRotate, map.doubleClickZoom, map.boxZoom, map.keyboard]) {
    if (still) handler?.disable?.();
    else handler?.enable?.();
  }
  if (!still) map.touchZoomRotate?.disableRotation?.();
}
function currentTheme() {
  const root = document.documentElement;
  const set = root.getAttribute("data-theme");
  if (set === "day" || set === "night") return set;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "night" : "day";
}
function roleColour(token, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value ? `rgb(${value.split(/\s+/).join(", ")})` : fallback;
}
function project(mark, zoom) {
  const world = TILE_SIZE * 2 ** zoom;
  const sin = Math.min(Math.max(Math.sin(mark.lat * Math.PI / 180), -0.9999), 0.9999);
  return {
    x: (mark.lng + 180) / 360 * world,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world
  };
}
function unproject(point, zoom) {
  const world = TILE_SIZE * 2 ** zoom;
  const lng = point.x / world * 360 - 180;
  const n = Math.PI - 2 * Math.PI * point.y / world;
  const lat = 180 / Math.PI * Math.atan(Math.sinh(n));
  return { lat, lng };
}
function controlBoxes(frame, container) {
  const origin = container.getBoundingClientRect();
  return Array.from(frame.querySelectorAll(".maplibregl-ctrl, [data-map-control]"), (control) => {
    const box = control.getBoundingClientRect();
    return {
      left: box.left - origin.left,
      top: box.top - origin.top,
      right: box.right - origin.left,
      bottom: box.bottom - origin.top
    };
  });
}
function fitToControls(map, frame, container, marks, fitted) {
  if (!map || !frame || !container || !marks.length) return;
  const width = container.clientWidth;
  const height = container.clientHeight;
  const view = controlAwareView({
    marks,
    width,
    height,
    keepouts: controlBoxes(frame, container),
    edge: EDGE_GAP,
    gap: CONTROL_GAP,
    maxZoom: FIT_MAX_ZOOM,
    project,
    unproject
  });
  if (view) {
    if (fitted) fitted.current = view.zoom;
    map.jumpTo({ center: [view.center.lng, view.center.lat], zoom: view.zoom });
    return;
  }
  if (fitted) fitted.current = -Infinity;
  const lngs = marks.map((mark) => mark.lng);
  const lats = marks.map((mark) => mark.lat);
  map.fitBounds(
    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    { padding: 36, maxZoom: FIT_MAX_ZOOM, animate: false }
  );
  if (fitted) fitted.current = map.getZoom();
}
var emptyCollection = { type: "FeatureCollection", features: [] };
var pointCollection = (points) => ({
  type: "FeatureCollection",
  features: points.map((point) => ({
    type: "Feature",
    properties: { name: String(point.name || "").trim() },
    geometry: { type: "Point", coordinates: [point.lng, point.lat] }
  }))
});
function walkingAttribution(value) {
  const https = (input) => {
    if (typeof input !== "string" || input.length > 2048) return null;
    try {
      const url2 = new URL(input);
      return url2.protocol === "https:" && !url2.username && !url2.password ? url2.href : null;
    } catch {
      return null;
    }
  };
  const url = https(value?.url);
  if (!url || typeof value?.label !== "string" || !value.label.trim() || value.label.length > 120) return null;
  return { label: value.label.trim(), url, fixMapUrl: https(value.fixMapUrl) };
}
function RouteMap({
  hasPrimaryRoute,
  routeStops,
  primaryRoute,
  areas,
  routeContextSuggestions,
  showContext,
  selectedStopIndex,
  onSelectStop,
  mapExpanded,
  onToggleExpanded,
  heightClass,
  regionLabel,
  still = false,
  positionSession,
  positionEnabled = false,
  positionCentreRequest = 0,
  onLocate,
  onStopLocation,
  t
}) {
  const walkingPath = useMemo(() => routeDisplayPath(primaryRoute?.map_path_points, {
    geometrySource: primaryRoute?.geometry_source,
    geometryMode: primaryRoute?.geometry_mode
  }), [primaryRoute?.map_path_points, primaryRoute?.geometry_source, primaryRoute?.geometry_mode]);
  const hasWalkingPath = hasPrimaryRoute && walkingPath.length > 1;
  const geometryAttribution = hasWalkingPath ? walkingAttribution(primaryRoute?.geometry_attribution) : null;
  const mapTitle = regionLabel || t("Karta \xF6ver dagen", "Map of the day");
  const mapTitleRef = useRef(mapTitle);
  mapTitleRef.current = mapTitle;
  const stillRef = useRef(still);
  stillRef.current = still;
  const frameRef = useRef(null);
  const mapRef = useRef(null);
  const instanceRef = useRef(null);
  useEffect(() => {
    instanceRef.current?.map?.getCanvas?.()?.setAttribute("aria-label", mapTitle);
  }, [mapTitle]);
  const marksRef = useRef([]);
  const [mapDrawn, setMapDrawn] = useState(false);
  const [creditHost, setCreditHost] = useState(null);
  const [marksHost, setMarksHost] = useState(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [layoutCrowded, setLayoutCrowded] = useState(false);
  const position = positionEnabled && positionSession?.state.status === "tracking" ? positionSession.state.position : null;
  const centredRequestRef = useRef(0);
  const [tip, setTip] = useState(null);
  const [groupPicker, setGroupPicker] = useState(null);
  const groupPickerRef = useRef(null);
  const lastPointerRef = useRef(null);
  useEffect(() => {
    const track = (event) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
    };
    document.addEventListener("mousemove", track, { capture: true, passive: true });
    return () => document.removeEventListener("mousemove", track, true);
  }, []);
  useEffect(() => {
    if (!tip && !groupPicker) return;
    const dismiss = (event) => {
      if (event.key === "Escape") {
        tipAnchorRef.current = null;
        setTip(null);
        setGroupPicker(null);
        if (groupPicker) groupPinsRef.current.get(groupPicker.key)?.element.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [tip, groupPicker]);
  useEffect(() => {
    if (!groupPicker) return;
    groupPickerRef.current?.querySelector("[data-group-stop]")?.focus({ preventScroll: true });
    const outside = (event) => {
      const target = event.target;
      if (target instanceof Node && groupPickerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".route-map-group")) return;
      setGroupPicker(null);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [groupPicker]);
  const selectedStopRef = useRef(selectedStopIndex ?? null);
  selectedStopRef.current = selectedStopIndex ?? null;
  const onSelectStopRef = useRef(onSelectStop);
  onSelectStopRef.current = onSelectStop;
  const selectionViewportTopRef = useRef(null);
  const selectStop = (index) => {
    if (!onSelectStopRef.current) return;
    if (selectedStopRef.current !== index && frameRef.current) {
      selectionViewportTopRef.current = { index, top: frameRef.current.getBoundingClientRect().top };
    }
    onSelectStopRef.current(index);
  };
  const selectStopRef = useRef(selectStop);
  selectStopRef.current = selectStop;
  const badgesRef = useRef([]);
  const groupPinsRef = useRef(/* @__PURE__ */ new Map());
  const pinShiftsRef = useRef(/* @__PURE__ */ new Map());
  const focusAfterSplitRef = useRef(null);
  const fittedZoomRef = useRef(-Infinity);
  const layoutRef = useRef(() => {
  });
  const refitRef = useRef(() => {
  });
  layoutRef.current = () => {
    const instance = instanceRef.current;
    if (!badgesRef.current.length) {
      setLayoutCrowded(false);
      return;
    }
    if (!instance || !frameRef.current || !mapRef.current) return;
    const { map } = instance;
    const width = mapRef.current.clientWidth;
    const height = mapRef.current.clientHeight;
    const points = badgesRef.current.map((b) => map.project([b.lng, b.lat]));
    const pins = screenPinPresentation(points, {
      width,
      height,
      keepouts: controlBoxes(frameRef.current, mapRef.current),
      previous: pinShiftsRef.current
    });
    setLayoutCrowded(pins === null);
    const groups = /* @__PURE__ */ new Map();
    if (!pins) badgesRef.current.forEach((badge) => badge.setGrouped(false));
    if (pins) {
      pinShiftsRef.current = new Map(pins.map((pin) => [pin.members.join(","), { dx: pin.shift_x_px, dy: pin.shift_y_px }]));
      for (const pin of pins) {
        if (pin.members.length > 1) {
          groups.set(pin.members.join(","), pin);
          continue;
        }
        const i = pin.members[0];
        badgesRef.current[i].setGrouped(false);
        badgesRef.current[i].move(pin.shift_x_px, pin.shift_y_px, pin.x < width / 2 ? "right" : "left");
      }
      for (const pin of pins) if (pin.members.length > 1) pin.members.forEach((i) => badgesRef.current[i].setGrouped(true));
    }
    syncGroupPins(map, groups);
    badgesRef.current.forEach((badge) => {
      if (!badge.grouped && badge.routeIndex === selectedStopRef.current) badge.element.setAttribute("data-route-selected", "true");
      else badge.element.removeAttribute("data-route-selected");
    });
    for (const [key, pin] of groupPinsRef.current) {
      const selected = key.split(",").some((member) => badgesRef.current[Number(member)]?.routeIndex === selectedStopRef.current);
      if (selected) pin.element.setAttribute("data-route-selected", "true");
      else pin.element.removeAttribute("data-route-selected");
    }
    const pinOf = badgesRef.current.map((_, i) => (pins || []).find((pin) => pin.members.includes(i)));
    const stations = (pins || []).map((pin) => pin.members.length > 1 ? { x: pin.x, y: pin.y } : { x: points[pin.members[0]].x + pin.shift_x_px, y: points[pin.members[0]].y + pin.shift_y_px });
    badgesRef.current.forEach((badge, i) => {
      const pin = pinOf[i];
      const moved = pin && pin.members.length === 1 && (Math.abs(pin.shift_x_px) > 0.5 || Math.abs(pin.shift_y_px) > 0.5);
      badge.showOrigin(Boolean(moved && stations.every((station) => Math.hypot(points[i].x - station.x, points[i].y - station.y) >= 26)));
    });
    const waiting = focusAfterSplitRef.current;
    const next = waiting !== null ? pinOf[waiting] : null;
    if (next && !next.offscreen) {
      focusAfterSplitRef.current = null;
      if (next.members.length === 1) badgesRef.current[next.members[0]].focus();
      else groupPinsRef.current.get(next.members.join(","))?.element.focus();
    }
  };
  const syncGroupPins = (map, groups) => {
    const ml = instanceRef.current?.ml;
    if (!ml) return;
    for (const [key, pin] of groupPinsRef.current) {
      if (groups.has(key)) continue;
      const hadFocus = pin.element.contains(document.activeElement);
      pin.marker.remove();
      groupPinsRef.current.delete(key);
      if (hadFocus && focusAfterSplitRef.current === null) focusAfterSplitRef.current = Number(key.split(",")[0]);
    }
    for (const [key, group] of groups) {
      const badges = group.members.map((i) => badgesRef.current[i]);
      const lng = badges.reduce((sum, b) => sum + b.lng, 0) / badges.length;
      const lat = badges.reduce((sum, b) => sum + b.lat, 0) / badges.length;
      const at = map.project([lng, lat]);
      const offset = [group.x - at.x, group.y - at.y];
      const canSeparate = () => badges.some((badge) => badge.lat !== badges[0].lat || badge.lng !== badges[0].lng) && map.getZoom() < (typeof map.getMaxZoom === "function" ? map.getMaxZoom() : Infinity) - 0.01;
      const label = pinGroupLabel(group.members);
      const names = group.members.map((i) => `${i + 1}. ${badgesRef.current[i].name}`).join(", ");
      const action = canSeparate() ? t("Zooma in f\xF6r att skilja dem \xE5t.", "Zoom in to separate them.") : t("Visa stoppen i gruppen.", "Inspect the stops in this group.");
      const accessibleName = t(`Stopp ${label}: ${names}. ${action}`, `Stops ${label}: ${names}. ${action}`);
      let pin = groupPinsRef.current.get(key);
      if (!pin) {
        const element = document.createElement("div");
        element.className = "route-map-marker-shell route-map-group";
        element.tabIndex = 0;
        element.setAttribute("role", "button");
        element.setAttribute("aria-label", accessibleName);
        element.title = names;
        const disc = document.createElement("span");
        disc.className = "route-map-marker route-map-marker--group";
        disc.textContent = label;
        element.append(disc);
        const open = () => {
          const inspect = () => {
            tipAnchorRef.current = null;
            setTip(null);
            setGroupPicker({ key, members: [...group.members] });
          };
          if (!canSeparate()) {
            inspect();
            return;
          }
          const bounds = new ml.LngLatBounds();
          group.members.forEach((i) => bounds.extend([badgesRef.current[i].lng, badgesRef.current[i].lat]));
          const still2 = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          const camera = map.cameraForBounds(bounds, { padding: 48, maxZoom: Math.max(map.getZoom() + 1, 16) });
          const zoom = Math.max(camera?.zoom ?? map.getZoom() + 2, fittedZoomRef.current);
          if (zoom <= map.getZoom() + 0.01) {
            inspect();
            return;
          }
          setGroupPicker(null);
          if (element.contains(document.activeElement)) focusAfterSplitRef.current = group.members[0];
          map.easeTo({ center: bounds.getCenter(), zoom, duration: still2 ? 0 : 450 });
        };
        for (const type of ["mousedown", "dblclick", "touchstart", "touchend"]) {
          element.addEventListener(type, (event) => event.stopPropagation(), { passive: true });
        }
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          open();
        });
        element.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            open();
          }
        });
        const marker = new ml.Marker({ element, anchor: "center", offset }).setLngLat([lng, lat]).addTo(map);
        element.style.zIndex = String(1200 + group.members[0]);
        groupPinsRef.current.set(key, { marker, element });
        continue;
      }
      pin.element.setAttribute("aria-label", accessibleName);
      pin.marker.setLngLat([lng, lat]);
      pin.marker.setOffset(offset);
    }
  };
  const tipAnchorRef = useRef(null);
  const applyTheme = (map) => {
    const theme = currentTheme();
    for (const [layer, property, colour] of basemapPaint(theme)) {
      if (map.getLayer(layer)) map.setPaintProperty(layer, property, colour);
    }
    const ember = roleColour("--p-color-ember", "#e8431d");
    const paper = roleColour("--p-color-paper", "#eeece7");
    const ink = roleColour("--p-color-ink", "#161411");
    if (map.getLayer("route-line")) map.setPaintProperty("route-line", "line-color", ember);
    if (map.getLayer("context-dots")) {
      map.setPaintProperty("context-dots", "circle-stroke-color", ember);
      map.setPaintProperty("context-dots", "circle-color", paper);
    }
    if (map.getLayer("candidate-dots")) {
      map.setPaintProperty("candidate-dots", "circle-stroke-color", ink);
      map.setPaintProperty("candidate-dots", "circle-color", paper);
    }
  };
  useEffect(() => {
    let cancelled = false;
    async function draw() {
      const drawableAreas = (areas ?? []).filter(
        (a) => a?.center && Number.isFinite(a.center.lat) && Number.isFinite(a.center.lng)
      );
      const drawableRouteStops = routeStops.filter(
        (stop) => stop && Number.isFinite(stop.lat) && Number.isFinite(stop.lng)
      );
      const clearDrawn = () => {
        instanceRef.current?.markers.forEach((marker) => marker.remove());
        if (instanceRef.current) instanceRef.current.markers = [];
        groupPinsRef.current.forEach((pin) => pin.marker.remove());
        groupPinsRef.current = /* @__PURE__ */ new Map();
        pinShiftsRef.current = /* @__PURE__ */ new Map();
        focusAfterSplitRef.current = null;
        badgesRef.current = [];
        tipAnchorRef.current = null;
        setTip(null);
        setGroupPicker(null);
      };
      if (!mapRef.current || (hasPrimaryRoute ? !drawableRouteStops.length : !drawableAreas.length)) {
        clearDrawn();
        marksRef.current = [];
        const map2 = instanceRef.current?.map;
        for (const source of [ROUTE_SOURCE, CONTEXT_SOURCE, CANDIDATE_SOURCE]) map2?.getSource(source)?.setData(emptyCollection);
        setLayoutCrowded(false);
        setMapDrawn(true);
        return;
      }
      let ml;
      try {
        ml = await loadMapLibre();
      } catch {
        if (!cancelled) {
          setMapFailed(true);
          setMapDrawn(true);
        }
        return;
      }
      if (cancelled || !mapRef.current) return;
      if (!instanceRef.current) {
        let map2;
        try {
          map2 = new ml.Map({
            container: mapRef.current,
            style: basemapStyle(currentTheme()),
            center: [10, 30],
            zoom: 1,
            attributionControl: false,
            scrollZoom: false,
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
            maxPitch: 0,
            renderWorldCopies: false,
            fadeDuration: 0,
            // The canvas region's accessible name; MapLibre's default is "Map".
            locale: { "Map.Title": mapTitleRef.current }
          });
        } catch {
          setMapFailed(true);
          setMapDrawn(true);
          return;
        }
        map2.touchZoomRotate?.disableRotation?.();
        applyStill(map2, stillRef.current);
        map2.addControl(new ml.NavigationControl({ showCompass: false }), "top-left");
        map2.addControl(new ml.AttributionControl({ compact: false, customAttribution: BASEMAP_PROVIDER.attribution }), "bottom-right");
        const marks2 = document.createElement("div");
        marks2.className = "maplibregl-ctrl route-map-marks";
        marks2.dataset.mapControl = "";
        map2.addControl({ onAdd: () => marks2, onRemove: () => marks2.remove() }, "bottom-right");
        setMarksHost(marks2);
        map2.once("remove", () => setMarksHost(null));
        const attrib = mapRef.current.querySelector(".maplibregl-ctrl-attrib");
        if (attrib) {
          const host = document.createElement("span");
          host.dataset.walkingCredit = "";
          attrib.appendChild(host);
          setCreditHost(host);
          map2.once("remove", () => setCreditHost(null));
        }
        const controlObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => refitRef.current()) : null;
        mapRef.current.querySelectorAll(".maplibregl-ctrl").forEach((control) => controlObserver?.observe(control));
        map2.once("remove", () => controlObserver?.disconnect());
        map2.on("error", (event) => {
          if (event?.sourceId === "openmaptiles" || /tile|glyph|font|pbf|openfreemap/i.test(String(event?.error?.message || ""))) {
            setTilesFailed(true);
          }
        });
        map2.getCanvas?.()?.addEventListener?.("webglcontextlost", () => setMapFailed(true));
        const ready2 = new Promise((resolve) => {
          if (map2.isStyleLoaded?.()) resolve();
          else map2.once("style.load", () => resolve());
        }).then(() => {
          map2.addSource(ROUTE_SOURCE, { type: "geojson", data: emptyCollection });
          map2.addSource(CONTEXT_SOURCE, { type: "geojson", data: emptyCollection });
          map2.addSource(CANDIDATE_SOURCE, { type: "geojson", data: emptyCollection });
          map2.addLayer({ id: "route-line", type: "line", source: ROUTE_SOURCE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": 5, "line-opacity": 0.95 } });
          map2.addLayer({ id: "context-dots", type: "circle", source: CONTEXT_SOURCE, paint: { "circle-radius": 5, "circle-stroke-width": 1.5, "circle-opacity": 0.6, "circle-stroke-opacity": 0.75 } });
          map2.addLayer({ id: "candidate-dots", type: "circle", source: CANDIDATE_SOURCE, paint: { "circle-radius": 5, "circle-stroke-width": 2 } });
          applyTheme(map2);
        });
        for (const layer of ["context-dots", "candidate-dots"]) {
          map2.on("mousemove", layer, (event) => {
            const feature = event.features?.[0];
            const name = String(feature?.properties?.name || "");
            if (!name) return;
            const point = map2.project(feature.geometry.coordinates);
            tipAnchorRef.current = null;
            setTip({ name, x: point.x, y: point.y, direction: point.x < map2.getContainer().clientWidth / 2 ? "right" : "left" });
          });
          map2.on("mouseleave", layer, () => {
            if (!tipAnchorRef.current) setTip(null);
          });
        }
        let layoutFrame = 0;
        const layoutSoon = () => {
          if (!layoutFrame) layoutFrame = requestAnimationFrame(() => {
            layoutFrame = 0;
            layoutRef.current();
          });
        };
        map2.on("move", layoutSoon);
        map2.on("movestart", () => setGroupPicker(null));
        map2.on("moveend", () => layoutRef.current());
        map2.on("zoomend", () => layoutRef.current());
        map2.on("resize", () => layoutRef.current());
        map2.once("remove", () => {
          if (layoutFrame) cancelAnimationFrame(layoutFrame);
        });
        map2.on("move", () => {
          const anchor = tipAnchorRef.current;
          const badge = anchor ? badgesRef.current[anchor.index] : null;
          if (!badge) return;
          const point = map2.project([badge.lng, badge.lat]);
          setTip((current) => current ? { ...current, x: point.x, y: point.y } : current);
        });
        instanceRef.current = { ml, map: map2, ready: ready2, markers: [] };
      }
      const { map, ready } = instanceRef.current;
      await ready;
      if (cancelled) return;
      clearDrawn();
      setLayoutCrowded(false);
      const marks = [];
      let routeLine = emptyCollection;
      let contextDots = emptyCollection;
      let candidateDots = emptyCollection;
      if (hasPrimaryRoute) {
        const routePath = walkingPath;
        if (routePath.length > 1) {
          routeLine = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routePath.map(({ lat, lng }) => [lng, lat]) } };
          routePath.forEach(({ lat, lng }) => marks.push({ lat, lng, avoidControls: false }));
        }
        routeStops.forEach((stop, index) => {
          if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) return;
          const eventClass = stop.is_live_event === true ? " route-map-marker--event" : "";
          const shiftX = 0;
          const shiftY = 0;
          marks.push({ lat: stop.lat, lng: stop.lng, radius: MARKER_RADIUS });
          const markerName = String(stop.label || stop.name || "").trim();
          const badgeIndex = badgesRef.current.length;
          const open = (interaction, event) => {
            if (!markerName) return;
            if (interaction === "hover" && tipAnchorRef.current?.interaction === "click") {
              const previous = lastPointerRef.current;
              if (tipAnchorRef.current.index === badgeIndex || event && previous && event.clientX === previous.x && event.clientY === previous.y) return;
            }
            if (interaction === "click" && event) lastPointerRef.current = { x: event.clientX, y: event.clientY };
            if (interaction === "click") selectStopRef.current(index);
            const badge2 = badgesRef.current[badgeIndex];
            const point = map.project([stop.lng, stop.lat]);
            tipAnchorRef.current = { index: badgeIndex, interaction };
            setTip({ name: markerName, x: point.x + badge2.x, y: point.y + badge2.y, direction: badge2.direction });
          };
          const close = (boundary) => {
            const anchor = tipAnchorRef.current;
            if (anchor?.index !== badgeIndex || boundary === "leave" && anchor.interaction !== "hover") return;
            tipAnchorRef.current = null;
            setTip(null);
          };
          const target = document.createElement("div");
          target.className = "route-map-target";
          target.addEventListener("mouseenter", (event) => open("hover", event));
          target.addEventListener("mouseleave", () => close("leave"));
          target.addEventListener("click", (event) => open("click", event));
          const shell = document.createElement("div");
          shell.className = "route-map-marker-shell";
          shell.style.zIndex = String(1200 + index);
          shell.tabIndex = 0;
          shell.setAttribute("role", "button");
          if (markerName) shell.setAttribute("aria-label", `${index + 1}. ${markerName}`);
          const disc = document.createElement("span");
          disc.className = `route-map-marker${eventClass}`;
          disc.textContent = String(index + 1);
          const origin = document.createElement("span");
          origin.className = "route-map-marker-origin";
          origin.hidden = true;
          origin.style.setProperty("--route-marker-x", `${shiftX}px`);
          origin.style.setProperty("--route-marker-y", `${shiftY}px`);
          shell.append(disc, origin);
          disc.addEventListener("mouseenter", (event) => open("hover", event));
          disc.addEventListener("mouseleave", () => close("leave"));
          disc.addEventListener("click", (event) => open("click", event));
          shell.addEventListener("focus", () => open("focus"));
          shell.addEventListener("blur", () => close("blur"));
          shell.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              open("click");
            }
          });
          const targetMarker = new ml.Marker({ element: target, anchor: "center", offset: [shiftX, shiftY] }).setLngLat([stop.lng, stop.lat]).addTo(map);
          const discMarker = new ml.Marker({ element: shell, anchor: "center", offset: [shiftX, shiftY] }).setLngLat([stop.lng, stop.lat]).addTo(map);
          target.style.zIndex = "1";
          shell.style.zIndex = String(1200 + index);
          instanceRef.current.markers.push(targetMarker, discMarker);
          let last = "";
          const badge = {
            lat: stop.lat,
            lng: stop.lng,
            name: markerName,
            routeIndex: index,
            element: shell,
            x: shiftX,
            y: shiftY,
            direction: "right",
            showOrigin: (visible) => {
              origin.hidden = !visible;
            },
            // In a group pin: the stop's own pin steps aside, out of sight,
            // out of the tab order and out of the accessibility tree.
            setGrouped: (grouped) => {
              if (badge.grouped === grouped) return;
              badge.grouped = grouped;
              for (const element of [target, shell]) element.style.visibility = grouped ? "hidden" : "";
              shell.tabIndex = grouped ? -1 : 0;
              if (grouped) shell.setAttribute("aria-hidden", "true");
              else shell.removeAttribute("aria-hidden");
              if (grouped && tipAnchorRef.current?.index === badgeIndex) close("blur");
            },
            focus: () => shell.focus(),
            move: (x, y, direction) => {
              const key = `${x}:${y}:${direction}`;
              if (key === last) return;
              last = key;
              badge.x = x;
              badge.y = y;
              badge.direction = direction;
              const shifted = Math.abs(x) > 0.5 || Math.abs(y) > 0.5;
              origin.hidden = !shifted;
              origin.style.setProperty("--route-marker-x", `${x}px`);
              origin.style.setProperty("--route-marker-y", `${y}px`);
              targetMarker.setOffset([x, y]);
              discMarker.setOffset([x, y]);
              if (tipAnchorRef.current?.index === badgeIndex) {
                const point = map.project([stop.lng, stop.lat]);
                setTip((current) => current ? { ...current, x: point.x + x, y: point.y + y, direction } : current);
              }
            }
          };
          badgesRef.current.push(badge);
        });
        if (showContext) {
          const shown = routeContextSuggestions.filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lng));
          shown.forEach((stop) => marks.push({ lat: stop.lat, lng: stop.lng, radius: DOT_RADIUS }));
          contextDots = pointCollection(shown.map((stop) => ({ lat: stop.lat, lng: stop.lng, name: stop.name })));
        }
      } else {
        const dots = [];
        drawableAreas.forEach((area) => {
          marks.push({ lat: area.center.lat, lng: area.center.lng, avoidControls: false });
          (area.stops ?? []).forEach((stop) => {
            if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) return;
            marks.push({ lat: stop.lat, lng: stop.lng, radius: DOT_RADIUS });
            dots.push({ lat: stop.lat, lng: stop.lng, name: stop.name });
          });
        });
        candidateDots = pointCollection(dots);
      }
      map.getSource(ROUTE_SOURCE)?.setData(routeLine);
      map.getSource(CONTEXT_SOURCE)?.setData(contextDots);
      map.getSource(CANDIDATE_SOURCE)?.setData(candidateDots);
      map.setPaintProperty("route-line", "line-dasharray", null);
      marksRef.current = marks;
      map.resize();
      pinShiftsRef.current = /* @__PURE__ */ new Map();
      fitToControls(map, frameRef.current, mapRef.current, marks, fittedZoomRef);
      layoutRef.current();
      setMapDrawn(true);
    }
    draw().catch(() => {
      if (!cancelled) {
        setMapFailed(true);
        setMapDrawn(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [areas, primaryRoute, hasPrimaryRoute, routeStops, routeContextSuggestions, showContext, walkingPath]);
  useEffect(() => {
    layoutRef.current();
  }, [selectedStopIndex]);
  useLayoutEffect(() => {
    const previous = selectionViewportTopRef.current;
    selectionViewportTopRef.current = null;
    if (!previous || previous.index !== selectedStopIndex || !frameRef.current) return;
    const delta = frameRef.current.getBoundingClientRect().top - previous.top;
    if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: "instant" });
  }, [selectedStopIndex]);
  useEffect(() => {
    const root = document.documentElement;
    const observer = typeof MutationObserver === "function" ? new MutationObserver(() => {
      const map = instanceRef.current?.map;
      if (map?.getLayer?.("route-line")) applyTheme(map);
    }) : null;
    observer?.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer?.disconnect();
  }, []);
  useEffect(() => {
    const frame = frameRef.current;
    const container = mapRef.current;
    let animationFrame = 0;
    const refit = () => {
      animationFrame = 0;
      const map = instanceRef.current?.map;
      if (!map) return;
      map.resize();
      pinShiftsRef.current = /* @__PURE__ */ new Map();
      fitToControls(map, frameRef.current, mapRef.current, marksRef.current, fittedZoomRef);
      layoutRef.current();
    };
    const schedule = () => {
      if (!animationFrame) animationFrame = requestAnimationFrame(refit);
    };
    refitRef.current = schedule;
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    if (container) observer?.observe(container);
    const onTransitionEnd = (event) => {
      if (event.target === frame && event.propertyName === "height") schedule();
    };
    frame?.addEventListener("transitionend", onTransitionEnd);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      observer?.disconnect();
      frame?.removeEventListener("transitionend", onTransitionEnd);
      window.removeEventListener("resize", schedule);
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, [mapExpanded]);
  useEffect(() => {
    const map = instanceRef.current?.map;
    if (map) applyStill(map, still);
  }, [still]);
  useEffect(
    () => () => {
      instanceRef.current?.markers.forEach((marker) => marker.remove());
      instanceRef.current?.map.remove();
      instanceRef.current = null;
    },
    []
  );
  useEffect(() => {
    const instance = instanceRef.current;
    if (!position || !mapDrawn || mapFailed || !instance) return;
    const { ml, map } = instance;
    const accuracy = document.createElement("div");
    accuracy.className = "route-map-position-accuracy";
    accuracy.setAttribute("aria-hidden", "true");
    const dot = document.createElement("div");
    dot.className = "route-map-current-position";
    dot.setAttribute("data-current-position", "");
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", t("Din nuvarande position", "Your current position"));
    const at = [position.lng, position.lat];
    const ring = new ml.Marker({ element: accuracy, anchor: "center" }).setLngLat(at).addTo(map);
    const marker = new ml.Marker({ element: dot, anchor: "center" }).setLngLat(at).addTo(map);
    const sizeAccuracy = () => {
      const centre = new ml.LngLat(position.lng, position.lat);
      const pixel = map.project(at);
      const metresPerPixel = centre.distanceTo(map.unproject([pixel.x + 100, pixel.y])) / 100;
      const diameter = 2 * position.accuracy / metresPerPixel;
      accuracy.style.display = Number.isFinite(diameter) && diameter >= 0 ? "" : "none";
      accuracy.style.width = accuracy.style.height = `${diameter}px`;
    };
    map.on("zoom", sizeAccuracy);
    sizeAccuracy();
    if (positionCentreRequest > centredRequestRef.current) {
      centredRequestRef.current = positionCentreRequest;
      map.jumpTo({ center: at });
    }
    layoutRef.current();
    return () => {
      map.off("zoom", sizeAccuracy);
      marker.remove();
      ring.remove();
    };
  }, [position, mapDrawn, mapFailed, positionCentreRequest]);
  const locationState = positionSession?.state;
  const locationStatus = positionEnabled && locationState && /* @__PURE__ */ jsxs3("div", { className: "mt-1 flex min-h-11 flex-wrap items-center gap-x-3 text-xs text-parranda-ink-meta", children: [
    /* @__PURE__ */ jsx3("span", { role: "status", children: locationState.status === "tracking" ? t("Din position visas", "Your location is shown") : locationState.status === "paused" ? t("Positionsvisningen \xE4r pausad", "Location is paused") : locationState.status === "denied" ? t("Till\xE5t platsdelning f\xF6r att visa din position.", "Allow location sharing to show your position.") : locationState.status === "unavailable" ? t("Positionen kunde inte h\xE4mtas. F\xF6rs\xF6k igen.", "Location couldn't be found. Try again.") : t("H\xE4mtar din position \u2026", "Finding your position \u2026") }),
    position && /* @__PURE__ */ jsxs3("span", { "aria-live": "off", children: [
      "\xB1 ",
      Math.max(1, Math.ceil(position.accuracy)),
      " m"
    ] }),
    /* @__PURE__ */ jsx3("button", { type: "button", onClick: onStopLocation, className: "inline-flex min-h-11 items-center font-semibold underline underline-offset-2", children: t("St\xE4ng av position", "Stop location") })
  ] });
  if (mapFailed) {
    return /* @__PURE__ */ jsxs3(Fragment2, { children: [
      /* @__PURE__ */ jsx3("p", { role: "status", className: "rounded-parranda border-line border-parranda-line-faint px-4 py-3 text-sm text-parranda-ink-muted", children: t(
        "Kartan kan inte visas i den h\xE4r webbl\xE4saren. Stoppen och Maps-rutten fungerar som vanligt.",
        "The map can't be shown in this browser. The stops and the Maps route work as usual."
      ) }),
      locationStatus
    ] });
  }
  return /* @__PURE__ */ jsxs3("div", { className: heightClass === "h-full" ? "flex h-full min-h-0 flex-col" : void 0, children: [
    /* @__PURE__ */ jsxs3("div", { ref: frameRef, "data-route-map": "", "data-still": still || void 0, className: `route-map-frame relative w-full overflow-hidden rounded-parranda border-line border-parranda-line-faint transition-all ${heightClass === "h-full" ? "min-h-0 flex-1" : heightClass}`, children: [
      /* @__PURE__ */ jsx3("div", { ref: mapRef, className: "h-full w-full" }),
      groupPicker && /* @__PURE__ */ jsxs3(
        "div",
        {
          ref: groupPickerRef,
          role: "dialog",
          "aria-label": t("Stopp i gruppen", "Stops in this group"),
          className: "route-map-group-picker absolute left-2 top-2 z-(--p-z-map-overlay) max-h-[calc(100%_-_1rem)] w-64 max-w-[calc(100%_-_1rem)] overflow-y-auto rounded-parranda border-line border-parranda-line bg-parranda-paper p-2 text-parranda-ink shadow-control",
          children: [
            /* @__PURE__ */ jsxs3("div", { className: "flex items-center justify-between gap-2 pl-2", children: [
              /* @__PURE__ */ jsx3("strong", { className: "text-sm", children: t("Stopp i gruppen", "Stops in this group") }),
              /* @__PURE__ */ jsx3(
                "button",
                {
                  type: "button",
                  className: "min-h-11 min-w-11 rounded-parranda",
                  "aria-label": t("St\xE4ng", "Close"),
                  onClick: () => {
                    setGroupPicker(null);
                    groupPinsRef.current.get(groupPicker.key)?.element.focus({ preventScroll: true });
                  },
                  children: "\xD7"
                }
              )
            ] }),
            groupPicker.members.map((index) => {
              const badge = badgesRef.current[index];
              if (!badge) return null;
              return /* @__PURE__ */ jsxs3(
                "button",
                {
                  type: "button",
                  "data-group-stop": "",
                  className: "mb-1 min-h-11 w-full rounded-parranda border-line border-parranda-line-faint px-3 py-2 text-left text-sm hover:border-parranda-ember focus-visible:outline-2 focus-visible:outline-parranda-ember",
                  onClick: () => {
                    const map = instanceRef.current?.map;
                    if (!map) return;
                    const point = map.project([badge.lng, badge.lat]);
                    tipAnchorRef.current = { index, interaction: "click" };
                    selectStopRef.current(badge.routeIndex);
                    setGroupPicker(null);
                    setTip({ name: badge.name, x: point.x, y: point.y, direction: point.x < mapRef.current.clientWidth / 2 ? "right" : "left" });
                  },
                  children: [
                    index + 1,
                    ". ",
                    badge.name
                  ]
                },
                index
              );
            })
          ]
        }
      ),
      tip && /* @__PURE__ */ jsx3(
        "div",
        {
          role: "tooltip",
          className: `route-map-tooltip route-map-tooltip--${tip.direction}`,
          style: { left: `${tip.x}px`, top: `${tip.y}px` },
          children: tip.name
        }
      ),
      !mapDrawn && /* @__PURE__ */ jsx3("div", { className: "absolute inset-0 flex items-center justify-center bg-parranda-fill text-sm text-parranda-ink-meta", children: t("Ritar kartan \u2026", "Drawing the map \u2026") }),
      marksHost && (0, import_react_dom.createPortal)(/* @__PURE__ */ jsxs3("div", { className: "flex gap-2", children: [
        positionSession?.supported && onLocate && /* @__PURE__ */ jsx3(
          "button",
          {
            type: "button",
            ...busyButton(!mapDrawn, onLocate),
            "aria-label": positionEnabled ? t("Centrera p\xE5 min position", "Center on my location") : t("Visa min position", "Show my location"),
            title: positionEnabled ? t("Centrera p\xE5 min position", "Center on my location") : t("Visa min position", "Show my location"),
            className: mapIconButton,
            children: /* @__PURE__ */ jsx3(LocationIcon, { className: "h-[18px] w-[18px]" })
          }
        ),
        /* @__PURE__ */ jsx3(
          "button",
          {
            type: "button",
            ...busyButton(!mapDrawn, () => refitRef.current()),
            "aria-label": hasPrimaryRoute ? t("Visa rutten", "Show route") : t("Visa platserna", "Show places"),
            title: hasPrimaryRoute ? t("Visa hela rutten", "Show the whole route") : t("Visa alla platser", "Show all places"),
            className: mapIconButton,
            children: /* @__PURE__ */ jsx3(RouteIcon, { className: "h-[18px] w-[18px]" })
          }
        ),
        onToggleExpanded && /* @__PURE__ */ jsx3(
          "button",
          {
            type: "button",
            onClick: onToggleExpanded,
            "aria-expanded": mapExpanded,
            "aria-label": mapExpanded ? t("F\xF6rminska kartan", "Shrink map") : t("F\xF6rstora kartan", "Expand map"),
            title: mapExpanded ? t("F\xF6rminska kartan", "Shrink map") : t("F\xF6rstora kartan", "Expand map"),
            className: mapIconButton,
            children: mapExpanded ? /* @__PURE__ */ jsx3(CollapseIcon, { className: "h-[18px] w-[18px]" }) : /* @__PURE__ */ jsx3(ExpandIcon, { className: "h-[18px] w-[18px]" })
          }
        )
      ] }), marksHost)
    ] }),
    locationStatus,
    creditHost && geometryAttribution && (0, import_react_dom.createPortal)(/* @__PURE__ */ jsxs3(Fragment2, { children: [
      " \xB7 ",
      t("G\xE5ngv\xE4g", "Walking route"),
      ": ",
      /* @__PURE__ */ jsx3("a", { href: geometryAttribution.url, target: "_blank", rel: "noopener noreferrer", children: geometryAttribution.label }),
      geometryAttribution.fixMapUrl && /* @__PURE__ */ jsxs3(Fragment2, { children: [
        " \xB7 ",
        /* @__PURE__ */ jsx3("a", { href: geometryAttribution.fixMapUrl, target: "_blank", rel: "noopener noreferrer", children: t("R\xE4tta kartan", "Fix the map") })
      ] })
    ] }), creditHost),
    hasPrimaryRoute && !creditHost && /* @__PURE__ */ jsxs3("p", { className: "mt-1 break-words text-xs leading-relaxed text-parranda-ink-meta", children: [
      hasWalkingPath ? t("G\xE5ngv\xE4g", "Walking route") : t("Stopp\xF6versikt \xB7 g\xE5ngv\xE4g saknas", "Stop overview \xB7 walking path unavailable"),
      geometryAttribution && /* @__PURE__ */ jsxs3(Fragment2, { children: [
        " \xB7 ",
        /* @__PURE__ */ jsx3(
          "a",
          {
            href: geometryAttribution.url,
            target: "_blank",
            rel: "noopener noreferrer",
            className: "underline underline-offset-2 hover:text-parranda-ink focus-visible:outline-2 focus-visible:outline-parranda-ember",
            children: geometryAttribution.label
          }
        ),
        geometryAttribution.fixMapUrl && /* @__PURE__ */ jsxs3(Fragment2, { children: [
          " \xB7 ",
          /* @__PURE__ */ jsx3(
            "a",
            {
              href: geometryAttribution.fixMapUrl,
              target: "_blank",
              rel: "noopener noreferrer",
              className: "underline underline-offset-2 hover:text-parranda-ink focus-visible:outline-2 focus-visible:outline-parranda-ember",
              children: t("R\xE4tta kartan", "Fix the map")
            }
          )
        ] })
      ] })
    ] }),
    tilesFailed && /* @__PURE__ */ jsx3("p", { role: "status", className: "mt-1 text-xs text-parranda-ink-meta", children: t("Kartbakgrunden kunde inte h\xE4mtas \u2014 rutten och stoppen visas \xE4nd\xE5.", "The map background couldn't be loaded \u2014 the route and stops are still shown.") }),
    layoutCrowded && /* @__PURE__ */ jsx3("p", { role: "status", className: "mt-1 text-xs text-parranda-ink-meta", children: t("Kartan \xE4r tr\xE5ng \u2014 f\xF6rstora eller zooma f\xF6r att skilja alla stoppnummer \xE5t.", "The map is crowded \u2014 expand or zoom to separate all stop numbers.") })
  ] });
}
export {
  RouteMap as default
};
/*! Bundled license information:

react-dom/cjs/react-dom.production.js:
  (**
   * @license React
   * react-dom.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react-dom/cjs/react-dom.development.js:
  (**
   * @license React
   * react-dom.development.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
