import { describe, expect, test } from "bun:test";
import {
  detectProfile,
  describeProfile,
  pickLayout,
  type DeviceEnv,
  type Segment,
} from "../src/lib/device-profile";

/* Raw environments as each device's browser reports them. iPhone Duo page sizes are
   WebKit's published Safari 27.1 values; others are typical CSS-px viewports. */
const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 27_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.1 Mobile/15E148 Safari/604.1",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.1 Safari/605.1.15",
  android:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};
const touch = { touchPoints: 5, coarse: true, anyFine: false };
const ANDROID = { platform: "Android", mobile: true };

function env(
  base: Partial<DeviceEnv>,
  w: number,
  h: number,
  extra: Partial<DeviceEnv> = {},
): DeviceEnv {
  return {
    ua: "",
    uad: null,
    touchPoints: 0,
    screenW: w,
    screenH: h,
    coarse: false,
    anyFine: true,
    display: "browser",
    posture: "continuous",
    segs: null,
    landscape: w > h,
    ...base,
    innerW: w,
    innerH: h,
    ...extra,
  };
}
const bookSegs: Segment[] = [
  { x: 0, y: 0, width: 475, height: 620 },
  { x: 476, y: 0, width: 475, height: 620 },
];
const flexSegs: Segment[] = [
  { x: 0, y: 0, width: 412, height: 457 },
  { x: 0, y: 458, width: 412, height: 457 },
];
const spanSegs: Segment[] = [
  { x: 0, y: 0, width: 540, height: 720 },
  { x: 574, y: 0, width: 540, height: 720 },
];

const iphone = { ua: UA.iphone, ...touch, screenW: 402, screenH: 874 };
const duoCover = { ua: UA.iphone, ...touch, screenW: 382, screenH: 618 };
const duoInner = { ua: UA.iphone, ...touch, screenW: 669, screenH: 951 };
const ipad = { ua: UA.macSafari, ...touch, screenW: 820, screenH: 1180 };
const aPhone = { ua: UA.android, uad: ANDROID, ...touch, screenW: 412, screenH: 915 };
const aFold = { ua: UA.android, uad: ANDROID, ...touch, screenW: 673, screenH: 841 };
const aTab = {
  ua: UA.androidTablet,
  uad: { platform: "Android", mobile: false },
  ...touch,
  screenW: 800,
  screenH: 1280,
};
const desk = {
  ua: UA.macChrome,
  uad: { platform: "macOS", mobile: false },
  screenW: 1440,
  screenH: 900,
};

// [label, env, expected name, layout, nav, panes, theme] — written out by hand from the layout rules.
const CASES: [string, DeviceEnv, string, string, string, string, string][] = [
  ["iPhone portrait", env(iphone, 402, 874), "iPhone", "compact", "tabbar", "single", "ios"],
  ["iPhone landscape", env(iphone, 874, 402), "iPhone", "compact", "tabbar-side", "single", "ios"],
  [
    "iPhone Duo cover portrait",
    env(duoCover, 382, 618),
    "iPhone Duo · cover display",
    "compact",
    "tabbar",
    "single",
    "ios",
  ],
  [
    "iPhone Duo cover landscape",
    env(duoCover, 594, 406),
    "iPhone Duo · cover display",
    "compact",
    "tabbar-side",
    "single",
    "ios",
  ],
  [
    "iPhone Duo open portrait",
    env(duoInner, 669, 902),
    "iPhone Duo · inner display",
    "regular",
    "rail",
    "single",
    "ios",
  ],
  [
    "iPhone Duo open landscape",
    env(duoInner, 951, 620),
    "iPhone Duo · inner display",
    "regular",
    "rail",
    "flat",
    "ios",
  ],
  [
    "iPhone Duo book posture",
    env(duoInner, 951, 620, { posture: "folded", segs: bookSegs }),
    "iPhone Duo · inner display",
    "regular",
    "rail",
    "fold",
    "ios",
  ],
  [
    "iPhone Duo Split View",
    env(duoInner, 385, 609, { landscape: true }),
    "iPhone Duo · Split View",
    "compact",
    "tabbar",
    "single",
    "ios",
  ],
  ["iPad portrait", env(ipad, 820, 1180), "iPad", "regular", "rail", "single", "ios"],
  ["iPad landscape", env(ipad, 1180, 820), "iPad", "expanded", "sidebar", "flat", "ios"],
  [
    "Android phone portrait",
    env(aPhone, 412, 915),
    "Android phone",
    "compact",
    "tabbar",
    "single",
    "md",
  ],
  [
    "Android phone landscape",
    env(aPhone, 915, 412),
    "Android phone",
    "compact",
    "tabbar-side",
    "single",
    "md",
  ],
  [
    "Android foldable portrait",
    env(aFold, 673, 841),
    "Android foldable · inner display",
    "regular",
    "rail",
    "single",
    "md",
  ],
  [
    "Android foldable landscape",
    env(aFold, 841, 673),
    "Android foldable · inner display",
    "regular",
    "rail",
    "flat",
    "md",
  ],
  [
    "Android Flex mode",
    env(aPhone, 412, 915, { posture: "folded", segs: flexSegs }),
    "Android foldable · inner display",
    "tabletop",
    "deck",
    "single",
    "md",
  ],
  [
    "Dual-screen spanned",
    env({ ...aPhone, screenW: 1114, screenH: 720 }, 1114, 720, { segs: spanSegs }),
    "Android foldable · inner display",
    "expanded",
    "sidebar",
    "fold",
    "md",
  ],
  [
    "Android tablet portrait",
    env(aTab, 800, 1280),
    "Android tablet",
    "regular",
    "rail",
    "single",
    "md",
  ],
  [
    "Android tablet landscape",
    env(aTab, 1280, 800),
    "Android tablet",
    "expanded",
    "sidebar",
    "flat",
    "md",
  ],
  ["Desktop", env(desk, 1280, 800), "Mac", "expanded", "sidebar", "flat", "ios"],
];

describe("device profile matrix", () => {
  for (const [label, e, name, layout, nav, panes, theme] of CASES) {
    test(label, () => {
      const p = detectProfile(e);
      expect(describeProfile(p)).toBe(name);
      expect({ layout: p.layout, nav: p.nav, panes: p.panes, theme: p.theme }).toEqual({
        layout,
        nav,
        panes,
        theme,
      });
    });
  }
});

describe("layout never depends on device identity", () => {
  test("same window and fold give the same layout on any device", () => {
    const a = detectProfile(env(duoInner, 951, 620));
    const b = detectProfile(env(desk, 951, 620));
    const c = detectProfile(env(aTab, 951, 620));
    for (const p of [b, c]) expect([p.layout, p.nav, p.panes]).toEqual([a.layout, a.nav, a.panes]);
  });
  test("folding only rebalances the panes; navigation stays put at every size class", () => {
    // regular (iPhone Duo inner), expanded (dual-screen spanned, large foldables), wide desktop-class
    for (const [w, h] of [
      [951, 620],
      [1114, 720],
      [1280, 800],
      [2048, 1536],
    ]) {
      const flat = pickLayout(w, h, "none");
      const folded = pickLayout(w, h, "columns");
      expect(folded.nav).toBe(flat.nav);
      expect(folded.layout).toBe(flat.layout);
      expect([flat.panes, folded.panes]).toEqual(["flat", "fold"]);
    }
  });
  test("an iPhone Duo requesting the desktop site is not mistaken for an iPad", () => {
    const p = detectProfile(env({ ...duoInner, ua: UA.macSafari }, 951, 620));
    expect(p.os).toBe("ios");
    expect(p.form).toBe("iphone-duo");
  });
});
