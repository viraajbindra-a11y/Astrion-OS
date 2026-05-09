// Astrion Browser — built-in tracker blocklist.
//
// Conservative starter list of common ad/tracker hostnames. We don't
// ship a full EasyList implementation here — that's a separate
// engineering pass with regex/cosmetic rules. This list catches the
// big-name trackers and known ad networks; settings.blockTrackers
// gates the whole feature.
//
// Match strategy in main.js: reject any request whose URL hostname
// equals one of these or ends with `.<entry>`. So adding 'doubleclick.net'
// blocks foo.doubleclick.net, doubleclick.net.example.com is NOT blocked
// (must end with the suffix).

module.exports = [
  // Google ad/analytics ecosystem
  'doubleclick.net',
  'googlesyndication.com',
  'googletagmanager.com',
  'googletagservices.com',
  'google-analytics.com',
  'analytics.google.com',
  'adservice.google.com',
  'adservice.google.co.uk',
  'pagead2.googlesyndication.com',
  'partner.googleadservices.com',
  'tpc.googlesyndication.com',
  'gtag.googletagmanager.com',

  // Facebook/Meta tracking
  'connect.facebook.net',
  'graph.facebook.com',
  'an.facebook.com',
  'pixel.facebook.com',

  // Common tracker pixel/SDK domains
  'scorecardresearch.com',
  'quantserve.com',
  'adsrvr.org',
  'adnxs.com',
  'taboola.com',
  'outbrain.com',
  'criteo.com',
  'criteo.net',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'casalemedia.com',
  'amazon-adsystem.com',

  // Microsoft / Bing ads
  'bat.bing.com',
  'clarity.ms',

  // LinkedIn tracking
  'px.ads.linkedin.com',

  // TikTok tracking
  'analytics.tiktok.com',

  // Twitter/X analytics
  'static.ads-twitter.com',
  'analytics.twitter.com',

  // Mixpanel / Segment / Heap / Hotjar / Crazy Egg
  'mixpanel.com',
  'cdn.mxpnl.com',
  'api.segment.io',
  'cdn.segment.com',
  'heap.io',
  'cdn.heapanalytics.com',
  'hotjar.com',
  'static.hotjar.com',
  'script.hotjar.com',
  'crazyegg.com',

  // Adobe analytics
  'omtrdc.net',
  '2o7.net',
  'demdex.net',
  'everesttech.net',

  // Other common adtech
  'adform.net',
  'mediavine.com',
  'sharethrough.com',
  'sovrn.com',
  'yieldmo.com',
  'magnite.com',
  '33across.com',
  'liveramp.com',
  'tapad.com',

  // Common popup/notification spam
  'pushwoosh.com',
  'onesignal.com',
  'cdn.onesignal.com',
];
