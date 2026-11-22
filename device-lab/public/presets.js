/* Device presets for the lab. Each preset is the raw environment a real
   browser on that device reports (UA, client hints, screen in CSS px, input,
   posture, viewport segments) — detection runs on it unmodified.
   iPhone Duo page sizes: WebKit, "WebKit Features for Safari 27.1".
   Other sizes are typical CSS-px viewports for the class of device. */
(function (root) {
  'use strict';
  var UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.1 Mobile/15E148 Safari/604.1',
    macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.1 Safari/605.1.15',
    android: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    androidTablet: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
  };
  var touch = { touchPoints: 5, coarse: true, anyFine: false };
  var ANDROID_HINTS = { platform: 'Android', mobile: true };

  var PRESETS = {
    'iphone': { label: 'iPhone', group: 'Apple', frame: 'phone',
      env: Object.assign({ ua: UA.iphone, uad: null, screenW: 402, screenH: 874 }, touch),
      o: { portrait: { w: 402, h: 874 }, landscape: { w: 874, h: 402 } },
      insets: { portrait: { top: 62, bottom: 34, left: 0, right: 0 }, landscape: { top: 0, bottom: 21, left: 62, right: 62 } } },
    'duo-cover': { label: 'iPhone Duo · cover', group: 'Apple', frame: 'phone',
      env: Object.assign({ ua: UA.iphone, uad: null, screenW: 382, screenH: 618 }, touch),
      o: { portrait: { w: 382, h: 618 }, landscape: { w: 594, h: 406 } } },
    'duo-open': { label: 'iPhone Duo · open', group: 'Apple', frame: 'duo',
      env: Object.assign({ ua: UA.iphone, uad: null, screenW: 669, screenH: 951 }, touch),
      o: { portrait: { w: 669, h: 902 }, landscape: { w: 951, h: 620 } } },
    'duo-book': { label: 'iPhone Duo · book posture', group: 'Apple', frame: 'duo',
      env: Object.assign({ ua: UA.iphone, uad: null, screenW: 669, screenH: 951, posture: 'folded' }, touch),
      o: { landscape: { w: 951, h: 620, segs: [{ x: 0, y: 0, width: 475, height: 620 }, { x: 476, y: 0, width: 475, height: 620 }] } } },
    'duo-split': { label: 'iPhone Duo · Split View', group: 'Apple', frame: 'duo',
      env: Object.assign({ ua: UA.iphone, uad: null, screenW: 669, screenH: 951 }, touch),
      o: { landscape: { w: 385, h: 609 } } },
    'ipad': { label: 'iPad', group: 'Apple', frame: 'tablet',
      env: Object.assign({ ua: UA.macSafari, uad: null, screenW: 820, screenH: 1180 }, touch),
      o: { portrait: { w: 820, h: 1180 }, landscape: { w: 1180, h: 820 } } },
    'android-phone': { label: 'Android phone', group: 'Android', frame: 'phone',
      env: Object.assign({ ua: UA.android, uad: ANDROID_HINTS, screenW: 412, screenH: 915 }, touch),
      o: { portrait: { w: 412, h: 915 }, landscape: { w: 915, h: 412 } } },
    'android-fold': { label: 'Android foldable · open', group: 'Android', frame: 'duo',
      env: Object.assign({ ua: UA.android, uad: ANDROID_HINTS, screenW: 673, screenH: 841 }, touch),
      o: { portrait: { w: 673, h: 841 }, landscape: { w: 841, h: 673 } } },
    'android-flex': { label: 'Android foldable · Flex mode', group: 'Android', frame: 'phone',
      env: Object.assign({ ua: UA.android, uad: ANDROID_HINTS, screenW: 412, screenH: 915, posture: 'folded' }, touch),
      o: { portrait: { w: 412, h: 915, segs: [{ x: 0, y: 0, width: 412, height: 457 }, { x: 0, y: 458, width: 412, height: 457 }] } } },
    'dual-spanned': { label: 'Dual-screen · spanned', group: 'Android', frame: 'dual',
      env: Object.assign({ ua: UA.android, uad: ANDROID_HINTS, screenW: 1114, screenH: 720 }, touch),
      o: { landscape: { w: 1114, h: 720, segs: [{ x: 0, y: 0, width: 540, height: 720 }, { x: 574, y: 0, width: 540, height: 720 }] } } },
    'android-tablet': { label: 'Android tablet', group: 'Android', frame: 'tablet',
      env: Object.assign({ ua: UA.androidTablet, uad: { platform: 'Android', mobile: false }, screenW: 800, screenH: 1280 }, touch),
      o: { portrait: { w: 800, h: 1280 }, landscape: { w: 1280, h: 800 } } },
    'desktop': { label: 'Desktop', group: 'Desktop', frame: 'laptop',
      env: { ua: UA.macChrome, uad: { platform: 'macOS', mobile: false }, screenW: 1440, screenH: 900, touchPoints: 0, coarse: false, anyFine: true },
      o: { landscape: { w: 1280, h: 800 } } }
  };

  /** The env a preset reports, at the frame's actual inner size. */
  function presetEnv(key, orient, standalone, innerW, innerH) {
    var p = PRESETS[key], o = p.o[orient] || p.o[Object.keys(p.o)[0]];
    var e = Object.assign({ display: 'browser', posture: 'continuous', segs: null }, p.env);
    e.innerW = innerW; e.innerH = innerH;
    e.landscape = (o.w > o.h) || (key === 'duo-split');
    e.segs = o.segs || null;
    if (standalone) e.display = 'standalone';
    e.embedded = false; e.simulated = true;
    return e;
  }

  root.AtlasPresets = { PRESETS: PRESETS, presetEnv: presetEnv };
})(window);
