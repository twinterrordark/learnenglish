(function () {
  "use strict";
  if (!/^(vidfast\.pro|vidfast\.vc)$/.test(location.hostname)) return;

  var sent = new Set();
  var attached = new WeakSet();
  var lastReady = 0;

  function send(type, data) {
    try {
      /* Only subtitle text and playback time go to the app; no cookies or tokens. */
      window.top.postMessage(Object.assign({ source: "learnenglish-vidfast-bridge", type: type }, data || {}), "*");
    } catch (_) {}
  }

  function isEnglish(track) {
    var value = String((track && (track.language || track.label)) || "").toLowerCase();
    return !value || /(^|[^a-z])(en|eng|english)([^a-z]|$)/.test(value);
  }

  function emit(video, track, cue) {
    if (!cue || !isEnglish(track)) return;
    var text = String(cue.text || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return;
    var start = Number(cue.startTime);
    if (!Number.isFinite(start)) start = Number(video.currentTime) || 0;
    var key = Math.floor(start * 4) + "|" + text;
    if (sent.has(key)) return;
    sent.add(key);
    if (sent.size > 500) sent.clear();
    send("CAPTION", {
      text: text,
      language: String(track.label || track.language || "English"),
      start: start,
      end: Number(cue.endTime) || start + 2,
      currentTime: Number(video.currentTime) || start,
      tmdbId: null
    });
  }

  function inspect() {
    var video = document.querySelector("video");
    if (!video) return;
    var now = Date.now();
    if (now - lastReady > 5000) {
      lastReady = now;
      send("READY", { currentTime: Number(video.currentTime) || 0 });
    }
    var tracks = video.textTracks;
    if (!tracks) return;
    for (var i = 0; i < tracks.length; i++) {
      var track = tracks[i];
      if (!isEnglish(track)) continue;
      if (!attached.has(track)) {
        attached.add(track);
        try { track.addEventListener("cuechange", function (event) {
          var cues = event.target && event.target.activeCues;
          if (cues) for (var j = 0; j < cues.length; j++) emit(video, event.target, cues[j]);
        }); } catch (_) {}
      }
      var active = track.activeCues;
      if (active) for (var j = 0; j < active.length; j++) emit(video, track, active[j]);
    }
  }

  inspect();
  window.setInterval(inspect, 400);
})();
